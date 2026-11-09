package com.kb.common;

import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/**
 * 统一写错误响应体。Spring Security 的过滤器链在 {@code @RestControllerAdvice} 之外，
 * 因此入口点/拒绝处理器与全局异常处理器共用这里的写法，保证 JSON 形状完全一致。
 *
 * <p>用私有 JsonMapper 而不是应用级 ObjectMapper：错误响应的形状属于对外契约，
 * 不能被业务侧对 Jackson 的定制（命名策略等）影响。
 */
@Component
public class ErrorResponses {

    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    public void write(HttpServletResponse response, ErrorCode code, String message) throws IOException {
        write(response, code, message, null);
    }

    public void write(HttpServletResponse response, ErrorCode code, String message, String field)
            throws IOException {
        if (response.isCommitted()) {
            return;
        }
        response.setStatus(code.httpStatus());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        MAPPER.writeValue(response.getOutputStream(), ApiErrorResponse.of(code, message, field));
    }
}
