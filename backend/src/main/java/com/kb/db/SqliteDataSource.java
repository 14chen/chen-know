package com.kb.db;

import java.io.PrintWriter;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Properties;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Logger;
import javax.sql.DataSource;
import org.slf4j.LoggerFactory;
import org.sqlite.SQLiteConfig;

/**
 * 极简 SQLite {@link DataSource}：<b>有界连接池</b>（DEF-E3-006，不引入任何新依赖）。
 *
 * <p>为什么要池化：每个请求 {@code DriverManager.getConnection} + 4 条 PRAGMA 是固定开销的大头
 * （其中 {@code journal_mode=WAL} 每次都可能触发检查点），空响应接口因此稳定吃掉十几毫秒。
 * PRAGMA 是连接级设置，池化后每条物理连接只下发一次，回收时不再重复。
 *
 * <p>池的实现：空闲连接放在 {@link ArrayDeque}，上限 {@link #MAX_IDLE}；取连接时用动态代理把
 * {@code close()} 拦成"归还池"，并在归还前回滚未提交事务、把 autoCommit 复位成 true，
 * 避免事务状态泄漏到下一个使用方。连接不可用（{@code isValid} 失败）则丢弃重建。
 *
 * <p>另外强制事务模式为 {@code IMMEDIATE}（见 {@link #TRANSACTION_MODE_PROPERTY}）。
 */
public class SqliteDataSource implements DataSource, AutoCloseable, org.springframework.beans.factory.DisposableBean {

    /** 与 SCHEMA §0 一一对应 */
    private static final String[] CONNECTION_PRAGMAS = {
            "PRAGMA journal_mode=WAL",
            "PRAGMA foreign_keys=ON",
            "PRAGMA busy_timeout=5000",
            "PRAGMA synchronous=NORMAL",
    };

    /** 空闲连接上限：SQLite 单写多读，读并发不高时够用，也避免句柄堆积。 */
    private static final int MAX_IDLE = Integer.getInteger("kb.db.pool-size", 16);

    private static final org.slf4j.Logger log = LoggerFactory.getLogger(SqliteDataSource.class);

    /**
     * sqlite-jdbc 的连接属性：让 {@code setAutoCommit(false)} 发出 {@code BEGIN IMMEDIATE}。
     *
     * <p>为什么必须这么做：Spring 默认事务是 DEFERRED（{@code BEGIN}），写事务的时序是
     * 「BEGIN → SELECT 建立读快照 → INSERT/UPDATE 想把读锁升级成写锁」。只要这两步之间
     * 有别的写入者提交过，SQLite 就判定快照过期并抛 {@code SQLITE_BUSY_SNAPSHOT} ——
     * 按规范该错误必须<b>立即</b>返回，{@code busy_timeout} 对它不生效（等也解决不了快照过期）。
     * 并发写同一张表时这就是高概率 500。
     *
     * <p>改成 {@code BEGIN IMMEDIATE} 后，事务一开始就取写锁，此时锁冲突是普通的
     * {@code SQLITE_BUSY}，{@code busy_timeout} 会正常等待，多写者按序排队而不是失败。
     *
     * <p>代价评估：本应用所有 {@code @Transactional} 方法都是写路径（create/patch/delete/
     * restore/purge/rebuild/register 等），没有只读事务；读请求走自动提交连接，不 BEGIN、
     * 在 WAL 下也不与写者互斥，因此没有额外代价。
     */
    private static final String TRANSACTION_MODE_PROPERTY = "transaction_mode";

    private final String url;
    private final Properties connectionProperties;
    private final PrintWriter logWriter = new PrintWriter(System.out, true);
    private final Deque<Connection> idle = new ArrayDeque<>();
    private final AtomicInteger created = new AtomicInteger();
    private final boolean pooled;
    /**
     * 写纪元：任何一次"归还连接时发现本连接有变更"就自增。
     *
     * <p>用途：搜索短缓存需要知道"库被改过没有"。SQLite 的 {@code PRAGMA data_version}
     * 只反映**其它连接**的提交，同一连接自己写完再读时它不变，缓存会读到旧结果；
     * 这里用 {@code total_changes()} 在连接归还时判定本连接是否写过，两条路一起保证不读到旧结果。
     */
    private static final java.util.concurrent.atomic.AtomicLong WRITE_EPOCH =
            new java.util.concurrent.atomic.AtomicLong();

    public static long writeEpoch() {
        return WRITE_EPOCH.get();
    }

    /**
     * 不池化：{@code close()} 真正关闭物理连接。
     *
     * <p>给临时库/单测用（@TempDir 清理要求句柄真的释放）。生产路径见
     * {@link DatabaseConfig}，那里显式传 {@code pooled=true}。
     */
    public SqliteDataSource(String url) {
        this(url, false);
    }

    /** @param pooled true = 走有界连接池（生产路径）；false = 每次新建、close 即关闭 */
    public SqliteDataSource(String url, boolean pooled) {
        this.url = url;
        this.pooled = pooled;
        this.connectionProperties = new Properties();
        this.connectionProperties.setProperty(TRANSACTION_MODE_PROPERTY,
                SQLiteConfig.TransactionMode.IMMEDIATE.name());
    }

    @Override
    public Connection getConnection() throws SQLException {
        if (!pooled) {
            return openPhysical();
        }
        Connection physical = poll();
        if (physical == null) {
            physical = openPhysical();
        }
        return wrap(physical);
    }

    @Override
    public Connection getConnection(String username, String password) throws SQLException {
        return getConnection();
    }

    /** 从池里取一条可用连接；坏连接直接丢弃。 */
    private Connection poll() {
        while (true) {
            Connection candidate;
            synchronized (idle) {
                candidate = idle.pollFirst();
            }
            if (candidate == null) {
                return null;
            }
            try {
                if (!candidate.isClosed() && candidate.isValid(1)) {
                    return candidate;
                }
            } catch (SQLException e) {
                // 落到下面关闭后继续取
            }
            closeQuietly(candidate);
        }
    }

    private Connection openPhysical() throws SQLException {
        Connection connection = DriverManager.getConnection(url, connectionProperties);
        try {
            applyPragmas(connection);
        } catch (SQLException | RuntimeException e) {
            try {
                connection.close();
            } catch (SQLException suppressed) {
                e.addSuppressed(suppressed);
            }
            throw e;
        }
        created.incrementAndGet();
        return connection;
    }

    /** 归还连接到池；超过上限或连接已坏则真正关闭。 */
    void recycle(Connection physical) {
        try {
            if (physical.isClosed()) {
                return;
            }
            if (!physical.getAutoCommit()) {
                try {
                    physical.rollback();
                } catch (SQLException e) {
                    closeQuietly(physical);
                    return;
                }
                physical.setAutoCommit(true);
            }
        } catch (SQLException e) {
            closeQuietly(physical);
            return;
        }
        synchronized (idle) {
            if (idle.size() < MAX_IDLE) {
                idle.addFirst(physical);
                physical = null;
            }
        }
        if (physical != null) {
            closeQuietly(physical);
        }
    }

    /** 连接累计变更数（写判定用）；失败返回 -1。 */
    private static long totalChanges(Connection connection) {
        try (java.sql.Statement statement = connection.createStatement();
                java.sql.ResultSet rs = statement.executeQuery("SELECT total_changes()")) {
            return rs.next() ? rs.getLong(1) : -1;
        } catch (SQLException e) {
            return -1;
        }
    }

    /** 把物理连接包装成"close = 归还"的逻辑连接。 */
    private Connection wrap(Connection physical) {
        InvocationHandler handler = new PooledHandler(physical);
        return (Connection) Proxy.newProxyInstance(SqliteDataSource.class.getClassLoader(),
                new Class<?>[] {Connection.class}, handler);
    }

    private final class PooledHandler implements InvocationHandler {

        private final Connection physical;
        private final long startChanges;
        private boolean released;

        PooledHandler(Connection physical) {
            this.physical = physical;
            this.startChanges = totalChanges(physical);
        }

        @Override
        public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
            String name = method.getName();
            switch (name) {
                case "close":
                    if (!released) {
                        released = true;
                        long end = totalChanges(physical);
                        if (startChanges >= 0 && end > startChanges) {
                            WRITE_EPOCH.incrementAndGet();
                        }
                        recycle(physical);
                    }
                    return null;
                case "isClosed":
                    return released || physical.isClosed();
                case "toString":
                    return "PooledConnection[" + physical + "]";
                case "hashCode":
                    return System.identityHashCode(proxy);
                case "equals":
                    return proxy == (args == null || args.length == 0 ? null : args[0]);
                default:
                    break;
            }
            if (released) {
                throw new SQLException("连接已归还连接池");
            }
            try {
                return method.invoke(physical, args);
            } catch (InvocationTargetException e) {
                throw e.getCause();
            }
        }
    }

    static void applyPragmas(Connection connection) throws SQLException {
        try (Statement statement = connection.createStatement()) {
            for (String pragma : CONNECTION_PRAGMAS) {
                statement.execute(pragma);
            }
        }
    }

    /** 关闭所有空闲连接（Spring 容器关闭 / 显式 close 时调用，避免临时库句柄泄漏）。 */
    @Override
    public void destroy() {
        closeIdle();
    }

    @Override
    public void close() {
        closeIdle();
    }

    private void closeIdle() {
        Connection candidate;
        while ((candidate = pollRaw()) != null) {
            closeQuietly(candidate);
        }
    }

    private Connection pollRaw() {
        synchronized (idle) {
            return idle.pollFirst();
        }
    }

    /** 池内空闲连接数（运维观测用）。 */
    public int idleCount() {
        synchronized (idle) {
            return idle.size();
        }
    }

    /** 物理连接创建次数（运维观测用）。 */
    public int createdCount() {
        return created.get();
    }

    private static void closeQuietly(Connection connection) {
        try {
            connection.close();
        } catch (SQLException e) {
            log.debug("关闭连接失败", e);
        }
    }

    @Override
    public PrintWriter getLogWriter() {
        return logWriter;
    }

    @Override
    public void setLogWriter(PrintWriter out) {
        // 单机内嵌库，无需自定义日志输出
    }

    @Override
    public void setLoginTimeout(int seconds) {
        // 内嵌库无网络登录超时
    }

    @Override
    public int getLoginTimeout() {
        return 0;
    }

    @Override
    public Logger getParentLogger() {
        return Logger.getLogger("com.kb.db");
    }

    @Override
    public <T> T unwrap(Class<T> iface) throws SQLException {
        if (iface.isInstance(this)) {
            return iface.cast(this);
        }
        throw new SQLException("不支持 unwrap 到 " + iface.getName());
    }

    @Override
    public boolean isWrapperFor(Class<?> iface) {
        return iface.isInstance(this);
    }
}
