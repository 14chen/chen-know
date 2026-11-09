package com.kb.tag;

import com.kb.common.ApiException;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** API.md §6 标签接口。 */
@Service
public class TagService {

    private static final int MAX_NAME_LENGTH = 64;

    private final TagRepository tags;

    public TagService(TagRepository tags) {
        this.tags = tags;
    }

    public List<TagResponse> list(long spaceId) {
        return tags.listWithCount(spaceId);
    }

    public TagResponse create(long spaceId, CreateTagRequest request) {
        String name = request.name().trim();
        if (name.isEmpty()) {
            throw ApiException.validation("标签名不能为空", "name");
        }
        if (name.length() > MAX_NAME_LENGTH) {
            throw ApiException.validation("标签名最长 " + MAX_NAME_LENGTH + " 字", "name");
        }
        if (tags.findByName(spaceId, name).isPresent()) {
            throw ApiException.conflict("标签名已存在");
        }
        String color = request.color() == null ? TagRepository.DEFAULT_COLOR : request.color();
        long id = tags.insert(spaceId, name, color);
        return new TagResponse(id, name, color, 0);
    }

    public TagResponse update(long spaceId, long tagId, UpdateTagRequest request) {
        tags.findById(spaceId, tagId).orElseThrow(() -> ApiException.notFound("标签不存在"));
        String name = request.name() == null ? null : request.name().trim();
        if (name != null) {
            if (name.isEmpty()) {
                throw ApiException.validation("标签名不能为空", "name");
            }
            if (name.length() > MAX_NAME_LENGTH) {
                throw ApiException.validation("标签名最长 " + MAX_NAME_LENGTH + " 字", "name");
            }
            boolean taken = tags.findByName(spaceId, name)
                    .filter(existing -> existing.id() != tagId)
                    .isPresent();
            if (taken) {
                throw ApiException.conflict("标签名已存在");
            }
        }
        tags.update(spaceId, tagId, name, request.color());
        TagRef updated = tags.findById(spaceId, tagId)
                .orElseThrow(() -> new IllegalStateException("更新后读不到标签: " + tagId));
        return new TagResponse(updated.id(), updated.name(), updated.color(), tags.countNotes(spaceId, tagId));
    }

    /** 删标签并解除全部关联（note_tags 由外键级联清理）。 */
    @Transactional
    public void delete(long spaceId, long tagId) {
        if (tags.delete(spaceId, tagId) == 0) {
            throw ApiException.notFound("标签不存在");
        }
    }
}
