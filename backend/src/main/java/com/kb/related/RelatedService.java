package com.kb.related;

import com.kb.common.ApiException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * 相关推荐：标签 → 同目录 → 内容相近，三级优先、去重后凑满 limit。
 *
 * <p>查询次数恒定（当前笔记 1 次 + 三条规则各 1 次），不做 N+1。
 */
@Service
public class RelatedService {

    private static final Logger log = LoggerFactory.getLogger(RelatedService.class);

    /** 三条规则的分数（也决定输出顺序）。 */
    static final int SCORE_TAG = 3;
    static final int SCORE_FOLDER = 2;
    static final int SCORE_CONTENT = 1;
    /** limit 上限，防止被要求返回整个空间。 */
    static final int MAX_LIMIT = 20;

    private final RelatedRepository repository;

    public RelatedService(RelatedRepository repository) {
        this.repository = repository;
    }

    public List<RelatedItem> related(long spaceId, long noteId, int limit) {
        RelatedRepository.CurrentNote note = repository.currentNote(spaceId, noteId)
                .orElseThrow(() -> ApiException.notFound("笔记不存在"));
        int cap = Math.max(1, Math.min(limit <= 0 ? 5 : limit, MAX_LIMIT));
        Map<Long, RelatedItem> picked = new LinkedHashMap<>();

        // 1) 同标签
        for (RelatedRepository.Candidate candidate : repository.bySharedTags(spaceId, noteId, cap)) {
            if (picked.size() >= cap) {
                break;
            }
            picked.putIfAbsent(candidate.id(), new RelatedItem(candidate.id(), candidate.title(),
                    candidate.folderName(), "tag", "同标签：" + candidate.tagName(), SCORE_TAG));
        }

        // 2) 同目录
        if (note.folderId() != null && picked.size() < cap) {
            for (RelatedRepository.Candidate candidate
                    : repository.bySameFolder(spaceId, noteId, note.folderId(), cap)) {
                if (picked.size() >= cap) {
                    break;
                }
                String folderName = candidate.folderName() == null ? "" : candidate.folderName();
                picked.putIfAbsent(candidate.id(), new RelatedItem(candidate.id(), candidate.title(),
                        candidate.folderName(), "folder",
                        folderName.isEmpty() ? "同目录" : "同目录：" + folderName, SCORE_FOLDER));
            }
        }

        // 3) 内容相近（FTS5：用前两个关键词 AND，命中 ≥2 个词由查询本身保证）
        if (picked.size() < cap) {
            String expression = RelatedKeywords.matchExpression(
                    RelatedKeywords.from(note.title(), note.content()));
            if (expression != null) {
                for (RelatedRepository.Candidate candidate
                        : repository.byContent(spaceId, noteId, expression, cap)) {
                    if (picked.size() >= cap) {
                        break;
                    }
                    picked.putIfAbsent(candidate.id(), new RelatedItem(candidate.id(), candidate.title(),
                            candidate.folderName(), "content", "内容相近", SCORE_CONTENT));
                }
            }
        }

        log.debug("相关推荐: note={} 返回 {} 条（limit={}）", noteId, picked.size(), cap);
        return List.copyOf(picked.values());
    }
}
