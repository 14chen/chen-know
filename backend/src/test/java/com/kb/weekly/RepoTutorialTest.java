package com.kb.weekly;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 傻瓜教程：只摘 README、散文按模板、取不到就诚实占位 —— 绝不编内容。 */
class RepoTutorialTest {

    /** 反引号围栏用常量拼，避免源码里出现三连反引号被误认成 Java 文本块。 */
    private static final String F = String.valueOf((char) 96).repeat(3);

    private static WeeklyRepo repo(String language) {
        return new WeeklyRepo("github", "acme/demo-tool", "https://github.com/acme/demo-tool", 1200L, 340,
                language, "一个把 Markdown 转成幻灯片的命令行工具。", "2026-11-08T10:00:00Z");
    }

    private static String readme() {
        return String.join("\n",
                "# Demo Tool",
                "",
                "A tiny tool that turns markdown into slides.",
                "",
                "## Installation",
                "",
                F + "bash",
                "npm install -g demo-tool",
                F,
                "",
                "## Usage",
                "",
                F + "bash",
                "demo-tool run --path ./input.md",
                F,
                "",
                "Requires Node 18 or newer.",
                "",
                "Set DEMO_API_KEY before running.",
                "");
    }

    @Test
    @DisplayName("完整 README：六段结构齐全，命令原样摘自 README 并标注来源")
    void rendersFullTutorial() {
        String markdown = RepoTutorial.render(repo("JavaScript"), "一个把 Markdown 转成幻灯片的命令行工具。",
                "https://raw.githubusercontent.com/acme/demo-tool/HEAD/README.md", readme(), 160);

        assertTrue(markdown.startsWith(RepoTutorial.HEADING), markdown);
        assertTrue(markdown.contains("### 0. 这是什么东西"), markdown);
        assertTrue(markdown.contains("### 1. 动手前先备好"), markdown);
        assertTrue(markdown.contains("### 2. 安装"), markdown);
        assertTrue(markdown.contains("### 3. 跑通第一个例子"), markdown);
        assertTrue(markdown.contains("### 4. 三个容易踩的坑"), markdown);
        assertTrue(markdown.contains("### 5. 想继续深入"), markdown);
        assertTrue(markdown.contains("npm install -g demo-tool"), markdown);
        assertTrue(markdown.contains("demo-tool run --path ./input.md"), markdown);
        assertTrue(markdown.contains("摘自 README「Installation」"), markdown);
        assertTrue(markdown.contains("https://raw.githubusercontent.com/acme/demo-tool/HEAD/README.md"),
                markdown);
        assertTrue(markdown.contains("**没有替你跑过**"), "必须说明命令没被执行过");
        assertTrue(markdown.contains("DEMO_API_KEY"), "环境变量要提醒");
        assertTrue(markdown.contains("Node 18"), "版本要求要提醒");
        assertFalse(markdown.contains("未知"), markdown);
    }

    @Test
    @DisplayName("没有安装/示例小节：按代码块内容分类，不硬凑")
    void classifiesBlocksWithoutHeadings() {
        String readme = String.join("\n",
                "Demo Tool",
                "",
                F,
                "pip install demo-tool",
                F,
                "",
                F,
                "demo-tool --help",
                F,
                "");
        String markdown = RepoTutorial.render(repo("Python"), "", "https://example.com/README.md", readme, 160);
        assertTrue(markdown.contains("pip install demo-tool"), markdown);
        assertTrue(markdown.contains("demo-tool --help"), markdown);
    }

    @Test
    @DisplayName("README 里没有命令：安装段给诚实说明，不编命令")
    void explainsMissingCommands() {
        String markdown = RepoTutorial.render(repo("Go"), null, "https://example.com/README.md",
                "# Demo\n\nJust a library, read the docs.", 160);
        assertTrue(markdown.contains("README 里没找到可复制的安装命令"), markdown);
        assertTrue(markdown.contains("README 里没有独立的 Usage 示例"), markdown);
        assertFalse(markdown.contains("npm install"), markdown);
    }

    @Test
    @DisplayName("取不到 README：只给仓库地址与原因，不生成假教程")
    void unavailableGivesAddressOnly() {
        String markdown = RepoTutorial.renderUnavailable(repo("Rust"), "HTTP 404（fake）");
        assertTrue(markdown.startsWith(RepoTutorial.HEADING), markdown);
        assertTrue(markdown.contains("https://github.com/acme/demo-tool"), markdown);
        assertTrue(markdown.contains("HTTP 404"), markdown);
        assertFalse(markdown.contains("### 2. 安装"), "取不到 README 时不该有安装小节");
    }

    @Test
    @DisplayName("超过行数上限：截断并显式标注")
    void truncatesToMaxLines() {
        StringBuilder longReadme = new StringBuilder("# Demo\n\n## Usage\n\n" + F + "\n");
        for (int i = 0; i < 200; i++) {
            longReadme.append("demo-tool step ").append(i).append('\n');
        }
        longReadme.append(F).append('\n');
        String markdown = RepoTutorial.render(repo("JavaScript"), null, "https://example.com/README.md",
                longReadme.toString(), 30);
        assertTrue(markdown.contains("已截断"), markdown);
        // 上限管正文；截断说明与其前的空行是额外两行
        assertTrue(markdown.split("\n", -1).length <= 32, "正文不超过上限，另加截断说明");
    }

    @Test
    @DisplayName("单个代码块过长：插省略提示，不静默丢命令")
    void marksTruncatedBlock() {
        StringBuilder longReadme = new StringBuilder("# Demo\n\n## Installation\n\n" + F + "\n");
        for (int i = 0; i < 60; i++) {
            longReadme.append("npm run step-").append(i).append('\n');
        }
        longReadme.append(F).append('\n');
        String markdown = RepoTutorial.render(repo("JavaScript"), null, "https://example.com/README.md",
                longReadme.toString(), 400);
        assertTrue(markdown.contains("后面的行略"), markdown);
    }

    @Test
    @DisplayName("原文速览：摘 README 正文，丢掉徽章图片，碰到代码块就停")
    void excerptKeepsProseOnly() {
        String readme = String.join("\n",
                "[![Build](https://img.shields.io/badge/build-passing-green)](https://ci.example.com)",
                "",
                "# Demo Tool",
                "",
                "Demo Tool 把 Markdown 变成幻灯片，适合做周会材料。",
                "<p align=\"center\"><img src=\"logo.png\" width=\"120\"></p>",
                "",
                "作者自用三年，稳定。",
                "",
                "## Usage",
                "",
                F + "bash",
                "这里不该出现在摘录里",
                F,
                "");
        String markdown = RepoTutorial.render(repo("JavaScript"), null, "https://example.com/README.md",
                readme, 400);
        assertTrue(markdown.contains("### 6. 原文速览（README 开头，照抄）"), markdown);
        assertTrue(markdown.contains("> Demo Tool 把 Markdown 变成幻灯片，适合做周会材料。"), markdown);
        assertTrue(markdown.contains("> 作者自用三年，稳定。"), markdown);
        String section6 = markdown.substring(markdown.indexOf("### 6."));
        assertFalse(section6.contains("img.shields.io"), "徽章不该进摘录");
        assertFalse(section6.contains("logo.png"), "图片不该进摘录");
        assertFalse(section6.contains("这里不该出现在摘录里"), "代码块不该进摘录");
    }

    @Test
    @DisplayName("安装段与示例段是同一份命令：只在安装段出现一次")
    void dedupesUsageAgainstInstall() {
        String readme = String.join("\n",
                "# Demo Tool",
                "",
                "## Installation",
                "",
                F + "bash",
                "npm install -g demo-tool",
                F,
                "",
                "## Usage",
                "",
                F + "bash",
                "npm install -g demo-tool",
                F,
                "");
        String markdown = RepoTutorial.render(repo("JavaScript"), null, "https://example.com/README.md",
                readme, 400);
        int first = markdown.indexOf("npm install -g demo-tool");
        int second = first < 0 ? -1 : markdown.indexOf("npm install -g demo-tool", first + 1);
        assertEquals(-1, second, "同一份命令不该在示例段重复贴");
        assertTrue(markdown.contains("示例和安装是同一份命令"), "示例被去重后要说明原因，不能留空段");
        assertTrue(markdown.contains("### 7. 备注（可跳过）"), markdown);
    }

    @Test
    @DisplayName("示例段优先放能敲的命令，配置片段排后面")
    void prefersCommandsOverConfig() {
        String readme = String.join("\n",
                "# Demo Tool",
                "",
                "## Usage",
                "",
                F + "json",
                "{ \"demo\": true }",
                F,
                "",
                F + "bash",
                "demo-tool run --path ./input.md",
                F,
                "");
        String markdown = RepoTutorial.render(repo("JavaScript"), null, "https://example.com/README.md",
                readme, 400);
        int command = markdown.indexOf("demo-tool run --path ./input.md");
        int config = markdown.indexOf("{ \"demo\": true }");
        assertTrue(command > 0 && config > 0, markdown);
        assertTrue(command < config, "命令块应排在配置块前面");
    }

    @Test
    @DisplayName("有版本要求与环境变量：进「坑」清单")
    void pitfallsUseEvidence() {
        String markdown = RepoTutorial.render(repo("Python"), null, "https://example.com/README.md",
                readme().replace("Node 18", "Python 3.10"), 160);
        assertTrue(markdown.contains("版本不够会直接报错"), markdown);
        assertTrue(markdown.contains("python --version"), markdown);
    }
}
