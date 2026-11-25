package com.kb.briefing;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 极简 JSON 读写。只服务两处：Hacker News 的 Algolia 响应解析，以及 sourceReport 的落库/回读。
 * 刻意不引入新依赖（BRIEFING.md §5）。
 */
public final class MiniJson {

    private static final char QUOTE = '"';
    private static final char BACKSLASH = 92;
    private static final char OPEN_BRACE = '{';
    private static final char CLOSE_BRACE = '}';
    private static final char OPEN_BRACKET = '[';
    private static final char CLOSE_BRACKET = ']';

    private MiniJson() {
    }

    public static Object parse(String text) {
        Parser parser = new Parser(text == null ? "" : text);
        parser.skipWhitespace();
        Object value = parser.value();
        parser.skipWhitespace();
        if (!parser.atEnd()) {
            throw new IllegalArgumentException("JSON 尾部有多余内容");
        }
        return value;
    }

    public static String write(Object value) {
        StringBuilder out = new StringBuilder();
        writeValue(value, out);
        return out.toString();
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> asObject(Object value) {
        return value instanceof Map ? (Map<String, Object>) value : Map.of();
    }

    @SuppressWarnings("unchecked")
    public static List<Object> asArray(Object value) {
        return value instanceof List ? (List<Object>) value : List.of();
    }

    public static String string(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    public static Integer integer(Object value) {
        if (value instanceof Number number) {
            return number.intValue();
        }
        if (value instanceof String text) {
            try {
                return Integer.valueOf(text.trim());
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return null;
    }

    private static void writeValue(Object value, StringBuilder out) {
        if (value == null) {
            out.append("null");
            return;
        }
        if (value instanceof String text) {
            quote(text, out);
            return;
        }
        if (value instanceof Boolean || value instanceof Number) {
            out.append(value);
            return;
        }
        if (value instanceof Map<?, ?> map) {
            out.append(OPEN_BRACE);
            boolean first = true;
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (!first) {
                    out.append(',');
                }
                first = false;
                quote(String.valueOf(entry.getKey()), out);
                out.append(':');
                writeValue(entry.getValue(), out);
            }
            out.append(CLOSE_BRACE);
            return;
        }
        if (value instanceof Iterable<?> iterable) {
            out.append(OPEN_BRACKET);
            boolean first = true;
            for (Object element : iterable) {
                if (!first) {
                    out.append(',');
                }
                first = false;
                writeValue(element, out);
            }
            out.append(CLOSE_BRACKET);
            return;
        }
        quote(String.valueOf(value), out);
    }

    private static void quote(String text, StringBuilder out) {
        out.append(QUOTE);
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == QUOTE) {
                out.append(BACKSLASH).append(QUOTE);
            } else if (c == BACKSLASH) {
                out.append(BACKSLASH).append(BACKSLASH);
            } else if (c == 10) {
                out.append(BACKSLASH).append('n');
            } else if (c == 13) {
                out.append(BACKSLASH).append('r');
            } else if (c == 9) {
                out.append(BACKSLASH).append('t');
            } else if (c < 0x20) {
                out.append(BACKSLASH).append('u').append(String.format("%04x", (int) c));
            } else {
                out.append(c);
            }
        }
        out.append(QUOTE);
    }

    private static final class Parser {

        private final String text;
        private int pos;
        private int depth;
        private static final int MAX_DEPTH = 64;

        Parser(String text) {
            this.text = text;
        }

        boolean atEnd() {
            return pos >= text.length();
        }

        void skipWhitespace() {
            while (pos < text.length() && Character.isWhitespace(text.charAt(pos))) {
                pos++;
            }
        }

        Object value() {
            if (++depth > MAX_DEPTH) {
                throw new IllegalArgumentException("JSON 嵌套过深（上限 " + MAX_DEPTH + "）");
            }
            try {
                skipWhitespace();
                if (atEnd()) {
                    throw new IllegalArgumentException("JSON 意外结束");
                }
                char c = text.charAt(pos);
                if (c == OPEN_BRACE) {
                    return object();
                }
                if (c == OPEN_BRACKET) {
                    return array();
                }
                if (c == QUOTE) {
                    return string();
                }
                if (c == 't') {
                    return literal("true", Boolean.TRUE);
                }
                if (c == 'f') {
                    return literal("false", Boolean.FALSE);
                }
                if (c == 'n') {
                    return literal("null", null);
                }
                return number();
            } finally {
                depth--;
            }
        }

        private Map<String, Object> object() {
            Map<String, Object> map = new LinkedHashMap<>();
            pos++;
            skipWhitespace();
            if (peek() == CLOSE_BRACE) {
                pos++;
                return map;
            }
            while (true) {
                skipWhitespace();
                String key = string();
                skipWhitespace();
                expect(':');
                map.put(key, value());
                skipWhitespace();
                char c = next();
                if (c == CLOSE_BRACE) {
                    return map;
                }
                if (c != ',') {
                    throw new IllegalArgumentException("JSON 对象缺少逗号");
                }
            }
        }

        private List<Object> array() {
            List<Object> list = new ArrayList<>();
            pos++;
            skipWhitespace();
            if (peek() == CLOSE_BRACKET) {
                pos++;
                return list;
            }
            while (true) {
                list.add(value());
                skipWhitespace();
                char c = next();
                if (c == CLOSE_BRACKET) {
                    return list;
                }
                if (c != ',') {
                    throw new IllegalArgumentException("JSON 数组缺少逗号");
                }
            }
        }

        private String string() {
            expect(QUOTE);
            StringBuilder out = new StringBuilder();
            while (true) {
                char c = next();
                if (c == QUOTE) {
                    return out.toString();
                }
                if (c != BACKSLASH) {
                    out.append(c);
                    continue;
                }
                char escaped = next();
                if (escaped == QUOTE) {
                    out.append(QUOTE);
                } else if (escaped == BACKSLASH) {
                    out.append(BACKSLASH);
                } else if (escaped == '/') {
                    out.append('/');
                } else if (escaped == 'b') {
                    out.append((char) 8);
                } else if (escaped == 'f') {
                    out.append((char) 12);
                } else if (escaped == 'n') {
                    out.append((char) 10);
                } else if (escaped == 'r') {
                    out.append((char) 13);
                } else if (escaped == 't') {
                    out.append((char) 9);
                } else if (escaped == 'u') {
                    if (pos + 4 > text.length()) {
                        throw new IllegalArgumentException("JSON 非法 unicode 转义");
                    }
                    int code = Integer.parseInt(text.substring(pos, pos + 4), 16);
                    pos += 4;
                    // UTF-16 代理对：emoji/罕用字必须合并成一个码点，否则会输出两个乱码字符
                    if (code >= 0xD800 && code <= 0xDBFF && pos + 6 <= text.length()
                            && text.charAt(pos) == '\\' && text.charAt(pos + 1) == 'u') {
                        int low = Integer.parseInt(text.substring(pos + 2, pos + 6), 16);
                        if (low >= 0xDC00 && low <= 0xDFFF) {
                            out.appendCodePoint(Character.toCodePoint((char) code, (char) low));
                            pos += 6;
                            continue;
                        }
                    }
                    out.append((char) code);
                } else {
                    throw new IllegalArgumentException("JSON 非法转义");
                }
            }
        }

        private Object number() {
            int start = pos;
            while (pos < text.length() && "+-.eE0123456789".indexOf(text.charAt(pos)) >= 0) {
                pos++;
            }
            if (start == pos) {
                throw new IllegalArgumentException("JSON 非法字面量");
            }
            String raw = substring(start, pos);
            if (raw.indexOf('.') >= 0 || raw.indexOf('e') >= 0 || raw.indexOf('E') >= 0) {
                return Double.valueOf(raw);
            }
            return Long.valueOf(raw);
        }

        private Object literal(String word, Object value) {
            if (!text.startsWith(word, pos)) {
                throw new IllegalArgumentException("JSON 非法字面量");
            }
            pos += word.length();
            return value;
        }

        private char peek() {
            if (atEnd()) {
                throw new IllegalArgumentException("JSON 意外结束");
            }
            return text.charAt(pos);
        }

        private char next() {
            char c = peek();
            pos++;
            return c;
        }

        private void expect(char expected) {
            if (next() != expected) {
                throw new IllegalArgumentException("JSON 期望字符 " + expected);
            }
        }

        private String substring(int from, int to) {
            return text.substring(from, to);
        }
    }
}
