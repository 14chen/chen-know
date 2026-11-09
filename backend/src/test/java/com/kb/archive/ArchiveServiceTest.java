package com.kb.archive;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 搬迁后的数量校验：对不上必须抛（由事务整批回滚），对得上不抛。 */
class ArchiveServiceTest {

    @Test
    @DisplayName("笔记总数不变 → 通过")
    void sameCountPasses() {
        assertDoesNotThrow(() -> ArchiveService.verifyNoteCount(12, 12));
        assertDoesNotThrow(() -> ArchiveService.verifyNoteCount(0, 0));
    }

    @Test
    @DisplayName("多一篇 / 少一篇都要抛，且提示「已整批回滚」")
    void changedCountFails() {
        IllegalStateException lost = assertThrows(IllegalStateException.class,
                () -> ArchiveService.verifyNoteCount(12, 11));
        assertTrue(lost.getMessage().contains("回滚"), lost.getMessage());

        IllegalStateException grew = assertThrows(IllegalStateException.class,
                () -> ArchiveService.verifyNoteCount(12, 13));
        assertTrue(grew.getMessage().contains("回滚"), grew.getMessage());
    }
}
