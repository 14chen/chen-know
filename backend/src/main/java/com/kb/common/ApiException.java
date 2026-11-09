package com.kb.common;

/** 业务异常。消息会原样返回给客户端，因此不得包含内部实现细节。 */
public class ApiException extends RuntimeException {

    private final ErrorCode code;
    private final String field;

    public ApiException(ErrorCode code, String message) {
        this(code, message, null);
    }

    public ApiException(ErrorCode code, String message, String field) {
        super(message);
        this.code = code;
        this.field = field;
    }

    public ErrorCode code() {
        return code;
    }

    public String field() {
        return field;
    }

    public static ApiException validation(String message, String field) {
        return new ApiException(ErrorCode.VALIDATION_FAILED, message, field);
    }

    public static ApiException unauthorized(String message) {
        return new ApiException(ErrorCode.UNAUTHORIZED, message);
    }

    public static ApiException forbidden(String message) {
        return new ApiException(ErrorCode.FORBIDDEN, message);
    }

    public static ApiException notFound(String message) {
        return new ApiException(ErrorCode.NOT_FOUND, message);
    }

    public static ApiException conflict(String message) {
        return new ApiException(ErrorCode.CONFLICT, message);
    }

    public static ApiException tooManyRequests(String message) {
        return new ApiException(ErrorCode.TOO_MANY_REQUESTS, message);
    }
}
