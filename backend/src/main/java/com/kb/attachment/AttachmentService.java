package com.kb.attachment;

import com.kb.common.ApiException;
import com.kb.common.ErrorCode;
import com.kb.common.Times;
import com.kb.db.DataDirectory;
import com.kb.user.KbPrincipal;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

/** API.md §7 附件服务：白名单、服务端生成落盘名、路径穿越校验、跨空间隔离。 */
@Service
public class AttachmentService {

    private static final Logger log = LoggerFactory.getLogger(AttachmentService.class);

    /** API.md §7 安全要求 2：单文件 20 MB。 */
    static final long MAX_SIZE_BYTES = 20L * 1024 * 1024;

    private final AttachmentRepository attachments;
    private final Path uploadsDir;

    public AttachmentService(AttachmentRepository attachments, @Value("${kb.data-dir:}") String configuredDataDir) {
        this.attachments = attachments;
        try {
            this.uploadsDir = DataDirectory.resolve(configuredDataDir, Path.of(System.getProperty("user.dir")))
                    .resolve("uploads")
                    .normalize();
            Files.createDirectories(uploadsDir);
        } catch (IOException e) {
            throw new IllegalStateException("无法初始化附件目录", e);
        }
    }

    public AttachmentResponse upload(KbPrincipal principal, MultipartFile file, Long noteId) {
        if (file == null || file.isEmpty()) {
            throw ApiException.validation("缺少上传文件 file", "file");
        }
        if (file.getSize() > MAX_SIZE_BYTES) {
            throw new ApiException(ErrorCode.PAYLOAD_TOO_LARGE, "附件超出 20 MB 上限", "file");
        }
        String mimeType = AttachmentTypes.resolveMimeType(file.getContentType(), file.getOriginalFilename());
        if (mimeType == null) {
            throw new ApiException(ErrorCode.UNSUPPORTED_MEDIA_TYPE,
                    "不支持的附件类型（仅允许 png/jpeg/gif/webp/svg、pdf、txt/md、zip）", "file");
        }
        if (noteId != null && !attachments.isAliveNoteInSpace(noteId, principal.spaceId())) {
            throw ApiException.notFound("笔记不存在");
        }

        String originalName = displayName(file.getOriginalFilename());
        // 安全要求 3：磁盘名完全由服务端生成，客户端文件名不参与路径构造
        String storedName = principal.spaceId() + "/" + UUID.randomUUID() + AttachmentTypes.extensionOfMime(mimeType);
        Path target = resolveStoredPath(storedName);
        try {
            Files.createDirectories(target.getParent());
        } catch (IOException e) {
            throw new IllegalStateException("无法创建附件目录: " + target.getParent(), e);
        }

        byte[] digest;
        long sizeBytes;
        try {
            CopyResult copied = copyToDisk(file, target);
            sizeBytes = copied.bytes();
            digest = copied.sha256();
        } catch (IOException e) {
            deleteQuietly(target);
            throw new UncheckedIOException("附件落盘失败", e);
        } catch (RuntimeException e) {
            deleteQuietly(target);
            throw e;
        }

        try {
            long id = attachments.insert(principal.spaceId(), noteId, storedName, originalName, mimeType,
                    sizeBytes, HexFormat.of().formatHex(digest), Times.now());
            return AttachmentResponse.of(new Attachment(id, principal.spaceId(), noteId, storedName, originalName,
                    mimeType, sizeBytes, HexFormat.of().formatHex(digest), null));
        } catch (RuntimeException e) {
            deleteQuietly(target);
            throw e;
        }
    }

    public ResponseEntity<Resource> download(KbPrincipal principal, long id) {
        Attachment attachment = attachments.findByIdAndSpace(id, principal.spaceId())
                .orElseThrow(() -> ApiException.notFound("附件不存在"));
        Path path = resolveStoredPath(attachment.storedName());
        if (!Files.isRegularFile(path)) {
            throw ApiException.notFound("附件不存在");
        }
        long size;
        try {
            size = Files.size(path);
        } catch (IOException e) {
            throw new UncheckedIOException("读取附件失败", e);
        }
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType(attachment.mimeType()));
        headers.setContentLength(size);
        // 安全要求 5：按记录的 MIME 返回 + nosniff；SVG 强制下载
        headers.add("X-Content-Type-Options", "nosniff");
        headers.set(HttpHeaders.CONTENT_DISPOSITION, contentDisposition(attachment));
        return ResponseEntity.ok().headers(headers).body(new FileSystemResource(path));
    }

    /**
     * 附件体检：表里有但文件没了（missing）、磁盘上有但表里没有（orphans）。
     *
     * <p>只管当前空间：磁盘只扫 {@code uploads/<spaceId>/}，路径一律走 {@link #resolveStoredPath}，
     * 不引入任何路径穿越。
     */
    public AttachmentHealth health(KbPrincipal principal) {
        long spaceId = principal.spaceId();
        List<AttachmentRepository.SpaceAttachment> rows = attachments.findBySpace(spaceId);
        List<AttachmentHealth.MissingItem> missingItems = new ArrayList<>();
        Set<String> known = new HashSet<>();
        int ok = 0;
        for (AttachmentRepository.SpaceAttachment row : rows) {
            known.add(row.storedName());
            Path path;
            try {
                path = resolveStoredPath(row.storedName());
            } catch (RuntimeException e) {
                path = null;                                // 非法 stored_name 一律当缺失，绝不越界读盘
            }
            if (path != null && Files.isRegularFile(path)) {
                ok++;
            } else {
                missingItems.add(new AttachmentHealth.MissingItem(row.id(), row.noteId(), row.noteTitle(),
                        row.originalName(), row.sizeBytes()));
            }
        }
        List<AttachmentHealth.OrphanItem> orphans = new ArrayList<>();
        Path spaceDir = uploadsDir.resolve(String.valueOf(spaceId)).normalize();
        if (spaceDir.startsWith(uploadsDir) && Files.isDirectory(spaceDir)) {
            try (Stream<Path> files = Files.list(spaceDir)) {
                files.filter(Files::isRegularFile).forEach(path -> {
                    String relative = spaceId + "/" + path.getFileName();
                    if (!known.contains(relative)) {
                        try {
                            orphans.add(new AttachmentHealth.OrphanItem(relative, Files.size(path)));
                        } catch (IOException e) {
                            orphans.add(new AttachmentHealth.OrphanItem(relative, 0L));
                        }
                    }
                });
            } catch (IOException e) {
                log.warn("扫描附件目录失败: {}", e.toString());
            }
        }
        if (!missingItems.isEmpty()) {
            log.warn("附件体检发现 {} 个文件缺失（空间 {}）", missingItems.size(), spaceId);
        }
        return new AttachmentHealth(rows.size(), ok, missingItems.size(), missingItems, orphans);
    }

    public void delete(KbPrincipal principal, long id) {
        Attachment attachment = attachments.findByIdAndSpace(id, principal.spaceId())
                .orElseThrow(() -> ApiException.notFound("附件不存在"));
        if (attachments.deleteByIdAndSpace(id, principal.spaceId()) == 0) {
            throw ApiException.notFound("附件不存在");
        }
        deleteQuietly(resolveStoredPath(attachment.storedName()));
    }

    /**
     * 安全要求 4：任何落盘/读取路径都必须 normalize 后仍位于 uploads 目录内。
     * {@code storedName} 由服务端生成，这里是纵深防御。
     */
    private Path resolveStoredPath(String storedName) {
        Path path = uploadsDir.resolve(storedName).normalize();
        if (!path.startsWith(uploadsDir)) {
            throw ApiException.notFound("附件不存在");
        }
        return path;
    }

    private CopyResult copyToDisk(MultipartFile file, Path target) throws IOException {
        MessageDigest sha256;
        try {
            sha256 = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("JVM 缺少 SHA-256", e);
        }
        long total = 0;
        byte[] buffer = new byte[8192];
        try (InputStream in = new DigestInputStream(file.getInputStream(), sha256);
                OutputStream out = Files.newOutputStream(target, StandardOpenOption.CREATE_NEW,
                        StandardOpenOption.WRITE)) {
            int read;
            while ((read = in.read(buffer)) >= 0) {
                total += read;
                if (total > MAX_SIZE_BYTES) {
                    throw new ApiException(ErrorCode.PAYLOAD_TOO_LARGE, "附件超出 20 MB 上限", "file");
                }
                out.write(buffer, 0, read);
            }
        }
        return new CopyResult(total, sha256.digest());
    }

    private String contentDisposition(Attachment attachment) {
        String type = AttachmentTypes.isInlineSafe(attachment.mimeType()) ? "inline" : "attachment";
        String name = attachment.originalName();
        return type + "; filename=\"" + asciiFallback(name) + "\"; filename*=UTF-8''" + rfc5987(name);
    }

    /** 头部 ASCII 兜底名：非 ASCII、引号、反斜杠、控制字符一律替换，避免头部注入。 */
    static String asciiFallback(String name) {
        StringBuilder out = new StringBuilder(name.length());
        for (int i = 0; i < name.length(); i++) {
            char c = name.charAt(i);
            out.append(c > 0x20 && c < 0x7F && c != '"' && c != '\\' && c != '%' ? c : '_');
        }
        String fallback = out.toString().trim();
        return fallback.isEmpty() ? "download" : fallback;
    }

    /** RFC 5987 百分号编码（中文名不乱码）。 */
    static String rfc5987(String name) {
        StringBuilder out = new StringBuilder(name.length() * 3);
        for (byte b : name.getBytes(StandardCharsets.UTF_8)) {
            int c = b & 0xFF;
            boolean attrChar = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
                    || "!#$&+-.^_`|~".indexOf(c) >= 0;
            if (attrChar) {
                out.append((char) c);
            } else {
                out.append('%').append(Character.toUpperCase(Character.forDigit(c >> 4, 16)))
                        .append(Character.toUpperCase(Character.forDigit(c & 0xF, 16)));
            }
        }
        return out.toString();
    }

    /** 原始文件名只保留展示用的最后一段：去掉任何路径分隔符与控制字符。 */
    static String displayName(String originalFilename) {
        String name = originalFilename == null ? "" : originalFilename;
        int cut = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
        if (cut >= 0) {
            name = name.substring(cut + 1);
        }
        name = name.replaceAll("[\\p{Cntrl}]", "").trim();
        if (name.isEmpty()) {
            return "file";
        }
        return name.length() > 120 ? name.substring(0, 120) : name;
    }

    private static void deleteQuietly(Path path) {
        try {
            Files.deleteIfExists(path);
        } catch (IOException e) {
            log.warn("删除附件文件失败: {}", path, e);
        }
    }

    private record CopyResult(long bytes, byte[] sha256) {
    }
}
