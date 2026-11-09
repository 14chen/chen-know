package com.kb.common;

import com.fasterxml.jackson.annotation.JsonInclude;

/** API.md §0.2：{@code { "error": { "code", "message", "field" } }}，field 可选。 */
public record ApiErrorResponse(Error error) {

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Error(String code, String message, String field) {

        public static Error of(ErrorCode code, String message, String field) {
            return new Error(code.name(), message, field);
        }
    }

    public static ApiErrorResponse of(ErrorCode code, String message) {
        return of(code, message, null);
    }

    public static ApiErrorResponse of(ErrorCode code, String message, String field) {
        return new ApiErrorResponse(Error.of(code, message, field));
    }
}
