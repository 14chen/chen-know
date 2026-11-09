package com.kb.briefing;

import java.time.Duration;

/**
 * BRIEFING.md §5：HTTP 抓取的注入点。单元测试用会抛异常的 fake 实现，
 * 任何测试都不得真的发网络请求。
 */
public interface HttpTransport {

    /** @throws BriefingFetchException 失败原因要具体（超时 / HTTP 码 / 证书 / 连接 / 解析失败 / 0 条） */
    String get(String url);

    /** 带 Accept 偏好的抓取（RSS 源要 XML、HTML 源要 HTML、HN 要 JSON）。 */
    String get(String url, String accept);

    /**
     * 带「单次尝试超时」的抓取：慢源用更宽松的超时。
     * 默认实现忽略它，方便测试替身只实现前两个方法。
     */
    default String get(String url, String accept, Duration attemptTimeout) {
        return get(url, accept);
    }

    /**
     * 表单 POST（DeepL 这类需要 POST 的接口）。默认不支持，测试替身可按需覆盖。
     *
     * @param body 已经 urlencode 好的表单体（如 {@code text=..&target_lang=ZH}）
     */
    default String post(String url, java.util.Map<String, String> headers, String body,
            Duration attemptTimeout) {
        throw new BriefingFetchException("该传输层不支持 POST");
    }

    /**
     * 原始字节（下载配图用）。默认不支持，测试替身可按需覆盖。
     *
     * @throws BriefingFetchException 不支持 / 下载失败 / 超过大小上限
     */
    default byte[] getBytes(String url, Duration attemptTimeout) {
        throw new BriefingFetchException("该传输层不支持二进制下载");
    }
}
