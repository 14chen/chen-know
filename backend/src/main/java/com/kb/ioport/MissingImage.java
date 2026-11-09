package com.kb.ioport;

/**
 * API.md §10 / IMPORT-IMAGES.md §6.2：导入时未命中或无法上传的图片引用，逐条报告给前端。
 *
 * @param reason 取值见契约：{@code 文件集合里没有这个路径} / {@code 路径非法} /
 *               {@code 不支持的图片类型} / {@code 暂不支持引用式写法} / {@code 超过单文件上限}
 */
public record MissingImage(String sourceFile, String title, int line, String target, String reason) {

    static final String REASON_NOT_FOUND = "文件集合里没有这个路径";
    static final String REASON_ILLEGAL_PATH = "路径非法";
    static final String REASON_UNSUPPORTED_TYPE = "不支持的图片类型";
    static final String REASON_REFERENCE_STYLE = "暂不支持引用式写法";
    static final String REASON_TOO_LARGE = "超过单文件上限";
}
