package com.kb.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.kb.common.ErrorResponses;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/** 请求体上限过滤器的判定逻辑（不启动 Spring 上下文）。 */
class RequestBodySizeLimitFilterTest {

    private static final int MEGABYTE = 1024 * 1024;

    private final RequestBodySizeLimitFilter filter =
            new RequestBodySizeLimitFilter(new ErrorResponses());

    private static byte[] jsonBody(int sizeBytes) {
        StringBuilder builder = new StringBuilder(sizeBytes + 32);
        builder.append("{\"content\":\"");
        for (int i = 0; i < sizeBytes; i++) {
            builder.append('a');
        }
        builder.append("\"}");
        return builder.toString().getBytes(StandardCharsets.UTF_8);
    }

    private static MockHttpServletRequest request(String contentType, byte[] body) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/notes");
        request.setContentType(contentType);
        request.setContent(body);
        return request;
    }

    /** 覆盖 Content-Length 的取值，用来分别模拟「声明了长度」与「chunked（无长度）」两种情况。 */
    private static HttpServletRequest withDeclaredLength(HttpServletRequest request, long declaredLength) {
        return new HttpServletRequestWrapper(request) {
            @Override
            public long getContentLengthLong() {
                return declaredLength;
            }
        };
    }

    /** 模拟 Jackson 读 body：整段读完；异常原样向上抛（与真实调用链一致）。 */
    private static FilterChain readingChain(AtomicBoolean invoked) {
        return (request, response) -> {
            invoked.set(true);
            try (ServletInputStream in = request.getInputStream()) {
                in.transferTo(OutputStream.nullOutputStream());
            }
        };
    }

    @Test
    @DisplayName("multipart 不受本限制约束（由 multipart 配置管），即使声明 9MB 也放行")
    void multipartIsExempt() throws Exception {
        AtomicBoolean invoked = new AtomicBoolean(false);
        MockHttpServletRequest request = request("multipart/form-data; boundary=----x", jsonBody(MEGABYTE));
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(withDeclaredLength(request, 9L * MEGABYTE), response, readingChain(invoked));

        assertTrue(invoked.get(), "multipart 请求应放行");
        assertFalse(response.getContentAsString().contains("PAYLOAD_TOO_LARGE"), response.getContentAsString());
    }

    @Test
    @DisplayName("声明的 Content-Length 超过 8MB → 立刻 413，且下游连一个字节都不读")
    void declaredLengthOverLimitIsRejectedBeforeChain() throws Exception {
        AtomicBoolean invoked = new AtomicBoolean(false);
        MockHttpServletRequest request = request("application/json", jsonBody(MEGABYTE));
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(withDeclaredLength(request, 9L * MEGABYTE), response, readingChain(invoked));

        assertFalse(invoked.get(), "超限时不应进入下游过滤器");
        assertEquals(413, response.getStatus());
        String body = response.getContentAsString();
        assertTrue(body.contains("\"code\":\"PAYLOAD_TOO_LARGE\""), body);
        assertTrue(body.contains("\"error\""), body);
    }

    @Test
    @DisplayName("声明长度在上限内 → 正常放行")
    void declaredLengthWithinLimitPassesThrough() throws Exception {
        AtomicBoolean invoked = new AtomicBoolean(false);
        MockHttpServletRequest request = request("application/json", jsonBody(1024));
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(withDeclaredLength(request, 1024), response, readingChain(invoked));

        assertTrue(invoked.get(), "未超限应放行");
        assertEquals(200, response.getStatus());
    }

    @Test
    @DisplayName("没有 Content-Length 但 body 在上限内 → 放行且 body 内容完整")
    void chunkedWithinLimitPassesBodyThroughIntact() throws Exception {
        byte[] body = jsonBody(MEGABYTE);
        MockHttpServletRequest request = request("application/json", body);
        MockHttpServletResponse response = new MockHttpServletResponse();
        byte[][] seen = new byte[1][];

        filter.doFilter(withDeclaredLength(request, -1), response, (req, res) -> {
            try (ServletInputStream in = req.getInputStream()) {
                seen[0] = in.readAllBytes();
            }
        });

        assertEquals(200, response.getStatus());
        assertEquals(body.length, seen[0].length, "包装后的流不能改变 body 内容");
        assertEquals(new String(body, StandardCharsets.UTF_8), new String(seen[0], StandardCharsets.UTF_8));
    }

    @Test
    @DisplayName("没有 Content-Length（chunked）且读到超过 8MB → 中断并返回 413")
    void chunkedOverLimitIsInterruptedWith413() throws Exception {
        AtomicBoolean invoked = new AtomicBoolean(false);
        MockHttpServletRequest request = request("application/json", jsonBody(9 * MEGABYTE));
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(withDeclaredLength(request, -1), response, readingChain(invoked));

        assertTrue(invoked.get(), "已进入下游，限制是在读取过程中生效的");
        assertEquals(413, response.getStatus());
        assertTrue(response.getContentAsString().contains("\"code\":\"PAYLOAD_TOO_LARGE\""),
                response.getContentAsString());
    }

    @Test
    @DisplayName("多次取流共享同一个计数：不能靠两次各读一半来绕过（累计 10MB > 8MB 必须拒绝）")
    void countingIsSharedAcrossGetInputStreamCalls() throws Exception {
        MockHttpServletRequest request = request("application/json", jsonBody(10 * MEGABYTE));
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(withDeclaredLength(request, -1), response, (req, res) -> {
            // 两次各读 6MB：单看每次都没超 8MB，但累计读了 10MB
            for (int i = 0; i < 2; i++) {
                try (ServletInputStream in = req.getInputStream()) {
                    in.readNBytes(6 * MEGABYTE);
                }
            }
        });

        assertEquals(413, response.getStatus(), "重复取流应累计计数");
    }

    @Test
    @DisplayName("上游把超限异常吞掉时，过滤器兜底仍返回 413")
    void filterStillAnswers413WhenUpstreamSwallowsTheException() throws Exception {
        MockHttpServletRequest request = request("application/json", jsonBody(9 * MEGABYTE));
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(withDeclaredLength(request, -1), response, (req, res) -> {
            try (ServletInputStream in = req.getInputStream()) {
                in.transferTo(OutputStream.nullOutputStream());
            } catch (RuntimeException swallowed) {
                // 故意吞掉
            }
        });

        assertEquals(413, response.getStatus());
    }

    @Test
    @DisplayName("GET 等无 body 请求不受影响")
    void requestsWithoutBodyAreUntouched() throws Exception {
        AtomicBoolean invoked = new AtomicBoolean(false);
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/health");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, readingChain(invoked));

        assertTrue(invoked.get());
        assertEquals(200, response.getStatus());
    }

    @Test
    @DisplayName("返回值语义：413 时响应体是统一错误格式，且带 error.code")
    void errorBodyShape() throws Exception {
        MockHttpServletRequest request = request("application/json", jsonBody(1024));
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(withDeclaredLength(request, 9L * MEGABYTE), response, (req, res) -> {
        });

        assertEquals(true, response.getContentType().startsWith("application/json"), response.getContentType());
        assertTrue(response.getContentAsString().startsWith("{\"error\":{\"code\":\"PAYLOAD_TOO_LARGE\""),
                response.getContentAsString());
    }
}
