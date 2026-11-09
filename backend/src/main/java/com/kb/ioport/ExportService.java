package com.kb.ioport;

import com.kb.activity.ActivityService;
import com.kb.common.ApiException;
import com.kb.common.Times;
import com.kb.db.DataDirectory;
import com.kb.user.KbPrincipal;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Service;

/** API.md §10 导出：单篇 Markdown 与整空间 ZIP（{@code notes/{目录路径}/{标题}.md} + attachments/ + manifest.json）。 */
@Service
public class ExportService {

    private static final Logger log = LoggerFactory.getLogger(ExportService.class);

    /** 正文里指向本库附件的引用（`![](/api/attachments/3)` 与 `<img src="/api/attachments/3">` 都命中）。 */
    private static final Pattern ATTACHMENT_URL = Pattern.compile("/api/attachments/(\\d+)");

    /** {@code <img src="...">} 的属性值，用于按 HTML 语义重写（属性值里不能写尖括号）。 */
    private static final Pattern HTML_IMG_SRC = Pattern.compile(
            "(<img\\b[^>]*?\\bsrc\\s*=\\s*)([\"'])([^\"']*)\\2", Pattern.CASE_INSENSITIVE);

    private final ExportRepository repository;
    private final ActivityService activities;
    private final Path uploadsDir;

    public ExportService(ExportRepository repository, ActivityService activities,
            @Value("${kb.data-dir:}") String configuredDataDir) {
        this.repository = repository;
        this.activities = activities;
        try {
            this.uploadsDir = DataDirectory.resolve(configuredDataDir, Path.of(System.getProperty("user.dir")))
                    .resolve("uploads").normalize();
        } catch (IOException e) {
            throw new IllegalStateException("无法定位附件目录", e);
        }
    }

    public ExportedNote exportNote(KbPrincipal principal, long noteId) {
        ExportNote note = repository.findAliveNote(noteId, principal.spaceId())
                .orElseThrow(() -> ApiException.notFound("笔记不存在"));
        Map<Long, String> folderPaths = folderPathIndex(principal.spaceId());
        String folderPath = note.folderId() == null ? null : folderPaths.get(note.folderId());
        // 单篇导出同样把 /api/attachments/{id} 重写成有意义的相对路径（IMPORT-IMAGES.md §7）：
        // 虚拟根就是这份 .md 自己，所以引用不带 ../ 前缀
        Map<Long, String> destinations = attachmentDestinations(repository.attachments(principal.spaceId()),
                new HashSet<>());
        String fileName = FileNames.sanitizeFileName(note.title(), note.id()) + ".md";
        byte[] content = markdown(note, repository.tagsOfNote(noteId), folderPath, destinations, fileName)
                .getBytes(StandardCharsets.UTF_8);
        activities.record(principal.id(), noteId, ActivityService.ACTION_EXPORT);
        return new ExportedNote(fileName, content);
    }

    /**
     * API.md §10.0：**单篇导出为 ZIP**，只打包该篇正文实际引用到的附件。
     *
     * <pre>
     * {标题}.md                  md 在包根 → 引用前缀是 attachments/（没有 ../）
     * attachments/{id}-{原名}    只含正文引用到、且磁盘文件存在的附件
     * manifest.json             与整库导出一致
     * </pre>
     *
     * <p>磁盘文件已丢的附件：不打包、正文保留原 {@code /api/attachments/{id}} 引用
     * （导出不该因为脏数据失败，也不该给出指向包内空条目的路径）。
     */
    public void exportNoteZip(KbPrincipal principal, long noteId, HttpServletResponse response) throws IOException {
        ExportNote note = repository.findAliveNote(noteId, principal.spaceId())
                .orElseThrow(() -> ApiException.notFound("笔记不存在"));
        Map<Long, String> folderPaths = folderPathIndex(principal.spaceId());
        String folderPath = note.folderId() == null ? null : folderPaths.get(note.folderId());
        List<String> tags = repository.tagsOfNote(noteId);

        // 只打包正文引用到的附件：用与重写同一个正则提取 id，保证「重写到的 = 打包的」
        Map<Long, ExportAttachment> byId = new HashMap<>();
        for (ExportAttachment attachment : repository.attachments(principal.spaceId())) {
            byId.put(attachment.id(), attachment);
        }
        List<ExportAttachment> packable = new ArrayList<>();
        for (long id : referencedAttachmentIds(note.content())) {
            ExportAttachment attachment = byId.get(id);
            if (attachment == null) {
                continue;
            }
            if (!isStoredFileReadable(attachment)) {
                log.warn("单篇导出跳过缺失的附件: {}", attachment.storedName());
                continue;
            }
            packable.add(attachment);
        }
        Map<Long, String> destinations = attachmentDestinations(packable, new HashSet<>());

        String mdName = FileNames.sanitizeFileName(note.title(), note.id()) + ".md";
        String zipName = FileNames.sanitizeFileName(note.title(), note.id()) + ".zip";
        response.setStatus(HttpServletResponse.SC_OK);
        response.setContentType("application/zip");
        response.setHeader(HttpHeaders.CONTENT_DISPOSITION, FileNames.attachmentDisposition(zipName));

        List<String> attachmentEntries = new ArrayList<>();
        try (ZipOutputStream zip = new ZipOutputStream(response.getOutputStream(), StandardCharsets.UTF_8)) {
            // md 在包根：mdPath 就是文件名本身，引用不带 ../ 前缀
            writeEntry(zip, mdName, markdown(note, tags, folderPath, destinations, mdName)
                    .getBytes(StandardCharsets.UTF_8));
            for (ExportAttachment attachment : packable) {
                String entryPath = destinations.get(attachment.id());
                zip.putNextEntry(new ZipEntry(entryPath));
                Files.copy(resolveStoredPath(attachment.storedName()), zip);
                zip.closeEntry();
                attachmentEntries.add(attachmentJson(attachment, entryPath));
            }
            writeEntry(zip, "manifest.json",
                    manifestJson(principal.spaceId(), 1, List.of(noteJson(note, mdName, folderPath, tags)),
                            attachmentEntries).getBytes(StandardCharsets.UTF_8));
        }
        activities.record(principal.id(), noteId, ActivityService.ACTION_EXPORT);
    }

    /** 正文里引用到的附件 id（去重、保持出现顺序）；与 {@link #rewriteAttachmentUrls} 共用同一正则。 */
    static List<Long> referencedAttachmentIds(String content) {
        if (content == null || content.isEmpty()) {
            return List.of();
        }
        Set<Long> ids = new LinkedHashSet<>();
        Matcher matcher = ATTACHMENT_URL.matcher(content);
        while (matcher.find()) {
            ids.add(Long.parseLong(matcher.group(1)));
        }
        return List.copyOf(ids);
    }

    /** 纵深防御：任何落盘路径都必须 normalize 后仍在 uploads 目录内（API.md §7 安全要求 4）。 */
    private Path resolveStoredPath(String storedName) {
        Path path = uploadsDir.resolve(storedName).normalize();
        if (!path.startsWith(uploadsDir)) {
            throw ApiException.notFound("附件不存在");
        }
        return path;
    }

    private boolean isStoredFileReadable(ExportAttachment attachment) {
        try {
            return Files.isRegularFile(resolveStoredPath(attachment.storedName()));
        } catch (RuntimeException e) {
            return false;
        }
    }

    /**
     * 流式写 ZIP。头部先落地，之后任何异常都只能截断下载；因此所有查询都在写流之前完成。
     */
    public void exportAll(KbPrincipal principal, HttpServletResponse response) throws IOException {
        long spaceId = principal.spaceId();
        List<ExportNote> notes = repository.aliveNotes(spaceId);
        Map<Long, String> folderPaths = folderPathIndex(spaceId);
        Map<Long, List<String>> tagsByNote = repository.tagsByNote(spaceId);
        List<ExportAttachment> attachments = repository.attachments(spaceId);

        String zipName = "kb-export-" + LocalDate.now(ZoneOffset.UTC) + ".zip";
        response.setStatus(HttpServletResponse.SC_OK);
        response.setContentType("application/zip");
        response.setHeader(HttpHeaders.CONTENT_DISPOSITION, FileNames.attachmentDisposition(zipName));

        Set<String> usedPaths = new HashSet<>();
        List<String> noteEntries = new ArrayList<>();
        List<String> attachmentEntries = new ArrayList<>();
        // 先定附件条目名，正文重写才能指向 ZIP 里真实存在的条目（IMPORT-IMAGES.md §7）
        Map<Long, String> destinations = attachmentDestinations(attachments, usedPaths);

        try (ZipOutputStream zip = new ZipOutputStream(response.getOutputStream(), StandardCharsets.UTF_8)) {
            for (ExportNote note : notes) {
                String folderPath = note.folderId() == null ? null : folderPaths.get(note.folderId());
                String prefix = folderPath == null || folderPath.isBlank() ? "notes/" : "notes/" + folderPath + "/";
                String entryPath = FileNames.uniqueEntryPath(usedPaths,
                        prefix + FileNames.sanitizeFileName(note.title(), note.id()) + ".md");
                writeEntry(zip, entryPath,
                        markdown(note, tagsByNote.getOrDefault(note.id(), List.of()), folderPath, destinations,
                                entryPath).getBytes(StandardCharsets.UTF_8));
                noteEntries.add(noteJson(note, entryPath, folderPath, tagsByNote.getOrDefault(note.id(), List.of())));
            }

            for (ExportAttachment attachment : attachments) {
                Path source = uploadsDir.resolve(attachment.storedName()).normalize();
                if (!source.startsWith(uploadsDir) || !Files.isRegularFile(source)) {
                    log.warn("导出跳过缺失的附件: {}", attachment.storedName());
                    continue;
                }
                String entryPath = destinations.get(attachment.id());
                zip.putNextEntry(new ZipEntry(entryPath));
                Files.copy(source, zip);
                zip.closeEntry();
                attachmentEntries.add(attachmentJson(attachment, entryPath));
            }

            writeEntry(zip, "manifest.json", manifestJson(spaceId, notes.size(), noteEntries, attachmentEntries)
                    .getBytes(StandardCharsets.UTF_8));
        }
        activities.record(principal.id(), null, ActivityService.ACTION_EXPORT);
    }

    private static void writeEntry(ZipOutputStream zip, String entryPath, byte[] content) throws IOException {
        zip.putNextEntry(new ZipEntry(entryPath));
        zip.write(content);
        zip.closeEntry();
    }

    /** 目录 id → 相对路径（{@code 技术/Java}），逐级清洗每段名字。 */
    private Map<Long, String> folderPathIndex(long spaceId) {
        List<FolderRow> folders = repository.aliveFolders(spaceId);
        Map<Long, FolderRow> byId = new HashMap<>();
        for (FolderRow folder : folders) {
            byId.put(folder.id(), folder);
        }
        Map<Long, String> paths = new HashMap<>();
        for (FolderRow folder : folders) {
            resolvePath(folder, byId, paths);
        }
        return paths;
    }

    private String resolvePath(FolderRow folder, Map<Long, FolderRow> byId, Map<Long, String> cache) {
        String cached = cache.get(folder.id());
        if (cached != null) {
            return cached;
        }
        String name = FileNames.sanitizeSegment(folder.name());
        FolderRow parent = folder.parentId() == null ? null : byId.get(folder.parentId());
        String path = parent == null ? name : resolvePath(parent, byId, cache) + "/" + name;
        cache.put(folder.id(), path);
        return path;
    }

    /** 导出正文：front matter（title/tags/folder）+ 正文；正文里本库附件引用重写为相对该 md 的包内路径。 */
    private static String markdown(ExportNote note, List<String> tags, String folderPath,
            Map<Long, String> attachmentDestinations, String mdPath) {
        StringBuilder out = new StringBuilder();
        out.append("---\n");
        out.append("title: ").append(yamlString(note.title())).append('\n');
        if (!tags.isEmpty()) {
            out.append("tags: ").append(tags.stream().map(ExportService::yamlString)
                    .collect(Collectors.joining(", ", "[", "]"))).append('\n');
        }
        if (folderPath != null && !folderPath.isBlank()) {
            out.append("folder: ").append(yamlString(folderPath)).append('\n');
        }
        out.append("createdAt: ").append(yamlString(note.createdAt())).append('\n');
        out.append("updatedAt: ").append(yamlString(note.updatedAt())).append('\n');
        out.append("---\n\n").append(rewriteAttachmentUrls(note.content(), attachmentDestinations, mdPath));
        if (!note.content().endsWith("\n")) {
            out.append('\n');
        }
        return out.toString();
    }

    /**
     * IMPORT-IMAGES.md §7：{@code /api/attachments/{id}} → **相对该 .md 所在目录**的包内路径
     * （{@code ../attachments/{id}-{原名}}）。引用指向的附件在本库不存在时保留原文
     * （导出不该因为脏数据失败）。
     *
     * <p>先处理 {@code <img src="...">}：HTML 属性值里不能出现 {@code <}，所以那里直接写路径
     * （空格在引号内合法）；处理完之后属性里已经没有 {@code /api/attachments/}，
     * 第二遍的 Markdown 目标重写就不会再碰到它。
     */
    static String rewriteAttachmentUrls(String content, Map<Long, String> destinations, String mdPath) {
        if (content == null || content.isEmpty() || destinations.isEmpty()) {
            return content == null ? "" : content;
        }
        return rewriteMarkdownTargets(rewriteHtmlSources(content, destinations, mdPath), destinations, mdPath);
    }

    private static String rewriteHtmlSources(String content, Map<Long, String> destinations, String mdPath) {
        Matcher matcher = HTML_IMG_SRC.matcher(content);
        StringBuilder out = new StringBuilder(content.length() + 32);
        while (matcher.find()) {
            String url = matcher.group(3).trim();
            Matcher idMatcher = ATTACHMENT_URL.matcher(url);
            String replacement = matcher.group(0);
            if (idMatcher.matches()) {
                String destination = destinations.get(Long.parseLong(idMatcher.group(1)));
                if (destination != null) {
                    replacement = matcher.group(1) + matcher.group(2)
                            + FileNames.relativeToMd(mdPath, destination) + matcher.group(2);
                }
            }
            matcher.appendReplacement(out, Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(out);
        return out.toString();
    }

    private static String rewriteMarkdownTargets(String content, Map<Long, String> destinations, String mdPath) {
        Matcher matcher = ATTACHMENT_URL.matcher(content);
        StringBuilder out = new StringBuilder(content.length() + 32);
        while (matcher.find()) {
            String destination = destinations.get(Long.parseLong(matcher.group(1)));
            matcher.appendReplacement(out, Matcher.quoteReplacement(destination == null
                    ? matcher.group(0)
                    : FileNames.markdownReference(mdPath, destination)));
        }
        matcher.appendTail(out);
        return out.toString();
    }

    /** 附件 id → ZIP 内条目名（与正文里重写出来的目标逐字一致）。 */
    private static Map<Long, String> attachmentDestinations(List<ExportAttachment> attachments,
            Set<String> usedPaths) {
        Map<Long, String> destinations = new LinkedHashMap<>();
        for (ExportAttachment attachment : attachments) {
            destinations.put(attachment.id(), FileNames.uniqueEntryPath(usedPaths,
                    FileNames.attachmentEntryName(attachment.id(), attachment.originalName())));
        }
        return destinations;
    }

    private static String yamlString(String value) {
        String text = value == null ? "" : value;
        return '"' + text.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\r", " ").replace("\n", " ") + '"';
    }

    private static String manifestJson(long spaceId, int noteCount, List<String> noteEntries,
            List<String> attachmentEntries) {
        return "{\n"
                + "  \"version\": 1,\n"
                + "  \"exportedAt\": " + jsonString(Times.now()) + ",\n"
                + "  \"spaceId\": " + spaceId + ",\n"
                + "  \"noteCount\": " + noteCount + ",\n"
                + "  \"attachmentCount\": " + attachmentEntries.size() + ",\n"
                + "  \"notes\": [" + String.join(",", noteEntries) + "],\n"
                + "  \"attachments\": [" + String.join(",", attachmentEntries) + "]\n"
                + "}\n";
    }

    private static String noteJson(ExportNote note, String path, String folderPath, List<String> tags) {
        String folder = folderPath == null || folderPath.isBlank() ? "null" : jsonString(folderPath);
        String tagJson = tags.stream().map(ExportService::jsonString).collect(Collectors.joining(", ", "[", "]"));
        return "\n    {\"id\":" + note.id()
                + ",\"title\":" + jsonString(note.title())
                + ",\"path\":" + jsonString(path)
                + ",\"folder\":" + folder
                + ",\"tags\":" + tagJson
                + ",\"createdAt\":" + jsonString(note.createdAt())
                + ",\"updatedAt\":" + jsonString(note.updatedAt()) + "}";
    }

    private static String attachmentJson(ExportAttachment attachment, String path) {
        return "\n    {\"id\":" + attachment.id()
                + ",\"noteId\":" + (attachment.noteId() == null ? "null" : attachment.noteId())
                + ",\"path\":" + jsonString(path)
                + ",\"originalName\":" + jsonString(attachment.originalName())
                + ",\"mimeType\":" + jsonString(attachment.mimeType())
                + ",\"sizeBytes\":" + attachment.sizeBytes()
                + ",\"sha256\":" + jsonString(attachment.sha256()) + "}";
    }

    /** 最小 JSON 字符串转义（manifest 只含我们自己拼装的对象，不引入额外序列化依赖）。 */
    static String jsonString(String value) {
        StringBuilder out = new StringBuilder(value.length() + 2).append('"');
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> {
                    if (c < 0x20) {
                        out.append(String.format("\\u%04x", (int) c));
                    } else {
                        out.append(c);
                    }
                }
            }
        }
        return out.append('"').toString();
    }
}
