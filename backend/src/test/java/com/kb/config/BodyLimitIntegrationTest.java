package com.kb.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

/**
 * 请求体上限的端到端验证（走真实 Spring Security 过滤器链 + 真实业务端点）。
 *
 * <p>API.md §4.4：非 multipart 请求体 ≤ 8 MB，超出 413 {@code PAYLOAD_TOO_LARGE}。
 */
@SpringBootTest
@AutoConfigureMockMvc
class BodyLimitIntegrationTest {

    private static final int MEGABYTE = 1024 * 1024;
    private static final String USER = "sizecheck";
    private static final String PASSWORD = "sizeCheckPass123";

    private static final Path DATA_DIR = createDataDir();
    private static MockHttpSession session;

    @DynamicPropertySource
    static void dataDirectory(DynamicPropertyRegistry registry) {
        registry.add("kb.data-dir", DATA_DIR::toString);
    }

    private static Path createDataDir() {
        try {
            return Files.createTempDirectory("kb-body-limit-");
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @Autowired
    private MockMvc mockMvc;

    /** 注册（首个用户自动成为 admin）并登录，整个类共用一个会话。 */
    private MockHttpSession session() throws Exception {
        if (session == null) {
            mockMvc.perform(post("/api/auth/register")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(("{\"username\":\"" + USER + "\",\"displayName\":\"体检查\",\"password\":\""
                                    + PASSWORD + "\"}").getBytes(StandardCharsets.UTF_8)))
                    .andExpect(status().isCreated());
            MvcResult result = mockMvc.perform(post("/api/auth/login")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(("{\"username\":\"" + USER + "\",\"password\":\"" + PASSWORD + "\"}")
                                    .getBytes(StandardCharsets.UTF_8)))
                    .andExpect(status().isOk())
                    .andReturn();
            session = (MockHttpSession) result.getRequest().getSession(false);
            assertNotNull(session, "登录后应建立会话");
        }
        return session;
    }

    /** {@code {"title":"t","content":"aaa…"}}，content 达到 contentBytes 字节。 */
    private static byte[] noteJson(int contentBytes) {
        return noteJsonWithTotalSize(-1, contentBytes);
    }

    /** 整个 JSON body 恰好 totalBytes 字节（用于边界断言）；totalBytes < 0 时按 contentBytes 生成。 */
    private static byte[] noteJsonWithTotalSize(int totalBytes, int contentBytes) {
        String prefix = "{\"title\":\"大小检查\",\"content\":\"";
        String suffix = "\"}";
        int prefixLength = prefix.getBytes(StandardCharsets.UTF_8).length;
        int suffixLength = suffix.getBytes(StandardCharsets.UTF_8).length;
        int fill = totalBytes > 0 ? totalBytes - prefixLength - suffixLength : contentBytes;
        StringBuilder builder = new StringBuilder(Math.max(fill, 0) + prefixLength + suffixLength);
        builder.append(prefix);
        for (int i = 0; i < fill; i++) {
            builder.append('a');
        }
        builder.append(suffix);
        return builder.toString().getBytes(StandardCharsets.UTF_8);
    }

    private ResultActions postNote(byte[] body, MockHttpSession session, Long declaredContentLength) throws Exception {
        var builder = post("/api/notes")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body);
        if (declaredContentLength != null) {
            builder = builder.header(HttpHeaders.CONTENT_LENGTH, declaredContentLength);
        }
        if (session != null) {
            builder = builder.session(session);
        }
        return mockMvc.perform(builder);
    }

    @Test
    @DisplayName("未登录 + 9MB JSON → 413（说明限制在鉴权之前生效，不是先 401）")
    void anonymousOversizedBodyIsRejected() throws Exception {
        postNote(noteJson(9 * MEGABYTE), null, 9L * MEGABYTE)
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.error.code").value("PAYLOAD_TOO_LARGE"))
                .andExpect(jsonPath("$.error.message").isNotEmpty());
    }

    @Test
    @DisplayName("已登录 + 9MB JSON → 413")
    void authenticatedOversizedBodyIsRejected() throws Exception {
        postNote(noteJson(9 * MEGABYTE), session(), 9L * MEGABYTE)
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.error.code").value("PAYLOAD_TOO_LARGE"));
    }

    @Test
    @DisplayName("未声明 Content-Length（chunked 场景）的超大 body 同样 413，不能放行")
    void oversizedBodyWithoutDeclaredLengthIsRejected() throws Exception {
        postNote(noteJson(9 * MEGABYTE), session(), null)
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.error.code").value("PAYLOAD_TOO_LARGE"));
    }

    @Test
    @DisplayName("1MB body 不被误拦 → 正常创建 201")
    void oneMegabyteBodyIsAccepted() throws Exception {
        postNote(noteJson(MEGABYTE), session(), null)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.title").value("大小检查"));
    }

    @Test
    @DisplayName("正好 8MB 的 body 不在拒绝范围内（边界是「超过 8MB」）")
    void exactlyAtLimitIsNotRejectedBySizeFilter() throws Exception {
        byte[] body = noteJsonWithTotalSize(8 * MEGABYTE, 0);
        assertEquals(8 * MEGABYTE, body.length, "构造出来的 body 必须正好 8MB");
        // 8MB 正文超过了笔记自身的 2MB 上限，所以这里期待 400；关键是不能是 413
        postNote(body, session(), null)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
    }

    @Test
    @DisplayName("multipart 上传不受 8MB 限制（由 multipart 配置管）→ 201")
    void multipartUploadIsUnaffected() throws Exception {
        mockMvc.perform(multipart("/api/attachments")
                        .file(new MockMultipartFile("file", "tiny.png", "image/png", tinyPng()))
                        .session(session()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.mimeType").value("image/png"))
                .andExpect(jsonPath("$.url").isNotEmpty());
    }

    /** 真实可解析的 1x1 PNG（避免手写魔数出错）。 */
    private static byte[] tinyPng() throws IOException {
        BufferedImage image = new BufferedImage(1, 1, BufferedImage.TYPE_INT_ARGB);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(image, "png", out);
        return out.toByteArray();
    }
}
