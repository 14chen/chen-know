# 流 W5 · 测试稳定性修复（TrashApiTest 毫秒竞态）

时间：2026-10-28　范围：**只改测试**　构建：kb-build.ps1（带文件锁）　Maven 全程 `-o`

## 1. 现象

全量 Java 测试 328 用例 / 1 失败，唯一红灯：

```
com.kb.trash.TrashApiTest#restoreOnlyBringsBackNotesDeletedWithTheFolder
```

单独跑该类 11/0 通过，全量跑偶发失败 —— 典型毫秒级竞态。

## 2. 根因

修复前（原文件 172-174 行）：

```java
jdbc.update("UPDATE notes SET deleted_at = ? WHERE id = ?", Times.now(), noteDeletedEarlier);
softDeleteFolderTree(folder, adminSpaceId, Times.now());
```

两次 `Times.now()` 背靠背调用。实现见 `com.kb.common.Times#now`：

```java
return DateTimeFormatter.ISO_INSTANT.format(Instant.now());
```

= `Instant.now()` 的 **ISO-8601 毫秒精度**文本。回收站恢复逻辑按 `deleted_at` **相等**判定"同一次删除"，
所以两次调用一旦落进同一毫秒，就会出现：

- "先单独删的笔记" 与 "随目录删的笔记" 拿到**同一个** `deleted_at`
- 恢复目录时两者被当成同一批 → 先删的也被捞回来
- 断言 `更早单独删的笔记不得恢复`（期望 0，实际 1）失败

## 3. 改法（仅测试文件）

`backend/src/test/java/com/kb/trash/TrashApiTest.java`

1. 新增 import：`java.time.Instant`
2. 用例内先取一次时间戳并复用，第二个时间戳由新工具方法**严格推后**：

```java
String earlierDeletion = Times.now();
jdbc.update("UPDATE notes SET deleted_at = ? WHERE id = ?", earlierDeletion, noteDeletedEarlier);
// 两次删除必须落在不同毫秒：回收站按 deleted_at 相等判定"同一次删除"，同毫秒会把两者当成同批
softDeleteFolderTree(folder, adminSpaceId, timestampAfter(earlierDeletion));
```

3. 新增私有工具方法（放在 `softDeleteFolderTree` 之前）：

```java
/** 取一个严格晚于 {@code timestamp} 的时间戳（ISO-8601 UTC 毫秒精度），避免两次删除撞进同一毫秒。 */
private static String timestampAfter(String timestamp) throws InterruptedException {
    Instant threshold = Instant.parse(timestamp);
    String candidate = Times.now();
    for (int i = 0; i < 2000 && !Instant.parse(candidate).isAfter(threshold); i++) {
        Thread.sleep(1);
        candidate = Times.now();
    }
    assertTrue(Instant.parse(candidate).isAfter(threshold), "时钟未推进，无法构造两次不同的删除时间戳");
    return candidate;
}
```

### 为什么不用 `Times.advance(...)`

`Times.java` 在 **`src/main`（生产代码）**，且只有 `now()` / `format()`，没有可控时钟。
按边界"不改生产代码"，所以没有给它加 `advance`；改用"取一次 + 轮询到严格更晚"的确定性写法。

### 为什么比裸 `Thread.sleep(2)` 稳

`timesleep` 依赖系统时钟在这 2ms 内真的走一格；Windows 上时钟粒度不保证。
这里改成**读取校验**：循环直到 `Instant.now()` 真正 `isAfter` 前一个时间戳才返回；
即使某次睡眠没跨过毫秒边界，也会继续等到跨过为止（最多 2000 次 × 1ms）。
另外 `assertTrue` 兜底：万一时钟不推进，会以明确消息失败，而不是把偶发竞态重新变成静默偶发。

### 语义未被放宽

- 断言**原样保留**：`随目录一起删的笔记应恢复 == 1`、`更早单独删的笔记不得恢复 == 0`
- 只改了"构造数据时两个删除时间戳如何取值"，没有删检查、没有改期望值
- 反而更贴 DisplayName：原本"更早单独删的笔记"在撞毫秒时并不更早，现在保证严格更早

## 4. 验证

### 4.1 全量（验收 1）

```
powershell -NoProfile -ExecutionPolicy Bypass -File F:\work\test\kb\kb-build.ps1 -Tests
mvn exit=0
```

surefire 汇总（52 个测试类）：

```
classes=52  tests=328  failures=0  errors=0  skipped=0
TEST-com.kb.trash.TrashApiTest.xml -> tests=11 failures=0 errors=0
```

**328 用例 / 0 失败**，与验收期望一致；没有任何 `<failure>` / `<error>` 节点。

### 4.2 单类连跑 3 次（验收 2）

在**同一把构建锁**（`F:\work\test\kb\build.lock`，最长等 6 分钟）下逐次跑，
避免与其他流抢 `target/`；每次先删掉上一次的 XML 再跑。

```
RUN #1  exit=0  tests=11 failures=0 errors=0 skipped=0 time=11.278
RUN #2  exit=0  tests=11 failures=0 errors=0 skipped=0 time=11.140
RUN #3  exit=0  tests=11 failures=0 errors=0 skipped=0 time=11.352
```

3 次全绿。

## 5. 改了哪些文件

| 文件 | 改动 |
|---|---|
| `backend/src/test/java/com/kb/trash/TrashApiTest.java` | +1 import、用例内 3 行改为复用+推后、新增 1 个私有工具方法（共 +12/-2 行） |

**没有改动**：任何 `src/main` 生产代码、`Times.java`、`pom.xml`、其他测试、`data/kb.db`、8080 实例。
（旁证：`backend/src` 下近 40 分钟内其它被改的 java 文件全部在 A/B/C/D/E 各流的包里，
 唯一 `test/` 路径下的改动就是本项目文件，mtime 18:56:46。）

## 6. 证据

- `docs/test-20261028/evidence/w5/test-summary.txt` —— 全量与单类计数
- `docs/test-20261028/evidence/w5/full-suite-mvn.log` —— 全量构建日志（exit=0）
- `docs/test-20261028/evidence/w5/single-run-{1,2,3}-mvn.log` —— 三次单类日志
- `docs/test-20261028/evidence/w5/change.diff` —— 改动 diff
- 改前原文件备份：`F:\work\test\kb\logs\TrashApiTest.java.before-w5`（仓库外，可随时回滚）

## 7. 遗留风险 / 提示

- 同类写法在同文件的 `crossSpaceIsolation`（原 303/305 行）也有两次独立 `Times.now()`，
  但两值**不参与相等比较**，不是同批判定，不会引发同类竞态 —— 按"不动其他测试"边界未改。
- 若将来回收站改成"按时间区间判定同批"，本用例构造的"严格更早"仍成立，无需再改。
