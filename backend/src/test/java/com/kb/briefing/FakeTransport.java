package com.kb.briefing;

/** 测试专用传输层：固定响应 / 固定失败，永远不发真实网络请求。 */
final class FakeTransport implements HttpTransport {

    private final String body;
    private final String failure;

    private FakeTransport(String body, String failure) {
        this.body = body;
        this.failure = failure;
    }

    static FakeTransport body(String body) {
        return new FakeTransport(body, null);
    }

    static FakeTransport failing(String message) {
        return new FakeTransport(null, message);
    }

    @Override
    public String get(String url) {
        return get(url, "text/html");
    }

    @Override
    public String get(String url, String accept) {
        if (failure != null) {
            throw new BriefingFetchException(failure);
        }
        return body;
    }
}
