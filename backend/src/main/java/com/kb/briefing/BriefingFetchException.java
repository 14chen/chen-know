package com.kb.briefing;

/** 单源抓取/解析失败。消息会原样写进简报末尾的「本次未取到」与 run 的 sourceReport。 */
public class BriefingFetchException extends RuntimeException {

    public BriefingFetchException(String message) {
        super(message);
    }

    public BriefingFetchException(String message, Throwable cause) {
        super(message, cause);
    }
}
