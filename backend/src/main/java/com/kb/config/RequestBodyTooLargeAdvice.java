package com.kb.config;

import com.kb.common.ApiErrorResponse;
import com.kb.common.ErrorCode;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * 把「读取途中超过上限」还原成 413。
 *
 * <p>计数流是在 Jackson 读 body 的过程中中断请求的，抛出的异常通常会被消息转换器包装成
 * {@link HttpMessageNotReadableException}（表现为 400 VALIDATION_FAILED）；
 * 这里优先于通用异常处理器检查因果链，命中则回 413 PAYLOAD_TOO_LARGE。
 *
 * <p>未命中时保持与 {@code com.kb.common.GlobalExceptionHandler} 完全一致的 400 行为。
 */
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestBodyTooLargeAdvice {

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiErrorResponse> handleUnreadableBody(HttpMessageNotReadableException ex) {
        Throwable cause = ex;
        while (cause != null) {
            if (cause instanceof RequestBodyTooLargeException tooLarge) {
                return ResponseEntity.status(ErrorCode.PAYLOAD_TOO_LARGE.status())
                        .body(ApiErrorResponse.of(ErrorCode.PAYLOAD_TOO_LARGE, tooLarge.getMessage()));
            }
            cause = cause.getCause();
        }
        return ResponseEntity.status(ErrorCode.VALIDATION_FAILED.status())
                .body(ApiErrorResponse.of(ErrorCode.VALIDATION_FAILED, "请求体不是合法的 JSON", "body"));
    }
}
