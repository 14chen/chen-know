package com.kb.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import com.kb.common.ApiErrorResponse;
import com.kb.common.ErrorCode;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;

/** 计数流中断后异常被上层包装时，仍要还原成 413。 */
class RequestBodyTooLargeAdviceTest {

    private final RequestBodyTooLargeAdvice advice = new RequestBodyTooLargeAdvice();

    private static HttpMessageNotReadableException wrappedIn(Throwable deepest) {
        // Spring 7 的构造签名是 (String, Throwable, HttpInputMessage)
        return new HttpMessageNotReadableException("JSON parse error",
                new IllegalStateException("Jackson 包装", deepest), null);
    }

    @Test
    @DisplayName("因果链里有「请求体超限」→ 413 PAYLOAD_TOO_LARGE")
    void mapsWrappedTooLargeTo413() {
        ResponseEntity<ApiErrorResponse> response =
                advice.handleUnreadableBody(wrappedIn(new RequestBodyTooLargeException("请求体超过上限（8 MB）")));

        assertEquals(413, response.getStatusCode().value());
        ApiErrorResponse body = response.getBody();
        assertNotNull(body);
        assertEquals(ErrorCode.PAYLOAD_TOO_LARGE.name(), body.error().code());
        assertEquals("请求体超过上限（8 MB）", body.error().message());
    }

    @Test
    @DisplayName("直接抛出（未被包装）时同样 413")
    void mapsDirectTooLargeTo413() {
        ResponseEntity<ApiErrorResponse> response =
                advice.handleUnreadableBody(new HttpMessageNotReadableException("x",
                        new RequestBodyTooLargeException("请求体超过上限（8 MB）"), null));

        assertEquals(413, response.getStatusCode().value());
        assertEquals(ErrorCode.PAYLOAD_TOO_LARGE.name(), response.getBody().error().code());
    }

    @Test
    @DisplayName("与超限无关的坏 JSON 仍是 400，行为与通用处理器一致")
    void keepsPlainUnreadableBodyAs400() {
        ResponseEntity<ApiErrorResponse> response =
                advice.handleUnreadableBody(wrappedIn(new IllegalArgumentException("不是 JSON")));

        assertEquals(400, response.getStatusCode().value());
        ApiErrorResponse body = response.getBody();
        assertNotNull(body);
        assertEquals(ErrorCode.VALIDATION_FAILED.name(), body.error().code());
        assertEquals("body", body.error().field());
    }
}
