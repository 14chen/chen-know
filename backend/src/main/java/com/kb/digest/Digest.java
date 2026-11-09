package com.kb.digest;

import java.util.List;

/**
 * 长文速览（<b>抽取式</b>：从正文里挑句子，不改写、不生成）。
 *
 * <p>界面上必须标注「速览（自动提取）」，不能冒充 AI 摘要。
 *
 * @param text 合成文本（标题行 + 各段首句，逐行），总长 ≤300 字
 * @param sections 逐行拆开的结果（标题行可能没有）
 */
public record Digest(String text, List<String> sections) {
}
