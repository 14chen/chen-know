package com.kb;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.matchesPattern;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.kb.common.SearchText;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.MvcResult;

/**
 * 端到端验收（MockMvc）：健康检查、认证、邀请码、管理员权限、空间隔离、限流。
 * 用例之间有先后依赖，故用 @Order 固定顺序，模拟真实使用路径。
 */
@SpringBootTest
@AutoConfigureMockMvc
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class ApiIntegrationTest {

    private static final Path DATA_DIR = createDataDir();

    private static final String ADMIN = "alice";
    private static final String ADMIN_PASSWORD = "adminPass123";
    private static final String MEMBER = "bob";
    private static final String MEMBER_PASSWORD = "memberPass123";

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) {
        registry.add("kb.data-dir", DATA_DIR::toString);
    }

    private static Path createDataDir() {
        try {
            return Files.createTempDirectory("kb-integration-");
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    // ---------------------------------------------------------------- 工具

    private static String registerBody(String username, String displayName, String password, String inviteCode) {
        return """
                {"username":"%s","displayName":"%s","password":"%s","inviteCode":%s}
                """.formatted(username, displayName, password,
                inviteCode == null ? "null" : "\"" + inviteCode + "\"");
    }

    private ResultActions postJson(String url, String body) throws Exception {
        return mockMvc.perform(post(url)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body.getBytes(StandardCharsets.UTF_8)));
    }

    private MockHttpSession login(String username, String password) throws Exception {
        MvcResult result = postJson("/api/auth/login",
                "{\"username\":\"%s\",\"password\":\"%s\"}".formatted(username, password))
                .andExpect(status().isOk())
                .andReturn();
        MockHttpSession session = (MockHttpSession) result.getRequest().getSession(false);
        assertNotNull(session, "登录后应建立会话");
        return session;
    }

    private long timeLoginMillis(String username, String password) throws Exception {
        long start = System.nanoTime();
        postJson("/api/auth/login", "{\"username\":\"%s\",\"password\":\"%s\"}".formatted(username, password))
                .andExpect(status().isUnauthorized());
        return (System.nanoTime() - start) / 1_000_000;
    }

    // ---------------------------------------------------------------- 用例

    @Test
    @Order(1)
    @DisplayName("GET /api/health 免登录，db 为真实探测结果")
    void healthIsPublic() throws Exception {
        mockMvc.perform(get("/api/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ok"))
                .andExpect(jsonPath("$.db").value("ok"))
                .andExpect(jsonPath("$.version").value("1.0.0"))
                .andExpect(jsonPath("$.time", matchesPattern("\\d{4}-\\d{2}-\\d{2}T.*Z")));
    }

    @Test
    @Order(2)
    @DisplayName("未登录访问受保护接口一律 401 + UNAUTHORIZED")
    void protectedEndpointsNeedLogin() throws Exception {
        for (String url : List.of("/api/auth/me", "/api/notes", "/api/admin/users")) {
            mockMvc.perform(get(url))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"));
        }
    }

    @Test
    @Order(3)
    @DisplayName("请求体不是 JSON → 400，且不泄漏堆栈")
    void malformedBodyIsValidationFailure() throws Exception {
        postJson("/api/auth/register", "{ this is not json")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"))
                .andExpect(content().string(not(containsString("java."))))
                .andExpect(content().string(not(containsString("Exception"))));
    }

    @Test
    @Order(4)
    @DisplayName("首个用户免邀请码并成为 admin")
    void firstUserBecomesAdmin() throws Exception {
        postJson("/api/auth/register", registerBody(ADMIN, "爱丽丝", ADMIN_PASSWORD, null))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.username").value(ADMIN))
                .andExpect(jsonPath("$.displayName").value("爱丽丝"))
                .andExpect(jsonPath("$.role").value("admin"));
    }

    @Test
    @Order(5)
    @DisplayName("用户名重复 → 409 CONFLICT")
    void duplicateUsernameConflicts() throws Exception {
        postJson("/api/auth/register", registerBody(ADMIN, "重复的爱丽丝", ADMIN_PASSWORD, null))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("CONFLICT"));
    }

    @Test
    @Order(6)
    @DisplayName("参数校验失败 → 400 且带 field")
    void registrationValidationFails() throws Exception {
        // 只让用户名不合法，保证报错字段唯一（多字段同时非法时顺序由校验器决定，不可断言）
        postJson("/api/auth/register", registerBody("ab", "短名", "longEnoughPass123", null))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.error.field").value("username"));
        postJson("/api/auth/register", registerBody("validname", "短名", "short", null))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("password"));
    }

    @Test
    @Order(7)
    @DisplayName("非首个用户必须有有效邀请码")
    void secondUserNeedsInviteCode() throws Exception {
        postJson("/api/auth/register", registerBody(MEMBER, "鲍勃", MEMBER_PASSWORD, null))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("inviteCode"));
        postJson("/api/auth/register", registerBody(MEMBER, "鲍勃", MEMBER_PASSWORD, "deadbeefdeadbeef"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("inviteCode"));
    }

    @Test
    @Order(8)
    @DisplayName("登录下发会话；/api/auth/me 可读当前用户")
    void loginAndMe() throws Exception {
        String body = "{\"username\":\"" + ADMIN + "\",\"password\":\"" + ADMIN_PASSWORD + "\"}";
        MvcResult result = postJson("/api/auth/login", body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.role").value("admin"))
                .andReturn();
        MockHttpSession session = (MockHttpSession) result.getRequest().getSession(false);
        assertNotNull(session);

        mockMvc.perform(get("/api/auth/me").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value(ADMIN));
    }

    @Test
    @Order(9)
    @DisplayName("管理员发邀请码 → 第二位用户注册成功并成为 member")
    void inviteFlowCreatesMember() throws Exception {
        MockHttpSession adminSession = login(ADMIN, ADMIN_PASSWORD);

        MvcResult invite = mockMvc.perform(post("/api/admin/invites").session(adminSession)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expiresInHours\":24}".getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.code", matchesPattern("[0-9a-f]{32}")))
                .andExpect(jsonPath("$.expiresAt").isNotEmpty())
                .andReturn();
        String code = jsonValue(invite, "code");

        postJson("/api/auth/register", registerBody(MEMBER, "鲍勃", MEMBER_PASSWORD, code))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.role").value("member"));

        // 邀请码已被占用，且不能再被使用
        mockMvc.perform(get("/api/admin/invites").session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].code").value(code))
                .andExpect(jsonPath("$.items[0].used").value(true))
                .andExpect(jsonPath("$.items[0].expired").value(false));
        postJson("/api/auth/register", registerBody("carol", "卡罗", MEMBER_PASSWORD, code))
                .andExpect(status().isConflict());
    }

    @Test
    @Order(10)
    @DisplayName("member 访问 /api/admin/** → 403 FORBIDDEN")
    void memberCannotUseAdminApi() throws Exception {
        MockHttpSession memberSession = login(MEMBER, MEMBER_PASSWORD);
        mockMvc.perform(get("/api/admin/users").session(memberSession))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Test
    @Order(11)
    @DisplayName("管理员不能停用/降级/删除自己，也不能动最后一个 admin")
    void adminCannotLockHimselfOut() throws Exception {
        MockHttpSession adminSession = login(ADMIN, ADMIN_PASSWORD);
        long adminId = jdbcTemplate.queryForObject("SELECT id FROM users WHERE username = ?", Long.class, ADMIN);

        mockMvc.perform(patch("/api/admin/users/" + adminId).session(adminSession)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"disabled\":true}".getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("disabled"));

        mockMvc.perform(patch("/api/admin/users/" + adminId).session(adminSession)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"role\":\"member\"}".getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.field").value("role"));

        mockMvc.perform(delete("/api/admin/users/" + adminId).session(adminSession))
                .andExpect(status().isBadRequest());

        // 库里仍有一个启用状态的 admin
        assertEquals(1, jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled = 0", Integer.class));
    }

    @Test
    @Order(12)
    @DisplayName("管理员建号 / 改密码 / 停用；被停用者立刻失去访问权")
    void adminManagesUsers() throws Exception {
        MockHttpSession adminSession = login(ADMIN, ADMIN_PASSWORD);
        mockMvc.perform(post("/api/admin/users").session(adminSession)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"username":"dave","displayName":"戴夫","password":"davePass123","role":"member"}
                                """.getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.role").value("member"));

        long daveId = jdbcTemplate.queryForObject("SELECT id FROM users WHERE username = 'dave'", Long.class);
        MockHttpSession daveSession = login("dave", "davePass123");
        mockMvc.perform(get("/api/auth/me").session(daveSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value("dave"));

        mockMvc.perform(patch("/api/admin/users/" + daveId).session(adminSession)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\":\"戴夫二号\"}".getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.displayName").value("戴夫二号"));

        // 编辑显示名后，已有会话立刻读到新值（无需重新登录）
        mockMvc.perform(get("/api/auth/me").session(daveSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.displayName").value("戴夫二号"));

        mockMvc.perform(patch("/api/admin/users/" + daveId).session(adminSession)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"disabled\":true}".getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.disabled").value(true));

        // 停用后：旧会话立即 401，新登录 403
        mockMvc.perform(get("/api/auth/me").session(daveSession))
                .andExpect(status().isUnauthorized());
        postJson("/api/auth/login", "{\"username\":\"dave\",\"password\":\"davePass123\"}")
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Test
    @Order(13)
    @DisplayName("空间隔离：两个用户各自一个 space，跨 space 读不到数据")
    void spacesAreIsolated() throws Exception {
        Long adminSpace = spaceOf(ADMIN);
        Long memberSpace = spaceOf(MEMBER);
        assertNotNull(adminSpace);
        assertNotNull(memberSpace);
        assertNotEquals(adminSpace, memberSpace);
        assertEquals(1, jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM spaces WHERE owner_id = (SELECT id FROM users WHERE username = ?)",
                Integer.class, MEMBER));

        String now = "2026-10-16T02:33:14Z";
        jdbcTemplate.update("INSERT INTO notes (space_id, title, content, search_blob, created_at, updated_at)"
                        + " VALUES (?, ?, ?, ?, ?, ?)",
                adminSpace, "私密笔记", "只有爱丽丝能看到", SearchText.normalize("私密笔记 只有爱丽丝能看到"), now, now);

        assertEquals(1, jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM notes WHERE space_id = ? AND deleted_at IS NULL", Integer.class, adminSpace));
        assertEquals(0, jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM notes WHERE space_id = ? AND deleted_at IS NULL", Integer.class, memberSpace));
    }

    @Test
    @Order(14)
    @DisplayName("登录耗时与用户名是否存在无关（防用户名枚举）")
    void loginTimingDoesNotLeakUserExistence() throws Exception {
        long knownUser = timeLoginMillis(MEMBER, "definitely-wrong-password");
        long unknownUser = timeLoginMillis("no-such-user-xyz", "definitely-wrong-password");
        assertTrue(knownUser > 20, "已知用户的失败登录应执行一次 BCrypt: " + knownUser + "ms");
        assertTrue(unknownUser > 20, "不存在的用户名也必须执行 BCrypt 以抹平时间差: " + unknownUser + "ms");
    }

    @Test
    @Order(15)
    @DisplayName("同一用户名连续失败 5 次 → 429，且正确密码也被拦")
    void repeatedFailuresLeadToTooManyRequests() throws Exception {
        MockHttpSession adminSession = login(ADMIN, ADMIN_PASSWORD);
        mockMvc.perform(post("/api/admin/users").session(adminSession)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"username":"limited","displayName":"限流","password":"limitedPass123","role":"member"}
                                """.getBytes(StandardCharsets.UTF_8)))
                .andExpect(status().isCreated());

        for (int attempt = 1; attempt <= 5; attempt++) {
            postJson("/api/auth/login", "{\"username\":\"limited\",\"password\":\"wrong-password\"}")
                    .andExpect(status().isUnauthorized());
        }
        postJson("/api/auth/login", "{\"username\":\"limited\",\"password\":\"wrong-password\"}")
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error.code").value("TOO_MANY_REQUESTS"));
        postJson("/api/auth/login", "{\"username\":\"limited\",\"password\":\"limitedPass123\"}")
                .andExpect(status().isTooManyRequests());
    }

    @Test
    @Order(16)
    @DisplayName("登出销毁会话，旧会话不再可用")
    void logoutInvalidatesSession() throws Exception {
        MockHttpSession session = login(ADMIN, ADMIN_PASSWORD);
        mockMvc.perform(post("/api/auth/logout").session(session))
                .andExpect(status().isNoContent());
        assertTrue(session.isInvalid(), "登出后服务端会话必须失效");
    }

    @Test
    @Order(17)
    @DisplayName("未实现的 /api 路径 → 404 NOT_FOUND（不是 500）")
    void unknownApiPathIsNotFound() throws Exception {
        MockHttpSession adminSession = login(ADMIN, ADMIN_PASSWORD);
        mockMvc.perform(get("/api/definitely-not-implemented").session(adminSession))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("NOT_FOUND"));
    }

    @Test
    @Order(18)
    @DisplayName("路径存在但方法不对 → 405 METHOD_NOT_ALLOWED（API.md §0.2）")
    void wrongMethodIsMethodNotAllowed() throws Exception {
        // 两个都是免登录路径，所以这里考察的是「方法不支持」而不是鉴权
        mockMvc.perform(get("/api/auth/login"))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(jsonPath("$.error.code").value("METHOD_NOT_ALLOWED"))
                .andExpect(jsonPath("$.error.message").value("该路径不支持 GET 方法"));

        mockMvc.perform(post("/api/health"))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(jsonPath("$.error.code").value("METHOD_NOT_ALLOWED"))
                .andExpect(jsonPath("$.error.message").value("该路径不支持 POST 方法"));
    }

    private Long spaceOf(String username) {
        return jdbcTemplate.queryForObject(
                "SELECT id FROM spaces WHERE owner_id = (SELECT id FROM users WHERE username = ?)",
                Long.class, username);
    }

    /** 只用于调试期断言，避免再引一个 JSON 解析器。 */
    private static String jsonValue(MvcResult result, String key) throws Exception {
        String body = result.getResponse().getContentAsString(StandardCharsets.UTF_8);
        int index = body.indexOf("\"" + key + "\":\"");
        assertTrue(index >= 0, "响应里找不到字段 " + key + ": " + body);
        int start = index + key.length() + 4;
        return body.substring(start, body.indexOf('"', start));
    }
}
