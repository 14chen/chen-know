package com.kb.trash;

import com.kb.activity.ActivityService;
import com.kb.common.ApiException;
import com.kb.common.Times;
import com.kb.user.KbPrincipal;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** API.md §8 回收站：软删内容的查看、恢复与彻底删除（SCHEMA §3 级联语义）。 */
@Service
public class TrashService {

    private final TrashRepository trash;
    private final ActivityService activities;

    public TrashService(TrashRepository trash, ActivityService activities) {
        this.trash = trash;
        this.activities = activities;
    }

    public TrashResponse list(KbPrincipal principal) {
        return new TrashResponse(trash.deletedNotes(principal.spaceId()), trash.deletedFolders(principal.spaceId()));
    }

    @Transactional
    public void restoreNote(KbPrincipal principal, long noteId) {
        if (trash.restoreNote(noteId, principal.spaceId(), Times.now()) == 0) {
            throw ApiException.notFound("回收站中没有这篇笔记");
        }
        activities.record(principal.id(), noteId, ActivityService.ACTION_RESTORE);
    }

    @Transactional
    public void restoreFolder(KbPrincipal principal, long folderId) {
        long spaceId = principal.spaceId();
        String deletedAt = trash.deletedAtOfDeletedFolder(folderId, spaceId)
                .orElseThrow(() -> ApiException.notFound("回收站中没有这个目录"));
        String now = Times.now();
        trash.restoreFolderAncestors(folderId, spaceId, now);
        trash.restoreFolderSubtree(folderId, spaceId, deletedAt, now);
        trash.restoreNotesUnderFolderSubtree(folderId, spaceId, deletedAt, now);
        activities.record(principal.id(), null, ActivityService.ACTION_RESTORE);
    }

    @Transactional
    public void purgeNote(KbPrincipal principal, long noteId) {
        if (trash.purgeNote(noteId, principal.spaceId()) == 0) {
            throw ApiException.notFound("回收站中没有这篇笔记");
        }
        // activities.note_id 有外键（ON DELETE CASCADE），笔记已不在，只能记操作级日志
        activities.record(principal.id(), null, ActivityService.ACTION_DELETE);
    }

    @Transactional
    public void purgeFolder(KbPrincipal principal, long folderId) {
        long spaceId = principal.spaceId();
        trash.deletedAtOfDeletedFolder(folderId, spaceId)
                .orElseThrow(() -> ApiException.notFound("回收站中没有这个目录"));
        // 顺序：先删随删笔记，再删目录树（note_versions/note_tags/links 与 FTS 行交给级联与触发器）
        trash.purgeNotesUnderFolderSubtree(folderId, spaceId);
        trash.purgeFolderSubtree(folderId, spaceId);
        activities.record(principal.id(), null, ActivityService.ACTION_DELETE);
    }

    @Transactional
    public EmptyTrashResponse empty(KbPrincipal principal) {
        long spaceId = principal.spaceId();
        long notes = trash.countDeletedNotes(spaceId);
        long folders = trash.countDeletedFolders(spaceId);
        trash.deleteAllDeletedNotes(spaceId);
        trash.deleteAllDeletedFolders(spaceId);
        activities.record(principal.id(), null, ActivityService.ACTION_DELETE);
        return new EmptyTrashResponse(notes, folders);
    }
}
