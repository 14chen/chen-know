package com.kb.common;

import java.time.Instant;
import java.time.format.DateTimeFormatter;

/** SCHEMA §0：时间一律 TEXT，ISO-8601 UTC（{@code DateTimeFormatter.ISO_INSTANT}）。 */
public final class Times {

    private Times() {
    }

    public static String now() {
        return DateTimeFormatter.ISO_INSTANT.format(Instant.now());
    }

    public static String format(Instant instant) {
        return instant == null ? null : DateTimeFormatter.ISO_INSTANT.format(instant);
    }
}
