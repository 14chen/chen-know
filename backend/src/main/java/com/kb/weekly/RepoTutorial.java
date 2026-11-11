package com.kb.weekly;

import com.kb.briefing.BriefingText;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 每周报条目自动生成的「傻瓜教程」：<b>零编造</b> —— 命令与代码块只从仓库 README 里摘，
 * 散文按固定模板生成并标注来源；取不到 README 时只给仓库地址，不猜。
 *
 * <p>纯函数（不发网络），便于单测。输出里不会出现「我实测过」这类无法验证的断言。
 */
public final class RepoTutorial {

    /** 标题：与周报正文的其它小节区分开。 */
    public static final String HEADING = "## 傻瓜教程（自动生成）";

    private static final String[] INSTALL_KEYS = {"install", "installation", "getting started",
            "quick start", "quickstart", "setup", "set up", "安装", "快速开始", "快速上手"};
    private static final String[] USAGE_KEYS = {"usage", "example", "how to use", "quickstart",
            "使用", "示例", "用法", "上手"};
    private static final String[] DOC_KEYS = {"documentation", "docs", "reference", "learn more", "文档", "说明"};

    private static final Pattern IMAGE = Pattern.compile("!\\[[^\\]]*\\]\\([^)]*\\)");
    private static final Pattern BADGE_LINK = Pattern.compile("\\[!\\[[^\\]]*\\]\\([^)]*\\)\\]\\([^)]*\\)");
    private static final Pattern HTML_TAG = Pattern.compile("<[^>]{1,200}>");
    private static final Pattern HEADING_LINE = Pattern.compile("^(#{1,6})\\s+(.+?)\\s*#*\\s*$");
    private static final Pattern FENCE = Pattern.compile("^\\s*(```+|~~~+)\\s*([a-zA-Z0-9+#-]*)\\s*$");
    private static final Pattern VERSION_REQUIREMENT = Pattern.compile(
            "(?i)(requires?|needs?|需要|要求)[^\\n]{0,40}?"
                    + "(node(?:\\.js)?|python|java|jdk|go|rust|php|ruby)[^\\n]{0,12}?"
                    + "(\\d+(?:\\.\\d+){0,2})\\s*\\+?");
    private static final Pattern ENV_NAME = Pattern.compile("\\b([A-Z][A-Z0-9_]{2,})\\b");
    private static final Pattern ENV_HINT = Pattern.compile(
            "(?i)(api[ _-]?key|token|secret|environment variable|env file|\\.env|环境变量|密钥)");

    private RepoTutorial() {
    }

    /** 取不到 README 时的诚实占位（不是教程，只说明原因和去哪看）。 */
    public static String renderUnavailable(WeeklyRepo repo, String reason) {
        StringBuilder out = new StringBuilder();
        out.append(HEADING).append("\n\n");
        out.append("> 这次没取到 README（").append(oneLine(reason)).append("），所以没有生成教程 —— ")
                .append("与其编一段，不如直接给你仓库地址：").append(repo.url()).append("\n");
        return out.toString();
    }

    /**
     * @param descriptionZh 已翻译的一句话价值（可为空）
     * @param readmeUrl     README 原始地址（写进「来源」，供核对）
     * @param readme        README 原文（Markdown）
     * @param maxLines      教程正文上限（超出按行截断并标注）
     */
    public static String render(WeeklyRepo repo, String descriptionZh, String readmeUrl, String readme,
            int maxLines) {
        List<String> lines = splitLines(readme);
        List<Section> sections = sections(lines);
        List<CodeBlock> install = pickBlocks(lines, sections, INSTALL_KEYS, true);
        List<CodeBlock> usageCandidates = pickBlocks(lines, sections, USAGE_KEYS, false);
        List<CodeBlock> usage = preferredUsage(withoutDuplicates(usageCandidates, install));
        boolean usageWasDuplicate = !usageCandidates.isEmpty() && usage.isEmpty();
        String firstParagraph = firstParagraph(lines);

        StringBuilder out = new StringBuilder();
        out.append(HEADING).append("\n\n");
        out.append("> 下面的命令与代码块都摘自仓库 README（[原文](").append(readmeUrl)
                .append(")），散文是模板生成的解释；**没有替你跑过**，报错以 README 与 Issues 为准。\n\n");

        out.append("### 0. 这是什么东西\n\n");
        out.append("- **一句话**：").append(oneLiner(descriptionZh, firstParagraph)).append('\n');
        out.append("- **怎么用**：").append(analogy(repo.language())).append('\n');
        out.append("- **难度自评**：").append(difficulty(install, usage)).append('\n');
        if (repo.url() != null && !repo.url().isBlank()) {
            out.append("- **仓库**：").append(repo.url()).append('\n');
        }
        out.append('\n');

        out.append("### 1. 动手前先备好\n\n");
        for (String item : prepare(repo, lines, install)) {
            out.append("- ").append(item).append('\n');
        }
        out.append('\n');

        out.append("### 2. 安装\n\n");
        if (install.isEmpty()) {
            out.append("README 里没找到可复制的安装命令（有些项目 clone 下来就能跑）。")
                    .append("先照第 3 步的示例跑，报缺依赖时再回 README 的 Installation 小节找。\n\n");
        } else {
            appendBlocks(out, install, 24, readmeUrl);
        }

        out.append("### 3. 跑通第一个例子\n\n");
        if (usage.isEmpty()) {
            if (usageWasDuplicate) {
                out.append("README 的示例和安装是同一份命令：装完就能直接用，")
                        .append("先带上 --help 看一眼有哪些子命令。\n\n");
            } else {
                out.append("README 里没有独立的 Usage 示例。可以先看仓库的 examples/ 目录，")
                        .append("或直接读 README 的「Usage」小节。\n\n");
            }
        } else {
            appendBlocks(out, usage, 30, readmeUrl);
        }

        out.append("跑之前 30 秒自查：\n\n");
        out.append("- 命令里的占位符（路径、端口、token）都换成自己的了吗？\n");
        out.append("- 当前目录对吗？多数命令要在 clone 下来/解压出来的那个目录里执行。\n");
        out.append("- 终端输出留着别关：出错时第一行和最后一行才是关键，复制去搜。\n\n");

        out.append("### 4. 三个容易踩的坑\n\n");
        List<String> pitfalls = pitfalls(lines, install);
        for (int i = 0; i < pitfalls.size(); i++) {
            out.append(i + 1).append(". ").append(pitfalls.get(i)).append('\n');
        }
        out.append('\n');

        out.append("### 5. 想继续深入\n\n");
        out.append("- README 原文：").append(readmeUrl).append('\n');
        for (String doc : docLinks(lines, sections)) {
            out.append("- ").append(doc).append('\n');
        }
        out.append("- 遇到报错：先在仓库 Issues 里搜报错关键词，再提新 issue。\n\n");

        // 原文摘录：给「想先看看这个项目讲什么」的人一段没改写的正文，顺便把篇幅补到实用长度。
        out.append("### 6. 原文速览（README 开头，照抄）\n\n");
        List<String> excerpt = excerpt(lines, 30);
        if (excerpt.isEmpty()) {
            out.append("README 开头没有可直接摘的正文（多半是徽章和图片），直接看原文：")
                    .append(readmeUrl).append('\n');
        } else {
            out.append("> 下面这段是 README 开头的原文，没改写；想核对就点上面的链接。\n\n");
            for (String line : excerpt) {
                out.append("> ").append(line).append('\n');
            }
        }

        out.append("\n### 7. 备注（可跳过）\n\n");
        out.append("- 命令与代码块来自 README，散文是按模板拼的，没有模型参与，也没有替你实际执行。\n");
        out.append("- 第 6 节是 README 开头原文照抄，用来核对；两者冲突时以 README 为准。\n");
        out.append("- 这份教程只覆盖「装上 + 跑通」，进阶用法看第 5 节的链接。\n");

        return truncate(out.toString(), maxLines);
    }

    // ---------------------------------------------------------------- 结构解析

    private record Section(int level, String title, int start, int end) {
    }

    private record CodeBlock(String lang, List<String> code, String section) {
    }

    /** README 开头的正文摘录：丢掉徽章、图片、HTML 与标题行，碰到代码块就停。 */
    static List<String> excerpt(List<String> lines, int limit) {
        List<String> out = new ArrayList<>();
        for (String raw : lines) {
            if (out.size() >= limit) {
                break;
            }
            String line = raw.strip();
            if (line.isEmpty()) {
                continue;
            }
            if (FENCE.matcher(line).matches()) {
                break;
            }
            if (HEADING_LINE.matcher(line).matches()) {
                continue;
            }
            if (IMAGE.matcher(line).find() || BADGE_LINK.matcher(line).find()) {
                continue;
            }
            String cleaned = HTML_TAG.matcher(line).replaceAll("").strip();
            if (cleaned.isEmpty()) {
                continue;
            }
            out.add(cleaned);
        }
        return out;
    }

    static List<String> splitLines(String text) {
        if (text == null || text.isEmpty()) {
            return List.of();
        }
        String normalized = text.replace("\r\n", "\n").replace('\r', '\n');
        return List.of(normalized.split("\n", -1));
    }

    /** 只在代码块之外识别标题。 */
    private static List<Section> sections(List<String> lines) {
        List<int[]> headings = new ArrayList<>();
        List<String> titles = new ArrayList<>();
        boolean inFence = false;
        for (int i = 0; i < lines.size(); i++) {
            String line = lines.get(i);
            if (FENCE.matcher(line).matches()) {
                inFence = !inFence;
                continue;
            }
            if (inFence) {
                continue;
            }
            Matcher m = HEADING_LINE.matcher(line);
            if (m.matches()) {
                headings.add(new int[]{m.group(1).length(), i});
                titles.add(cleanInline(m.group(2)));
            }
        }
        List<Section> out = new ArrayList<>();
        for (int i = 0; i < headings.size(); i++) {
            int level = headings.get(i)[0];
            int start = headings.get(i)[1];
            int end = lines.size();
            for (int j = i + 1; j < headings.size(); j++) {
                if (headings.get(j)[0] <= level) {
                    end = headings.get(j)[1];
                    break;
                }
            }
            out.add(new Section(level, titles.get(i), start, end));
        }
        return out;
    }

    private static Section findSection(List<Section> sections, String[] keys) {
        for (Section section : sections) {
            String title = section.title().toLowerCase(Locale.ROOT);
            for (String key : keys) {
                if (title.contains(key)) {
                    return section;
                }
            }
        }
        return null;
    }

    private static List<CodeBlock> pickBlocks(List<String> lines, List<Section> sections, String[] keys,
            boolean install) {
        List<CodeBlock> out = new ArrayList<>();
        Section section = findSection(sections, keys);
        if (section != null) {
            out.addAll(codeBlocks(lines, section.start(), section.end(), section.title()));
        }
        if (out.isEmpty()) {
            List<CodeBlock> loose = new ArrayList<>();
            for (CodeBlock block : codeBlocks(lines, 0, lines.size(), "README")) {
                if (looksLikeInstall(block) == install) {
                    loose.add(block);
                }
            }
            out.addAll(loose.subList(0, Math.min(2, loose.size())));
        }
        return out.size() > 2 ? new ArrayList<>(out.subList(0, 2)) : out;
    }

    private static List<CodeBlock> codeBlocks(List<String> lines, int from, int to, String sectionTitle) {
        List<CodeBlock> out = new ArrayList<>();
        int i = from;
        while (i < to && i < lines.size()) {
            Matcher open = FENCE.matcher(lines.get(i));
            if (!open.matches()) {
                i++;
                continue;
            }
            String fence = open.group(1);
            int j = i + 1;
            List<String> code = new ArrayList<>();
            while (j < to && j < lines.size()) {
                Matcher close = FENCE.matcher(lines.get(j));
                if (close.matches() && close.group(1).charAt(0) == fence.charAt(0)
                        && close.group(1).length() >= fence.length()) {
                    break;
                }
                code.add(lines.get(j));
                j++;
            }
            if (!code.isEmpty()) {
                out.add(new CodeBlock(open.group(2), code, sectionTitle));
            }
            i = j + 1;
        }
        return out;
    }

    /** 示例段优先放能直接敲的命令，配置片段排后面（顺序稳定，同分保持原文次序）。 */
    static List<CodeBlock> preferredUsage(List<CodeBlock> blocks) {
        List<CodeBlock> out = new ArrayList<>(blocks);
        out.sort((a, b) -> Boolean.compare(commandLike(b), commandLike(a)));
        return out;
    }

    static boolean commandLike(CodeBlock block) {
        String lang = block.lang() == null ? "" : block.lang().toLowerCase(Locale.ROOT);
        if (lang.equals("bash") || lang.equals("sh") || lang.equals("shell") || lang.equals("console")
                || lang.equals("zsh") || lang.equals("powershell") || lang.equals("cmd")) {
            return true;
        }
        String joined = String.join(" ", block.code()).strip();
        for (String head : List.of("$", "npm ", "pnpm ", "npx ", "yarn ", "pip ", "python ", "docker ",
                "git ", "cargo ", "go ", "make", "curl ", "java ", "mvn ")) {
            if (joined.startsWith(head)) {
                return true;
            }
        }
        return false;
    }

    /** 去掉与安装段重复的代码块：同一份命令不该在两个小节里各贴一遍。 */
    static List<CodeBlock> withoutDuplicates(List<CodeBlock> candidates, List<CodeBlock> seen) {
        List<CodeBlock> out = new ArrayList<>();
        for (CodeBlock candidate : candidates) {
            boolean dup = seen.stream().anyMatch(other -> other.code().equals(candidate.code()));
            if (!dup && out.stream().noneMatch(other -> other.code().equals(candidate.code()))) {
                out.add(candidate);
            }
        }
        return out;
    }

    static boolean looksLikeInstall(CodeBlock block) {
        String joined = String.join(" ", block.code()).toLowerCase(Locale.ROOT);
        return joined.contains("install") || joined.contains("npm i") || joined.contains("pnpm add")
                || joined.contains("cargo add") || joined.contains("go get") || joined.contains("git clone")
                || joined.contains("docker pull") || joined.contains("pip3 ") || joined.contains("brew ");
    }

    private static String firstParagraph(List<String> lines) {
        boolean inFence = false;
        StringBuilder paragraph = new StringBuilder();
        for (String raw : lines) {
            if (FENCE.matcher(raw).matches()) {
                inFence = !inFence;
                continue;
            }
            if (inFence) {
                continue;
            }
            String line = cleanInline(raw);
            if (line.isBlank()) {
                if (paragraph.length() > 40) {
                    return BriefingText.collapse(paragraph.toString());
                }
                paragraph.setLength(0);
                continue;
            }
            if (line.startsWith("#") || line.startsWith(">") || line.startsWith("|")
                    || line.startsWith("-") || line.startsWith("*") || line.startsWith("[")) {
                continue;
            }
            paragraph.append(line).append(' ');
            if (paragraph.length() > 400) {
                break;
            }
        }
        String text = BriefingText.collapse(paragraph.toString());
        return text.length() > 40 ? text : null;
    }

    // ---------------------------------------------------------------- 各段渲染

    private static String oneLiner(String descriptionZh, String firstParagraph) {
        String candidate = descriptionZh == null || descriptionZh.isBlank() ? firstParagraph : descriptionZh;
        if (candidate == null || candidate.isBlank()) {
            return "README 没有给出简介，看仓库首页 About 那一句。";
        }
        return BriefingText.truncate(BriefingText.collapse(candidate), 120);
    }

    private static String analogy(String language) {
        String lang = language == null ? "" : language.trim().toLowerCase(Locale.ROOT);
        return switch (lang) {
            case "python" -> "当成一个 Python 工具包：装好后在脚本里 import，或者直接敲命令用。";
            case "javascript", "typescript" ->
                    "当成一个 Node/npm 项目：装依赖 → 跑脚本或起本地服务 → 浏览器看效果。";
            case "java" -> "当成一个 Java 项目：先有 JDK，再用 Maven/Gradle 拉依赖跑起来。";
            case "go" -> "当成一个 Go 程序：go install 之后直接敲命令，或 import 进自己的代码。";
            case "rust" -> "当成一个 Rust 程序：cargo run 就能跑，cargo install 装成命令。";
            case "c", "c++", "cpp" -> "当成一个 C/C++ 项目：先装编译器与依赖，再按 README 编译。";
            case "shell", "dockerfile" -> "当成一套脚本或容器配置：照 README 的命令逐条执行。";
            default -> "当成一个普通开源项目：装依赖 → 跑示例 → 再改。";
        };
    }

    private static String difficulty(List<CodeBlock> install, List<CodeBlock> usage) {
        if (install.isEmpty() && usage.isEmpty()) {
            return "README 里没有可直接复制的命令，属于要自己读文档的项目。";
        }
        if (!install.isEmpty() && !usage.isEmpty()) {
            return "安装命令和示例都有，照着抄能跑通第一遍。";
        }
        return "只找到安装或示例其中之一，另一半要看 README 原文。";
    }

    private static List<String> prepare(WeeklyRepo repo, List<String> lines, List<CodeBlock> install) {
        List<String> items = new ArrayList<>();
        String runtime = runtime(repo.language());
        if (runtime != null) {
            items.add("**" + runtime + "**" + versionHint(lines));
        }
        if (containsAny(lines, "git clone") || install.stream().anyMatch(RepoTutorial::hasClone)) {
            items.add("**Git**：README 用 git clone 取代码；没装就去 git-scm.com 下安装包。");
        }
        if (containsAny(lines, "docker run", "docker compose", "docker-compose")) {
            items.add("**Docker（可选）**：README 也给了容器方式，不想装依赖可以直接用。");
        }
        items.add("一个命令行窗口：Windows 用 PowerShell，macOS/Linux 用终端。");
        items.add("把命令里的占位符（路径、端口、token）先换成自己的。");
        items.add("先建一个空目录再动手，失败时删掉重来最省事；整个过程大约 10–20 分钟。");
        return items;
    }

    private static boolean hasClone(CodeBlock block) {
        return block.code().stream().anyMatch(line -> line.contains("git clone"));
    }

    private static String runtime(String language) {
        String lang = language == null ? "" : language.trim().toLowerCase(Locale.ROOT);
        return switch (lang) {
            case "python" -> "Python";
            case "javascript", "typescript" -> "Node.js";
            case "java" -> "JDK";
            case "go" -> "Go";
            case "rust" -> "Rust";
            case "php" -> "PHP";
            case "ruby" -> "Ruby";
            default -> null;
        };
    }

    private static String versionHint(List<String> lines) {
        Matcher m = VERSION_REQUIREMENT.matcher(String.join("\n", lines));
        if (m.find()) {
            return "（README 写明需要 " + capitalize(m.group(2)) + " " + m.group(3) + " 或以上）";
        }
        return "（README 没写具体版本，用当前稳定版即可）";
    }

    private static List<String> pitfalls(List<String> lines, List<CodeBlock> install) {
        String text = String.join("\n", lines);
        List<String> out = new ArrayList<>();
        if (install.stream().anyMatch(RepoTutorial::hasClone)) {
            out.add("**先 clone 再进目录**：漏掉 git clone 或没 cd 进去，后面所有命令都会找不到文件。");
        }
        Matcher version = VERSION_REQUIREMENT.matcher(text);
        if (version.find()) {
            out.add("**版本不够会直接报错**：README 要求 " + capitalize(version.group(2)) + " "
                    + version.group(3) + " 以上，先用 " + checkCommand(version.group(2)) + " 确认自己的版本。");
        }
        String envName = envName(lines);
        if (envName != null) {
            out.add("**要先配环境变量 " + envName + "**：它是凭据，别写进代码提交；没配通常会 401/403。");
        }
        if (containsAny(lines, "Windows", "windows")) {
            out.add("**Windows 与 Linux 命令不通用**：README 里的 export、chmod 在 PowerShell 里要换写法。");
        }
        // 证据不足三条时用通用提醒补齐，并标「通用提醒」——不假装是仓库特有问题。
        List<String> fillers = List.of(
                "**先跑示例再改代码**：一上手就改，报错时分不清是环境问题还是自己改坏的。（通用提醒）",
                "**报错先搜 Issues**：把报错原文粘到仓库 Issues 搜索框，多半已经有人踩过。（通用提醒）",
                "**版本对不上先看 Releases**：README 可能落后于最新代码，发布说明通常更准。（通用提醒）");
        for (int i = 0; out.size() < 3; i++) {
            out.add(fillers.get(i % fillers.size()));
        }
        return new ArrayList<>(out.subList(0, 3));
    }

    private static String checkCommand(String runtime) {
        String name = runtime.toLowerCase(Locale.ROOT);
        return switch (name) {
            case "node", "nodejs", "node.js" -> "node -v";
            case "python" -> "python --version";
            case "java", "jdk" -> "java -version";
            case "go" -> "go version";
            case "rust" -> "rustc --version";
            case "php" -> "php -v";
            case "ruby" -> "ruby -v";
            default -> name + " --version";
        };
    }

    /** README 里出现的第一个像凭据的环境变量名。 */
    static String envName(List<String> lines) {
        String text = String.join("\n", lines);
        if (!ENV_HINT.matcher(text).find()) {
            return null;
        }
        Set<String> names = new LinkedHashSet<>();
        Matcher m = ENV_NAME.matcher(text);
        while (m.find() && names.size() < 20) {
            String name = m.group(1);
            if (name.length() >= 4 && !name.equals("README") && !name.equals("HTTP") && !name.equals("HTTPS")
                    && !name.equals("JSON") && !name.equals("API") && !name.equals("URL")
                    && !name.equals("MIT") && !name.equals("TRUE") && !name.equals("FALSE")
                    && !name.equals("NOTE") && !name.equals("TODO")) {
                names.add(name);
            }
        }
        return names.isEmpty() ? null : names.iterator().next();
    }

    private static List<String> docLinks(List<String> lines, List<Section> sections) {
        List<String> out = new ArrayList<>();
        Section docs = findSection(sections, DOC_KEYS);
        if (docs != null) {
            out.add("README 的「" + docs.title() + "」小节");
        }
        for (String line : lines) {
            if (line.toLowerCase(Locale.ROOT).contains("contributing")) {
                out.add("参与贡献：README 里的 CONTRIBUTING 说明");
                break;
            }
        }
        return out.size() > 2 ? out.subList(0, 2) : out;
    }

    private static void appendBlocks(StringBuilder out, List<CodeBlock> blocks, int maxCodeLines,
            String readmeUrl) {
        int used = 0;
        for (CodeBlock block : blocks) {
            if (used >= maxCodeLines) {
                break;
            }
            String fence = block.code().stream().anyMatch(line -> line.contains("```"))
                    ? "````" : "```";
            out.append(fence).append(block.lang() == null ? "" : block.lang()).append('\n');
            for (String code : block.code()) {
                if (used >= maxCodeLines) {
                    out.append("# …（后面的行略，完整命令见 README）").append('\n');
                    break;
                }
                out.append(code).append('\n');
                used++;
            }
            out.append(fence).append("\n\n");
            String where = "README".equals(block.section()) ? "README 开头" : "README「" + block.section() + "」小节";
            out.append("> 摘自 ").append(where).append("（")
                    .append(readmeUrl).append("）\n\n");
        }
    }

    // ---------------------------------------------------------------- 清理与截断

    private static String cleanInline(String raw) {
        String line = BADGE_LINK.matcher(raw).replaceAll("");
        line = IMAGE.matcher(line).replaceAll("");
        line = HTML_TAG.matcher(line).replaceAll("");
        return line.replace("&nbsp;", " ").trim();
    }

    private static boolean containsAny(List<String> lines, String... needles) {
        for (String line : lines) {
            for (String needle : needles) {
                if (line.contains(needle)) {
                    return true;
                }
            }
        }
        return false;
    }

    private static String truncate(String markdown, int maxLines) {
        if (maxLines <= 0) {
            return markdown;
        }
        String[] lines = markdown.split("\n", -1);
        if (lines.length <= maxLines) {
            return markdown;
        }
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < maxLines - 1; i++) {
            out.append(lines[i]).append('\n');
        }
        out.append("\n> …（教程超过 ").append(maxLines).append(" 行，已截断；完整命令见 README）\n");
        return out.toString();
    }

    private static String capitalize(String text) {
        if (text == null || text.isEmpty()) {
            return text;
        }
        return text.substring(0, 1).toUpperCase(Locale.ROOT) + text.substring(1);
    }

    private static String oneLine(String text) {
        return text == null || text.isBlank() ? "未知原因"
                : BriefingText.truncate(BriefingText.collapse(text), 60);
    }
}
