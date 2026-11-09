package com.kb.ioport;

/** 单篇导出结果：已清洗的文件名 + 字节内容。 */
public record ExportedNote(String fileName, byte[] content) {
}
