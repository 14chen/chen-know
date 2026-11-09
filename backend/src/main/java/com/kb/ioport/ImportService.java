package com.kb.ioport;

import com.kb.activity.ActivityService;
import com.kb.attachment.AttachmentResponse;
import com.kb.attachment.AttachmentService;
import com.kb.common.ApiException;
import com.kb.common.ErrorCode;
import com.kb.common.SearchText;
import com.kb.common.Times;
import com.kb.link.LinkService;
import com.kb.note.Excerpt;
import com.kb.note.NotePatch;
import com.kb.note.NoteService;
import com.kb.user.KbPrincipal;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;

/**
 * API.md §10 / IMPORT-IMAGES.md：多个 {@code .md}、图片素材或一个 {@code .zip}。
 *
 * <p>解析规则：front matter 的 title/tags/folder 优先 → 文件名（去扩展名）→ 正文第一个 H1。
 * 单个文件失败只进 {@code errors[]}，不影响其余文件。
 *
 * <p>两阶段：{@code parse()} 只做「读 + 校验 + 解析」，任何硬校验失败（条目数/解压总大小）都在
 * 写库之前整批拒绝；{@code importMarkdown()} 才落库，并按 {@link #IMPORT_BATCH_SIZE} 分批提交事务。
 *
 * <p>图片：所有非 Markdown 输入先进入相对路径索引（{@link AssetIndex}），正文里的图片引用
 * 按 §3.4 三级匹配；命中就经 {@link AttachmentService} 上传并重写为 {@code /api/attachments/{id}}，
 * 未命中则原样保留并记入 {@code missingImages}。
 */
@Service
public class ImportService {

    private static final Logger log = LoggerFactory.getLogger(ImportService.class);

    /** API.md §10：ZIP 条目数上限 2000（多选/文件夹同样适用）。 */
    static final int MAX_ZIP_ENTRIES = 2000;
    /** API.md §10：解压后总大小上限 200 MB。 */
    static final long MAX_UNCOMPRESSED_BYTES = 200L * 1024 * 1024;
    /** 每批提交的笔记数：批量事务把 1000 篇的提交次数从 1000 降到 5（DEF-E3-004）。 */
    static final int IMPORT_BATCH_SIZE = 200;
    /** 与 note 模块的标题上限一致（导入用截断而非报错，避免一个长标题作废整个文件）。 */
    private static final int MAX_TITLE_LENGTH = 512;
    /** 与 note 模块的标签名上限一致。 */
    private static final int MAX_TAG_NAME_LENGTH = 64;
    /** Zip Slip 校验的虚拟目标目录；导入不落盘，只做 normalize 越界判定。 */
    private static final Path ZIP_ROOT = Path.of("kb-import-root").toAbsolutePath().normalize();

    /**
     * 单独选择上传时允许作为图片素材的扩展名（IMPORT-IMAGES.md §6.1 的白名单口径）。
     * 这里只判断「像图片」，具体类型是否受支持仍由 AttachmentService 的白名单裁决。
     */
    private static final Set<String> IMAGE_EXTENSIONS = Set.of(
            "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "tif", "tiff", "avif", "heic");

    private final ImportRepository repository;
    private final ActivityService activities;
    private final LinkService linkService;
    private final AttachmentService attachmentService;
    private final NoteService noteService;
    private final TransactionTemplate transactionTemplate;

    public ImportService(ImportRepository repository, ActivityService activities, LinkService linkService,
            AttachmentService attachmentService, NoteService noteService,
            PlatformTransactionManager transactionManager) {
        this.repository = repository;
        this.activities = activities;
        this.linkService = linkService;
        this.attachmentService = attachmentService;
        this.noteService = noteService;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    public ImportPreviewResponse preview(KbPrincipal principal, MultipartFile[] files) {
        Batch batch = parse(files);
        List<ImportPreviewItem> items = batch.prepared.stream()
                .map(prepared -> new ImportPreviewItem(prepared.note().title(), prepared.note().sourceFile(),
                        prepared.note().tags(), prepared.note().folderPath(), prepared.note().sizeBytes()))
                .toList();
        // preview 不上传；imagesImported 是「将会被导入的图片数量」（契约 §6.2 的预告语义）
        long planned = batch.prepared.stream().mapToLong(prepared -> prepared.images().size()).sum();
        return new ImportPreviewResponse(items, items.size(), List.copyOf(batch.errors), planned,
                List.copyOf(batch.missingImages));
    }

    public ImportResult importMarkdown(KbPrincipal principal, MultipartFile[] files) {
        // parse() 已完成全部前置校验（条目数 / 解压总大小 / 编码 / 路径）：校验不过直接抛异常，
        // 到这里说明整批都允许写库，绝不会出现「报错说已拒绝、实际却写了一半」。
        Batch batch = parse(files);
        List<String> errors = new ArrayList<>(batch.errors);
        List<MissingImage> missingImages = new ArrayList<>(batch.missingImages);
        List<ImportedNote> inserted = new ArrayList<>();
        long imagesImported = 0;
        List<PreparedNote> preparedNotes = batch.prepared;
        for (int from = 0; from < preparedNotes.size(); from += IMPORT_BATCH_SIZE) {
            List<PreparedNote> chunk = preparedNotes.subList(from, Math.min(preparedNotes.size(), from + IMPORT_BATCH_SIZE));
            List<ImportedNote> chunkNotes = new ArrayList<>();
            long[] chunkImages = {0};
            try {
                // 一个事务里插入整批：1000 篇只需 5 次提交（DEF-E3-004），批内失败则整批回滚
                transactionTemplate.execute(status -> {
                    Map<String, Long> folderCache = new HashMap<>();
                    for (PreparedNote prepared : chunk) {
                        PendingNote pending = prepared.note();
                        long noteId = insertNote(principal, pending, folderCache);
                        chunkNotes.add(new ImportedNote(noteId, pending.title(), pending.sourceFile()));
                        chunkImages[0] += attachImages(principal, noteId, pending, prepared.images(), missingImages);
                    }
                    return null;
                });
                imagesImported += chunkImages[0];
                inserted.addAll(chunkNotes);
            } catch (RuntimeException e) {
                // 该批整体回滚（不留半条数据）；其余批次继续，符合 §10「单个文件失败只进 errors」
                for (PreparedNote prepared : chunk) {
                    errors.add(prepared.note().sourceFile() + ": " + rootMessage(e));
                }
                log.warn("导入批次失败（第 {} 篇起，共 {} 篇），已回滚该批", from, chunk.size(), e);
            }
        }
        int imported = inserted.size();
        // 批次内顺序依赖：先导入的笔记若链接到后导入的，rebuild 时目标还不存在（target_note_id 为 NULL），
        // 全部导完后必须按标题回填一次，否则 [[链接]] 永远停在 dangling。
        for (ImportedNote note : inserted) {
            try {
                linkService.backfillDangling(principal.spaceId(), note.noteId(), note.title());
            } catch (RuntimeException e) {
                errors.add(note.sourceFile() + ": 回填悬空链接失败（" + rootMessage(e) + "）");
                log.warn("回填悬空链接失败: note={}", note.noteId(), e);
            }
        }
        return new ImportResult(imported, batch.skippedTotal(), errors, imagesImported, missingImages);
    }

    // ------------------------------------------------------------------ 写入

    private long insertNote(KbPrincipal principal, PendingNote pending, Map<String, Long> folderCache) {
        long spaceId = principal.spaceId();
        String now = Times.now();
        Long folderId = resolveFolder(spaceId, pending.folderPath(), folderCache, now);
        String blob = SearchText.normalize(pending.title() + "\n" + pending.content());
        long noteId = repository.insertNote(spaceId, folderId, pending.title(), pending.content(),
                Excerpt.of(pending.content()), blob, now);
        // 与 NoteService.create 一致：新建后立即重建出链（解析 [[标题]] → target_note_id）
        linkService.rebuild(spaceId, noteId, pending.content());
        for (String tag : pending.tags()) {
            repository.ensureTag(spaceId, tag);
            Long tagId = repository.findTagId(spaceId, tag);
            if (tagId != null) {
                repository.linkNoteTag(noteId, tagId);
            }
        }
        activities.record(principal.id(), noteId, ActivityService.ACTION_IMPORT);
        return noteId;
    }

    /**
     * IMPORT-IMAGES.md §5：逐个上传命中的图片（带 noteId），成功一个就重写一个引用，
     * 最后用 note 模块的 PATCH 落库（顺带产生版本历史、重算 search_blob）。
     *
     * @return 成功上传的图片数；没有图片引用时直接返回 0，不做多余的 PATCH
     */
    private int attachImages(KbPrincipal principal, long noteId, PendingNote pending,
            List<ResolvedImage> images, List<MissingImage> missingOut) {
        if (images.isEmpty()) {
            return 0;
        }
        List<Replacement> replacements = new ArrayList<>();
        for (ResolvedImage image : images) {
            try {
                AttachmentResponse uploaded = attachmentService.upload(principal,
                        new ByteMultipartFile(image.baseName(), image.bytes()), noteId);
                replacements.add(new Replacement(image.start(), image.end(), "/api/attachments/" + uploaded.id()));
            } catch (ApiException e) {
                String reason = switch (e.code()) {
                    case UNSUPPORTED_MEDIA_TYPE -> MissingImage.REASON_UNSUPPORTED_TYPE;
                    case PAYLOAD_TOO_LARGE -> MissingImage.REASON_TOO_LARGE;
                    default -> null;
                };
                if (reason == null) {
                    throw e;
                }
                missingOut.add(new MissingImage(pending.sourceFile(), pending.title(), image.line(),
                        image.rawTarget(), reason));
            }
        }
        if (replacements.isEmpty()) {
            return 0;
        }
        noteService.patch(principal.id(), principal.spaceId(), noteId,
                new NotePatch(false, null, false, null, true, applyReplacements(pending.content(), replacements),
                        false, null, false, null, false, null));
        return replacements.size();
    }

    /** 从后往前替换，避免前面的替换让后面的下标失效。 */
    static String applyReplacements(String content, List<Replacement> replacements) {
        List<Replacement> ordered = new ArrayList<>(replacements);
        ordered.sort(Comparator.comparingInt(Replacement::start).reversed());
        StringBuilder out = new StringBuilder(content);
        for (Replacement replacement : ordered) {
            out.replace(replacement.start(), replacement.end(), replacement.text());
        }
        return out.toString();
    }

    /** 按 {@code 技术/Java} 逐级查找或创建目录。 */
    private Long resolveFolder(long spaceId, String folderPath, Map<String, Long> cache, String now) {
        if (folderPath == null || folderPath.isBlank()) {
            return null;
        }
        Long cached = cache.get(folderPath);
        if (cached != null) {
            return cached;
        }
        Long parentId = null;
        StringBuilder walked = new StringBuilder();
        for (String segment : folderPath.split("/")) {
            if (segment.isBlank()) {
                continue;
            }
            walked.append(walked.length() == 0 ? "" : "/").append(segment);
            Long folderId = repository.findAliveFolderId(spaceId, parentId, segment);
            if (folderId == null) {
                folderId = repository.insertFolder(spaceId, parentId, segment, now);
            }
            parentId = folderId;
            cache.putIfAbsent(walked.toString(), folderId);
        }
        return parentId;
    }

    // ------------------------------------------------------------------ 解析

    private Batch parse(MultipartFile[] files) {
        if (files == null || files.length == 0) {
            throw ApiException.validation("缺少上传文件 file", "file");
        }
        long totalBytes = 0;
        for (MultipartFile file : files) {
            totalBytes += file.getSize();
        }
        if (files.length > MAX_ZIP_ENTRIES) {
            throw new ApiException(ErrorCode.PAYLOAD_TOO_LARGE,
                    "文件数超过上限 " + MAX_ZIP_ENTRIES + "，已拒绝整批");
        }
        if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
            throw new ApiException(ErrorCode.PAYLOAD_TOO_LARGE, "总大小超过 200 MB 上限，已拒绝整批");
        }

        Batch batch = new Batch();
        for (MultipartFile file : files) {
            String rawName = file.getOriginalFilename() == null ? "" : file.getOriginalFilename().trim();
            if (rawName.isEmpty()) {
                rawName = "file";
            }
            if (file.isEmpty()) {
                batch.skipped++;
                continue;
            }
            // 前端用 filename 携带相对路径（文件夹选择 / webkitRelativePath）；含 .. 或盘符直接拒绝
            String path = normalizeUploadPath(rawName);
            if (path == null) {
                batch.errors.add(rawName + ": 文件名含非法路径（绝对路径、盘符或 ..），已拒绝");
                continue;
            }
            try {
                byte[] bytes = file.getBytes();
                if (isZip(path, file.getContentType())) {
                    readZip(path, bytes, batch);
                } else if (isMarkdown(path)) {
                    addMarkdown(path, path, null, path, bytes, batch);
                } else if (isImageCandidate(path)) {
                    batch.index.put(path, bytes, true);
                } else {
                    batch.errors.add(path + ": 不支持的文件类型（仅支持 .md / .markdown / .zip / 图片）");
                }
            } catch (ApiException e) {
                // 硬校验失败（条目数/解压总大小超限）必须整批拒绝：不能带病继续写入
                throw e;
            } catch (Exception e) {
                batch.errors.add(path + ": " + rootMessage(e));
            }
        }
        batch.prepare(resolveImages(batch));
        return batch;
    }

    private void readZip(String zipName, byte[] bytes, Batch batch) {
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(bytes), StandardCharsets.UTF_8)) {
            int entries = 0;
            long total = 0;
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (++entries > MAX_ZIP_ENTRIES) {
                    // 先校验后落库：超限时直接拒绝整批，交由 parse() 冒泡到接口层（HTTP 413）
                    throw new ApiException(ErrorCode.PAYLOAD_TOO_LARGE,
                            zipName + ": ZIP 条目数超过上限 " + MAX_ZIP_ENTRIES + "，已拒绝整个压缩包（未写入任何笔记）");
                }
                String entryName = entry.getName();
                if (entry.isDirectory() || entryName.endsWith("/")) {
                    continue;
                }
                String safePath = safeEntryPath(entryName);
                if (safePath == null) {
                    // Zip Slip：绝对路径 / .. 越界 / 盘符，逐条目拒绝
                    batch.errors.add(zipName + ": 条目 " + entryName + " 含非法路径（绝对路径或 ..），已拒绝");
                    continue;
                }
                byte[] content = readBounded(zip, MAX_UNCOMPRESSED_BYTES - total);
                if (content == null) {
                    throw new ApiException(ErrorCode.PAYLOAD_TOO_LARGE,
                            zipName + ": 解压后总大小超过 200 MB 上限，已拒绝整个压缩包（未写入任何笔记）");
                }
                total += content.length;
                if (isMarkdown(safePath)) {
                    addMarkdown(zipName + ":" + safePath, safePath, directoryOf(safePath), safePath, content, batch);
                } else {
                    // 压缩包里的其它文件都收进索引：图片被引用才算「用上」；两者都**不**计入 skipped 的图片部分
                    batch.index.put(safePath, content, isImageCandidate(safePath));
                }
            }
        } catch (IOException e) {
            batch.errors.add(zipName + ": ZIP 解析失败（" + rootMessage(e) + "）");
        }
    }

    /**
     * IMPORT-IMAGES.md §3：解析每篇笔记的图片引用并建索引匹配。
     *
     * <p>只做解析与匹配（纯内存），因此 preview 与 import 走同一条路径；上传发生在 import 阶段。
     */
    private List<PreparedNote> resolveImages(Batch batch) {
        List<PreparedNote> prepared = new ArrayList<>(batch.notes.size());
        for (PendingNote note : batch.notes) {
            ImageRefs.Result parsed = ImageRefs.parse(note.content());
            for (ImageRefs.UnsupportedRef unsupported : parsed.unsupported()) {
                batch.missingImages.add(new MissingImage(note.sourceFile(), note.title(), unsupported.line(),
                        unsupported.raw(), unsupported.reason()));
            }
            List<ResolvedImage> images = new ArrayList<>();
            for (ImageRefs.Ref ref : parsed.refs()) {
                if (ImageRefs.isExternallyHandled(ref.target())) {
                    continue;
                }
                final String normalized;
                try {
                    normalized = ImageRefs.normalizeTarget(note.mdPath(), ref.target());
                } catch (IllegalArgumentException e) {
                    batch.missingImages.add(new MissingImage(note.sourceFile(), note.title(), ref.line(),
                            ref.target(), MissingImage.REASON_ILLEGAL_PATH));
                    continue;
                }
                AssetIndex.Match match = batch.index.match(normalized);
                if (match == null) {
                    batch.missingImages.add(new MissingImage(note.sourceFile(), note.title(), ref.line(),
                            ref.target(), MissingImage.REASON_NOT_FOUND));
                    continue;
                }
                images.add(new ResolvedImage(ref.line(), ref.target(), ref.start(), ref.end(),
                        AssetIndex.basename(match.path()), match.bytes()));
            }
            prepared.add(new PreparedNote(note, images));
        }
        return prepared;
    }

    /**
     * Zip Slip 校验：条目名 normalize 后必须仍在虚拟目标目录内，且不得是绝对路径或含盘符。
     * 导入只在内存里解析条目（不落盘），此校验是纵深防御。
     */
    static String safeEntryPath(String entryName) {
        if (entryName == null || entryName.isBlank() || entryName.indexOf('\0') >= 0 || entryName.indexOf(':') >= 0) {
            return null;
        }
        if (entryName.startsWith("/") || entryName.startsWith("\\")) {
            return null;
        }
        try {
            if (Path.of(entryName).isAbsolute()) {
                return null;
            }
            if (!ZIP_ROOT.resolve(entryName).normalize().startsWith(ZIP_ROOT)) {
                return null;
            }
        } catch (InvalidPathException e) {
            return null;
        }
        return entryName.replace('\\', '/');
    }

    /** 多选 / 文件夹选择时 filename 携带的相对路径归一化；非法（`..`、盘符、绝对路径）返回 null。 */
    static String normalizeUploadPath(String rawName) {
        String name = rawName.replace('\\', '/');
        while (name.startsWith("./")) {
            name = name.substring(2);
        }
        if (name.startsWith("/") || name.indexOf(':') >= 0 || name.indexOf('\0') >= 0) {
            return null;
        }
        List<String> segments = new ArrayList<>();
        for (String segment : name.split("/")) {
            if (segment.isEmpty() || ".".equals(segment)) {
                continue;
            }
            if ("..".equals(segment)) {
                return null;
            }
            segments.add(segment);
        }
        return segments.isEmpty() ? null : String.join("/", segments);
    }

    private static byte[] readBounded(InputStream in, long budget) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        long total = 0;
        int read;
        while ((read = in.read(buffer)) >= 0) {
            total += read;
            if (total > budget) {
                return null;
            }
            out.write(buffer, 0, read);
        }
        return out.toByteArray();
    }

    /**
     * @param errorLabel 报错前缀：普通文件是文件名，ZIP 内条目是 {@code 包名:条目路径}
     * @param sourceFile 预览展示用的来源（ZIP 内为相对路径）
     * @param mdPath     归一化相对路径，用于把图片引用解析到同一个相对路径空间
     */
    private void addMarkdown(String errorLabel, String sourceFile, String folderHint, String mdPath, byte[] bytes,
            Batch batch) {
        final String text;
        try {
            text = decodeText(bytes);
        } catch (IllegalArgumentException e) {
            batch.errors.add(errorLabel + ": " + e.getMessage());
            return;
        }
        if (text.isBlank()) {
            // 契约 §10.3：空文件（空格/空行）计入 skipped，绝不落成空笔记
            batch.skipped++;
            return;
        }
        MarkdownFrontMatter.Parsed parsed = MarkdownFrontMatter.parse(text);
        String title = firstNonBlank(parsed.frontMatter().title(), baseNameOf(mdPath),
                MarkdownText.firstHeading(parsed.body()));
        if (title == null) {
            title = "未命名";
        }
        String folder = firstNonBlank(parsed.frontMatter().folder(), folderHint);
        batch.notes.add(new PendingNote(trimTo(title.strip(), MAX_TITLE_LENGTH), sourceFile, mdPath,
                cleanTags(parsed.frontMatter().tags()), cleanFolderPath(folder), parsed.body(), bytes.length));
    }

    /** 标签名对齐 note 模块的约束：去空白、限长 64、大小写不敏感去重。 */
    private static List<String> cleanTags(List<String> rawTags) {
        List<String> tags = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (String raw : rawTags) {
            if (raw == null) {
                continue;
            }
            String name = trimTo(raw.strip(), MAX_TAG_NAME_LENGTH);
            if (name.isEmpty() || !seen.add(name.toLowerCase(Locale.ROOT))) {
                continue;
            }
            tags.add(name);
        }
        return List.copyOf(tags);
    }

    /** BOM 感知的严格解码：非法字节序列直接报错，不静默替换成 U+FFFD。 */
    static String decodeText(byte[] bytes) {
        Charset charset = StandardCharsets.UTF_8;
        int offset = 0;
        if (bytes.length >= 3 && (bytes[0] & 0xFF) == 0xEF && (bytes[1] & 0xFF) == 0xBB && (bytes[2] & 0xFF) == 0xBF) {
            offset = 3;
        } else if (bytes.length >= 2 && (bytes[0] & 0xFF) == 0xFF && (bytes[1] & 0xFF) == 0xFE) {
            charset = StandardCharsets.UTF_16LE;
            offset = 2;
        } else if (bytes.length >= 2 && (bytes[0] & 0xFF) == 0xFE && (bytes[1] & 0xFF) == 0xFF) {
            charset = StandardCharsets.UTF_16BE;
            offset = 2;
        }
        try {
            return charset.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes, offset, bytes.length - offset))
                    .toString();
        } catch (CharacterCodingException e) {
            throw new IllegalArgumentException("编码无法识别（不是合法的 UTF-8，请另存为 UTF-8）");
        }
    }

    private static boolean isMarkdown(String name) {
        String lower = name == null ? "" : name.toLowerCase(Locale.ROOT);
        return lower.endsWith(".md") || lower.endsWith(".markdown");
    }

    private static boolean isZip(String name, String contentType) {
        String type = contentType == null ? "" : contentType.toLowerCase(Locale.ROOT);
        return name.toLowerCase(Locale.ROOT).endsWith(".zip") || type.contains("zip");
    }

    private static boolean isImageCandidate(String name) {
        int dot = name.lastIndexOf('.');
        if (dot < 0) {
            return false;
        }
        return IMAGE_EXTENSIONS.contains(name.substring(dot + 1).toLowerCase(Locale.ROOT));
    }

    /** 我们自己的导出格式是 {@code notes/<目录路径>/<标题>.md}，去掉前缀 notes/ 还原真实目录。 */
    private static String directoryOf(String safeEntryPath) {
        int slash = safeEntryPath.lastIndexOf('/');
        if (slash < 0) {
            return null;
        }
        String dir = safeEntryPath.substring(0, slash);
        if (dir.equalsIgnoreCase("notes")) {
            return null;
        }
        if (dir.regionMatches(true, 0, "notes/", 0, "notes/".length())) {
            return dir.substring("notes/".length());
        }
        return dir;
    }

    private static String cleanFolderPath(String folder) {
        if (folder == null || folder.isBlank()) {
            return null;
        }
        StringBuilder out = new StringBuilder();
        for (String part : folder.split("[\\\\/]")) {
            if (part.isBlank()) {
                continue;
            }
            if (out.length() > 0) {
                out.append('/');
            }
            out.append(FileNames.sanitizeSegment(part));
        }
        return out.length() == 0 ? null : out.toString();
    }

    private static String baseNameOf(String name) {
        if (name == null) {
            return "";
        }
        String base = name.replace('\\', '/');
        int slash = base.lastIndexOf('/');
        if (slash >= 0) {
            base = base.substring(slash + 1);
        }
        int dot = base.lastIndexOf('.');
        return dot > 0 ? base.substring(0, dot) : base;
    }

    private static String firstNonBlank(String... values) {
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                return value;
            }
        }
        return null;
    }

    private static String trimTo(String value, int max) {
        return value.length() > max ? value.substring(0, max) : value;
    }

    private static String rootMessage(Throwable error) {
        Throwable root = error;
        while (root.getCause() != null && root.getCause() != root) {
            root = root.getCause();
        }
        String message = root.getMessage();
        return message == null || message.isBlank() ? root.getClass().getSimpleName() : message;
    }

    /** 索引里的相对路径与字节。 */
    private record ResolvedImage(int line, String rawTarget, int start, int end, String baseName, byte[] bytes) {
    }

    /** 正文里要替换的一段：{@code [start, end)} → {@code text}。 */
    private record Replacement(int start, int end, String text) {
    }

    /** 解析出来的笔记（尚未入库）。 */
    private record PendingNote(String title, String sourceFile, String mdPath, List<String> tags, String folderPath,
            String content, long sizeBytes) {
    }

    /** 笔记 + 已匹配到的图片。 */
    private record PreparedNote(PendingNote note, List<ResolvedImage> images) {
    }

    /** 批次结束后回填悬空链接所需的上下文。 */
    private record ImportedNote(long noteId, String title, String sourceFile) {
    }

    private static final class Batch {
        private final AssetIndex index = new AssetIndex();
        private final List<PendingNote> notes = new ArrayList<>();
        private final List<String> errors = new ArrayList<>();
        private final List<MissingImage> missingImages = new ArrayList<>();
        /** 空文件等显式跳过的数量；未被引用的素材在 skippedTotal() 里累加。 */
        private int skipped;
        private List<PreparedNote> prepared = List.of();

        private void prepare(List<PreparedNote> preparedNotes) {
            this.prepared = preparedNotes;
        }

        /**
         * 契约 §10.3：skipped = 主动跳过但不算错的条目 —— 空文件 + 「既不是 .md 也不是图片」的无关条目。
         * 图片类条目（无论是否被引用）都不计入 skipped，因此这里只累加非图片的未引用素材（DEF-E1-003）。
         */
        private long skippedTotal() {
            return skipped + index.unreferencedNonImageCount();
        }
    }
}
