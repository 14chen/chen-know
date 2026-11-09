package com.kb.link;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** {@code [[标题]]} 解析规则（API.md §4）：必须忽略代码块与行内代码。 */
class LinkParserTest {

    @Test
    @DisplayName("按出现顺序解析 [[标题]]，并做大小写不敏感去重")
    void parsesInOrderAndDedupes() {
        assertEquals(List.of("笔记A", "笔记B"),
                LinkParser.parseTargets("先看 [[笔记A]]，再看 [[笔记B]]。"));
        assertEquals(List.of("Java"), LinkParser.parseTargets("[[Java]] 和 [[java]] 是同一篇"));
    }

    @Test
    @DisplayName("标题两侧空白被去掉，空标题忽略")
    void trimsAndSkipsEmpty() {
        assertEquals(List.of("目标"), LinkParser.parseTargets("[[  目标  ]]"));
        assertEquals(List.of(), LinkParser.parseTargets("[[]] [[   ]] [[]]"));
    }

    @Test
    @DisplayName("围栏代码块里的 [[ ]] 不产生链接")
    void ignoresFencedCodeBlocks() {
        String content = """
                正文 [[真链接]]

                ```java
                String x = "[[代码里的标题]]";
                ```

                ~~~
                [[另一种围栏]]
                ~~~
                """;
        assertEquals(List.of("真链接"), LinkParser.parseTargets(content));
    }

    @Test
    @DisplayName("行内代码里的 [[ ]] 不产生链接")
    void ignoresInlineCode() {
        assertEquals(List.of("真链接"),
                LinkParser.parseTargets("`[[行内代码]]` 与 [[真链接]] 一起出现"));
    }

    @Test
    @DisplayName("未闭合的方括号、超长标题不产生链接")
    void ignoresMalformed() {
        assertEquals(List.of(), LinkParser.parseTargets("[[没有闭合 和 [[a][b]] 之类"));
        assertEquals(List.of(), LinkParser.parseTargets("[[" + "x".repeat(300) + "]]"));
    }

    @Test
    @DisplayName("未闭合的围栏之后的内容整体忽略")
    void unterminatedFenceSwallowsRest() {
        assertEquals(List.of("前面"),
                LinkParser.parseTargets("[[前面]]\n```\n[[后面]]\n"));
    }
}
