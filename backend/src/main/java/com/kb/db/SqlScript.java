package com.kb.db;

import java.util.ArrayList;
import java.util.List;

/**
 * 把 .sql 脚本切成可逐条执行的语句。
 *
 * <p>Spring 的 {@code ScriptUtils} 按裸分号切分，会把 FTS5 触发器
 * （{@code CREATE TRIGGER ... BEGIN INSERT ...; END;}）切坏，因此这里自己实现：
 * <ul>
 *   <li>单引号字符串、双引号标识符内的分号不算分隔符</li>
 *   <li>{@code BEGIN ... END} 块内的分号不算分隔符（以词为单位匹配，忽略大小写）</li>
 *   <li>注释（{@code --} 行注释、{@code /* *}{@code /} 块注释）被剥离，不产出纯注释“语句”</li>
 * </ul>
 */
public final class SqlScript {

    private enum State {
        NORMAL, SINGLE_QUOTE, DOUBLE_QUOTE, LINE_COMMENT, BLOCK_COMMENT
    }

    private SqlScript() {
    }

    public static List<String> split(String script) {
        List<String> statements = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        State state = State.NORMAL;
        int blockDepth = 0;
        int i = 0;
        int n = script.length();
        while (i < n) {
            char c = script.charAt(i);
            switch (state) {
                case NORMAL -> {
                    if (c == '\'') {
                        state = State.SINGLE_QUOTE;
                        current.append(c);
                        i++;
                    } else if (c == '"') {
                        state = State.DOUBLE_QUOTE;
                        current.append(c);
                        i++;
                    } else if (c == '-' && i + 1 < n && script.charAt(i + 1) == '-') {
                        state = State.LINE_COMMENT;
                        i += 2;
                    } else if (c == '/' && i + 1 < n && script.charAt(i + 1) == '*') {
                        state = State.BLOCK_COMMENT;
                        i += 2;
                    } else if (c == ';') {
                        if (blockDepth == 0) {
                            flush(current, statements);
                        } else {
                            current.append(c);
                        }
                        i++;
                    } else if (isWordChar(c)) {
                        int start = i;
                        while (i < n && isWordChar(script.charAt(i))) {
                            i++;
                        }
                        String word = script.substring(start, i);
                        if (word.equalsIgnoreCase("BEGIN")) {
                            blockDepth++;
                        } else if (word.equalsIgnoreCase("END")) {
                            blockDepth = Math.max(0, blockDepth - 1);
                        }
                        current.append(word);
                    } else {
                        current.append(c);
                        i++;
                    }
                }
                case SINGLE_QUOTE -> {
                    current.append(c);
                    if (c == '\'') {
                        if (i + 1 < n && script.charAt(i + 1) == '\'') {
                            current.append('\'');
                            i += 2;
                        } else {
                            state = State.NORMAL;
                            i++;
                        }
                    } else {
                        i++;
                    }
                }
                case DOUBLE_QUOTE -> {
                    current.append(c);
                    if (c == '"') {
                        if (i + 1 < n && script.charAt(i + 1) == '"') {
                            current.append('"');
                            i += 2;
                        } else {
                            state = State.NORMAL;
                            i++;
                        }
                    } else {
                        i++;
                    }
                }
                case LINE_COMMENT -> {
                    if (c == '\n') {
                        state = State.NORMAL;
                        current.append('\n');
                    }
                    i++;
                }
                case BLOCK_COMMENT -> {
                    if (c == '*' && i + 1 < n && script.charAt(i + 1) == '/') {
                        state = State.NORMAL;
                        i += 2;
                    } else {
                        i++;
                    }
                }
            }
        }
        flush(current, statements);
        return statements;
    }

    private static void flush(StringBuilder current, List<String> statements) {
        String sql = current.toString().trim();
        if (!sql.isEmpty()) {
            statements.add(sql);
        }
        current.setLength(0);
    }

    private static boolean isWordChar(char c) {
        return Character.isLetterOrDigit(c) || c == '_';
    }
}
