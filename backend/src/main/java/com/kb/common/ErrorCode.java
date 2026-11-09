package com.kb.common;

import org.springframework.http.HttpStatus;

/** API.md §0.2 错误码表，唯一真源。 */
public enum ErrorCode {
    VALIDATION_FAILED(HttpStatus.BAD_REQUEST, "参数校验失败"),
    UNAUTHORIZED(HttpStatus.UNAUTHORIZED, "未登录或会话已过期"),
    FORBIDDEN(HttpStatus.FORBIDDEN, "无权访问该资源"),
    NOT_FOUND(HttpStatus.NOT_FOUND, "资源不存在"),
    CONFLICT(HttpStatus.CONFLICT, "资源冲突"),
    METHOD_NOT_ALLOWED(HttpStatus.METHOD_NOT_ALLOWED, "请求方法不支持"),
    PAYLOAD_TOO_LARGE(HttpStatus.CONTENT_TOO_LARGE, "请求体过大"),
    UNSUPPORTED_MEDIA_TYPE(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "不支持的内容类型"),
    TOO_MANY_REQUESTS(HttpStatus.TOO_MANY_REQUESTS, "请求过于频繁"),
    INTERNAL(HttpStatus.INTERNAL_SERVER_ERROR, "服务端异常");

    private final HttpStatus status;
    private final String defaultMessage;

    ErrorCode(HttpStatus status, String defaultMessage) {
        this.status = status;
        this.defaultMessage = defaultMessage;
    }

    public HttpStatus status() {
        return status;
    }

    public int httpStatus() {
        return status.value();
    }

    public String defaultMessage() {
        return defaultMessage;
    }
}
