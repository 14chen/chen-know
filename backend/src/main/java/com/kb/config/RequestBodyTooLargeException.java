package com.kb.config;

import com.kb.common.ApiException;
import com.kb.common.ErrorCode;

/**
 * 请求体在读取过程中超过上限。继承 {@link ApiException}：
 * 未被包装时由 {@code GlobalExceptionHandler} 直接按 413 处理。
 *
 * <p>被 Jackson / Spring MVC 包装成 {@code HttpMessageNotReadableException} 的情况，
 * 由 {@link RequestBodyTooLargeAdvice} 顺着因果链还原成 413。
 */
class RequestBodyTooLargeException extends ApiException {

    RequestBodyTooLargeException(String message) {
        super(ErrorCode.PAYLOAD_TOO_LARGE, message);
    }
}
