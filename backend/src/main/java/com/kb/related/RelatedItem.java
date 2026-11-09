package com.kb.related;

/**
 * 相关推荐的一条（只读接口 GET /api/notes/{id}/related 的返回项）。
 *
 * @param folderName null 表示这条笔记在根目录
 * @param reason {@code tag} / {@code folder} / {@code content}
 * @param reasonLabel 给人看的来源说明，如「同标签：后端」
 * @param score 优先级分：tag=3、folder=2、content=1
 */
public record RelatedItem(long id, String title, String folderName, String reason, String reasonLabel,
        int score) {
}
