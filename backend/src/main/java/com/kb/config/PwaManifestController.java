package com.kb.config;

import java.time.Duration;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * 让 Web App Manifest 以正确的 MIME 类型返回。
 *
 * <p>Spring 的 {@code MediaTypeFactory} 不认识 {@code .webmanifest}，默认静态资源处理器会用
 * {@code application/octet-stream} 返回它。Chrome 对 manifest 的 MIME 有要求，遇到这种类型会拒绝
 * （控制台报 unsupported MIME type），PWA 的「添加到主屏幕」随之失效。
 *
 * <p>这里用一个精确路径的控制器接管该资源（显式映射优先于默认的 {@code /**} 资源处理器），
 * 显式声明 W3C 规定的 {@code application/manifest+json}。其余静态资源行为不变。
 * 安全配置是 {@code anyRequest().permitAll()}，所以该路径对外可访问。
 */
@Controller
public class PwaManifestController {

    private static final MediaType MANIFEST = MediaType.parseMediaType("application/manifest+json");

    @GetMapping(value = "/manifest.webmanifest", produces = "application/manifest+json")
    public ResponseEntity<Resource> manifest() {
        Resource resource = new ClassPathResource("static/manifest.webmanifest");
        if (!resource.exists()) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok()
                .contentType(MANIFEST)
                .cacheControl(CacheControl.maxAge(Duration.ofHours(1)))
                .body(resource);
    }
}
