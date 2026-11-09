package com.kb.common;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.validation.BindException;
import org.springframework.validation.FieldError;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/** 全局异常 → API.md §0.2 错误模型。任何情况下都不把异常堆栈返回给客户端。 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ApiErrorResponse> handleApiException(ApiException ex) {
        ErrorCode code = ex.code();
        String message = ex.getMessage() == null || ex.getMessage().isBlank()
                ? code.defaultMessage()
                : ex.getMessage();
        if (code == ErrorCode.INTERNAL) {
            log.error("业务异常降级为 500: {}", message, ex);
        }
        return ResponseEntity.status(code.status())
                .body(ApiErrorResponse.of(code, message, ex.field()));
    }

    /** @Valid 作用于 @RequestBody / @ModelAttribute */
    @ExceptionHandler(BindException.class)
    public ResponseEntity<ApiErrorResponse> handleBindException(BindException ex) {
        FieldError fieldError = ex.getBindingResult().getFieldError();
        String field = fieldError == null ? null : fieldError.getField();
        String message = fieldError == null ? "参数校验失败" : fieldError.getDefaultMessage();
        return ResponseEntity.status(ErrorCode.VALIDATION_FAILED.status())
                .body(ApiErrorResponse.of(ErrorCode.VALIDATION_FAILED, message, field));
    }

    /** @Validated 作用于 @RequestParam / @PathVariable */
    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ApiErrorResponse> handleConstraintViolation(ConstraintViolationException ex) {
        String field = null;
        String message = "参数校验失败";
        for (ConstraintViolation<?> violation : ex.getConstraintViolations()) {
            field = violation.getPropertyPath() == null ? null : violation.getPropertyPath().toString();
            message = violation.getMessage();
            break;
        }
        return ResponseEntity.status(ErrorCode.VALIDATION_FAILED.status())
                .body(ApiErrorResponse.of(ErrorCode.VALIDATION_FAILED, message, field));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiErrorResponse> handleUnreadableBody(HttpMessageNotReadableException ex) {
        log.debug("请求体解析失败: {}", ex.getMessage());
        return ResponseEntity.status(ErrorCode.VALIDATION_FAILED.status())
                .body(ApiErrorResponse.of(ErrorCode.VALIDATION_FAILED, "请求体不是合法的 JSON", "body"));
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<ApiErrorResponse> handleMissingParameter(MissingServletRequestParameterException ex) {
        return ResponseEntity.status(ErrorCode.VALIDATION_FAILED.status())
                .body(ApiErrorResponse.of(ErrorCode.VALIDATION_FAILED,
                        "缺少必需参数 " + ex.getParameterName(), ex.getParameterName()));
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ApiErrorResponse> handleTypeMismatch(MethodArgumentTypeMismatchException ex) {
        return ResponseEntity.status(ErrorCode.VALIDATION_FAILED.status())
                .body(ApiErrorResponse.of(ErrorCode.VALIDATION_FAILED,
                        "参数 " + ex.getName() + " 类型不正确", ex.getName()));
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<ApiErrorResponse> handleUploadTooLarge(MaxUploadSizeExceededException ex) {
        return ResponseEntity.status(ErrorCode.PAYLOAD_TOO_LARGE.status())
                .body(ApiErrorResponse.of(ErrorCode.PAYLOAD_TOO_LARGE, "上传内容超出大小限制"));
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<ApiErrorResponse> handleUnsupportedMediaType(HttpMediaTypeNotSupportedException ex) {
        return ResponseEntity.status(ErrorCode.UNSUPPORTED_MEDIA_TYPE.status())
                .body(ApiErrorResponse.of(ErrorCode.UNSUPPORTED_MEDIA_TYPE, "不支持的内容类型"));
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ApiErrorResponse> handleMethodNotSupported(HttpRequestMethodNotSupportedException ex) {
        return ResponseEntity.status(ErrorCode.METHOD_NOT_ALLOWED.status())
                .body(ApiErrorResponse.of(ErrorCode.METHOD_NOT_ALLOWED,
                        "该路径不支持 " + ex.getMethod() + " 方法"));
    }

    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ApiErrorResponse> handleNoResource(NoResourceFoundException ex) {
        return ResponseEntity.status(ErrorCode.NOT_FOUND.status())
                .body(ApiErrorResponse.of(ErrorCode.NOT_FOUND, "接口不存在"));
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ApiErrorResponse> handleAccessDenied(AccessDeniedException ex) {
        return ResponseEntity.status(ErrorCode.FORBIDDEN.status())
                .body(ApiErrorResponse.of(ErrorCode.FORBIDDEN, "无权访问该资源"));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiErrorResponse> handleUnexpected(Exception ex) {
        log.error("未处理异常", ex);
        return ResponseEntity.status(ErrorCode.INTERNAL.status())
                .body(ApiErrorResponse.of(ErrorCode.INTERNAL, "服务端异常"));
    }
}
