package com.kb.note;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * 笔记 / 目录 / 标签 / 搜索 / 版本 / 双链各集成测试共用的脚手架。
 *
 * <p>只放与上下文无关的工具；{@code @SpringBootTest}、{@code @AutoConfigureMockMvc} 与
 * **每类独立的临时数据目录**（{@code @DynamicPropertySource}）由各子类声明，
 * 绝不触碰仓库根下的 {@code data/kb.db}。
 */
public abstract class ApiTestSupport {

    protected static final String ALICE = "alice";
    protected static final String ALICE_PASSWORD = "adminPass123";
    protected static final String BOB = "bob";
    protected static final String BOB_PASSWORD = "memberPass123";

    @Autowired
    protected MockMvc mockMvc;

    @Autowired
    protected JdbcTemplate jdbc;

    protected static Path newTempDataDir() {
        try {
            return Files.createTempDirectory("kb-note-it-");
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    // ---------------------------------------------------------------- 请求

    protected ResultActions postJson(MockHttpSession session, String url, String body) throws Exception {
        return mockMvc.perform(withSession(post(url), session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body.getBytes(StandardCharsets.UTF_8)));
    }

    protected ResultActions patchJson(MockHttpSession session, String url, String body) throws Exception {
        return mockMvc.perform(withSession(patch(url), session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body.getBytes(StandardCharsets.UTF_8)));
    }

    protected ResultActions putJson(MockHttpSession session, String url, String body) throws Exception {
        return mockMvc.perform(withSession(put(url), session)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body.getBytes(StandardCharsets.UTF_8)));
    }

    protected ResultActions getJson(MockHttpSession session, String url) throws Exception {
        return mockMvc.perform(withSession(get(url), session));
    }

    protected ResultActions deleteJson(MockHttpSession session, String url) throws Exception {
        return mockMvc.perform(withSession(delete(url), session));
    }

    private static MockHttpServletRequestBuilder withSession(MockHttpServletRequestBuilder builder,
            MockHttpSession session) {
        return session == null ? builder : builder.session(session);
    }

    // ---------------------------------------------------------------- 会话

    /** 第一个用户免邀请码成为 admin；其后每个用户都需要一张管理员发的邀请码。 */
    protected MockHttpSession sessionOf(String username, String displayName, String password) throws Exception {
        Integer exists = jdbc.queryForObject(
                "SELECT COUNT(*) FROM users WHERE username = ? COLLATE NOCASE", Integer.class, username);
        if (exists == null || exists == 0) {
            String inviteCode = null;
            Integer users = jdbc.queryForObject("SELECT COUNT(*) FROM users", Integer.class);
            if (users != null && users > 0) {
                inviteCode = createInvite(login(ALICE, ALICE_PASSWORD));
            }
            postJson(null, "/api/auth/register", """
                    {"username":"%s","displayName":"%s","password":"%s","inviteCode":%s}
                    """.formatted(username, displayName, password,
                    inviteCode == null ? "null" : "\"" + inviteCode + "\""))
                    .andExpect(status().isCreated());
        }
        return login(username, password);
    }

    protected MockHttpSession alice() throws Exception {
        return sessionOf(ALICE, "爱丽丝", ALICE_PASSWORD);
    }

    protected MockHttpSession bob() throws Exception {
        return sessionOf(BOB, "鲍勃", BOB_PASSWORD);
    }

    protected MockHttpSession login(String username, String password) throws Exception {
        MvcResult result = postJson(null, "/api/auth/login",
                "{\"username\":\"%s\",\"password\":\"%s\"}".formatted(username, password))
                .andExpect(status().isOk())
                .andReturn();
        MockHttpSession session = (MockHttpSession) result.getRequest().getSession(false);
        assertNotNull(session, "登录后应建立会话");
        return session;
    }

    protected String createInvite(MockHttpSession admin) throws Exception {
        MvcResult result = postJson(admin, "/api/admin/invites", "{}")
                .andExpect(status().isCreated())
                .andReturn();
        return json(result, "$.code");
    }

    // ---------------------------------------------------------------- 业务

    protected long createFolder(MockHttpSession session, Long parentId, String name) throws Exception {
        MvcResult result = postJson(session, "/api/folders", "{\"parentId\":%s,\"name\":\"%s\"}"
                .formatted(parentId == null ? "null" : parentId, escape(name)))
                .andExpect(status().isCreated())
                .andReturn();
        return jsonLong(result, "$.id");
    }

    protected long createNote(MockHttpSession session, Long folderId, String title, String content)
            throws Exception {
        MvcResult result = postJson(session, "/api/notes", "{\"folderId\":%s,\"title\":\"%s\",\"content\":\"%s\"}"
                .formatted(folderId == null ? "null" : folderId, escape(title), escape(content)))
                .andExpect(status().isCreated())
                .andReturn();
        return jsonLong(result, "$.id");
    }

    protected long createTag(MockHttpSession session, String name, String color) throws Exception {
        MvcResult result = postJson(session, "/api/tags", "{\"name\":\"%s\",\"color\":%s}"
                .formatted(escape(name), color == null ? "null" : "\"" + color + "\""))
                .andExpect(status().isCreated())
                .andReturn();
        return jsonLong(result, "$.id");
    }

    // ---------------------------------------------------------------- 断言工具

    protected static String body(MvcResult result) throws Exception {
        return result.getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    /** JsonPath 直取，便于对树/数组做顺序无关的断言。 */
    protected static <T> T json(MvcResult result, String pointer) throws Exception {
        return JsonPath.read(body(result), pointer);
    }

    protected static long jsonLong(MvcResult result, String pointer) throws Exception {
        return ((Number) json(result, pointer)).longValue();
    }

    /** JsonPath 过滤器即使只匹配一项也返回数组：断言唯一命中并取出数值。 */
    protected static long singleLong(MvcResult result, String pointer) throws Exception {
        List<Number> found = json(result, pointer);
        assertEquals(1, found.size(), "期望 " + pointer + " 唯一命中，实际 " + found.size() + " 项");
        return found.get(0).longValue();
    }

    /** 同上，取出对象（用于断言字段集合）。 */
    protected static Map<String, Object> singleObject(MvcResult result, String pointer) throws Exception {
        List<Map<String, Object>> found = json(result, pointer);
        assertEquals(1, found.size(), "期望 " + pointer + " 唯一命中，实际 " + found.size() + " 项");
        return found.get(0);
    }

    protected static List<String> strings(MvcResult result, String pointer) throws Exception {
        return json(result, pointer);
    }

    /** 目录/标签按名字在列表响应里定位 id。 */
    protected static long idOfName(MvcResult listResult, String name) throws Exception {
        return singleLong(listResult, "$[?(@.name=='" + name + "')].id");
    }

    /** 把 Java 字符串安全地塞进手写的 JSON 字面量。 */
    protected static String escape(String raw) {
        if (raw == null) {
            return "";
        }
        return raw.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r");
    }
}
