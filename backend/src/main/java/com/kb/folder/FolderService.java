package com.kb.folder;

import com.kb.common.ApiException;
import com.kb.common.Times;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** API.md §3 目录接口。 */
@Service
public class FolderService {

    private static final int MAX_NAME_LENGTH = 128;

    private final FolderRepository folders;

    public FolderService(FolderRepository folders) {
        this.folders = folders;
    }

    /** {@code tree=true} 返回嵌套结构，{@code false} 返回扁平列表（children 恒为空数组）。 */
    public List<FolderNode> list(long spaceId, boolean tree) {
        List<FolderRow> rows = folders.listAlive(spaceId);
        Map<Long, Long> counts = folders.aliveNoteCounts(spaceId);
        if (!tree) {
            return rows.stream()
                    .map(row -> new FolderNode(row.id(), row.parentId(), row.name(), row.sortOrder(),
                            counts.getOrDefault(row.id(), 0L), List.of()))
                    .toList();
        }
        Map<Long, FolderNode> nodes = new LinkedHashMap<>();
        for (FolderRow row : rows) {
            nodes.put(row.id(), new FolderNode(row.id(), row.parentId(), row.name(), row.sortOrder(),
                    counts.getOrDefault(row.id(), 0L), new ArrayList<>()));
        }
        List<FolderNode> roots = new ArrayList<>();
        for (FolderRow row : rows) {
            FolderNode node = nodes.get(row.id());
            FolderNode parent = row.parentId() == null ? null : nodes.get(row.parentId());
            if (parent == null) {
                // 父目录已删（或数据异常）时按根节点展示，避免节点在树上凭空消失
                roots.add(node);
            } else {
                parent.children().add(node);
            }
        }
        return roots;
    }

    @Transactional
    public FolderNode create(long spaceId, CreateFolderRequest request) {
        String name = validatedName(request.name());
        if (request.parentId() != null) {
            folders.findAlive(spaceId, request.parentId())
                    .orElseThrow(() -> ApiException.notFound("父目录不存在"));
        }
        String now = Times.now();
        long id = folders.insert(spaceId, request.parentId(), name, 0, now);
        return new FolderNode(id, request.parentId(), name, 0, 0, List.of());
    }

    @Transactional
    public FolderNode patch(long spaceId, long id, FolderPatch patch) {
        FolderRow current = folders.findAlive(spaceId, id)
                .orElseThrow(() -> ApiException.notFound("目录不存在"));
        String name = current.name();
        if (patch.hasName()) {
            name = validatedName(patch.name());
        }
        Long parentId = current.parentId();
        if (patch.hasParentId()) {
            Long target = patch.parentId();
            if (target != null) {
                if (target == id) {
                    throw ApiException.validation("不能把目录移到自己下面", "parentId");
                }
                folders.findAlive(spaceId, target)
                        .orElseThrow(() -> ApiException.notFound("父目录不存在"));
                if (folders.isDescendant(spaceId, id, target)) {
                    throw ApiException.validation("不能把目录移进自己的子孙目录", "parentId");
                }
            }
            parentId = target;
        }
        int sortOrder = patch.hasSortOrder() ? patch.sortOrder() : current.sortOrder();
        folders.updateFields(spaceId, id, name, parentId, sortOrder, Times.now());
        return new FolderNode(id, parentId, name, sortOrder, folders.countNotesIn(spaceId, id), List.of());
    }

    /**
     * SCHEMA §3：递归取出该目录及全部子孙目录，连同其中所有笔记一并软删。
     * 同一次操作共用一个时间戳——回收站靠它识别「当初随目录一起被删的笔记」。
     */
    @Transactional
    public void delete(long spaceId, long id) {
        folders.findAlive(spaceId, id).orElseThrow(() -> ApiException.notFound("目录不存在"));
        String now = Times.now();
        folders.softDeleteNotesInSubtree(spaceId, id, now);
        folders.softDeleteSubtreeFolders(spaceId, id, now);
    }

    private static String validatedName(String raw) {
        String name = raw == null ? "" : raw.trim();
        if (name.isEmpty()) {
            throw ApiException.validation("目录名不能为空", "name");
        }
        if (name.length() > MAX_NAME_LENGTH) {
            throw ApiException.validation("目录名最长 " + MAX_NAME_LENGTH + " 字", "name");
        }
        return name;
    }
}
