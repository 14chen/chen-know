package com.kb.config;

import com.kb.common.ErrorCode;
import com.kb.common.ErrorResponses;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * 非 multipart 请求体大小上限（API.md §4.4：≤ 8 MB，超出 413 PAYLOAD_TOO_LARGE）。
 *
 * <p>为什么需要它：Tomcat 的 {@code maxPostSize} 只管 form 表单，JSON 请求体是无界的；
 * 公网暴露时任何人 POST 一个超大 body 就能把内存打满。
 *
 * <p>规则：
 * <ol>
 *   <li>{@code multipart/form-data} 一律放行 —— 那条路径由
 *       {@code spring.servlet.multipart.max-file-size=20MB} 管；</li>
 *   <li>声明了 {@code Content-Length} 且超过上限 → 立刻 413，body 一个字节都不读；</li>
 *   <li>没有 {@code Content-Length}（chunked 等）→ 用计数流兜住，读到超过上限就中断，
 *       不能因为「没声明长度」而放行。</li>
 * </ol>
 *
 * <p>注意：本过滤器注册在 Spring Security 过滤器链最前面（认证之前），因此未登录的巨型请求
 * 也会在鉴权之前被挡掉。它<b>不是</b> Spring Bean，避免被 Boot 另外注册成普通 Servlet 过滤器而重复执行。
 */
public class RequestBodySizeLimitFilter extends OncePerRequestFilter {

    /** API.md §4.4 */
    public static final long DEFAULT_MAX_BODY_BYTES = 8L * 1024 * 1024;

    private static final String MULTIPART_PREFIX = "multipart/";

    private final ErrorResponses errorResponses;
    private final long maxBodyBytes;
    private final String limitMessage;

    public RequestBodySizeLimitFilter(ErrorResponses errorResponses) {
        this(errorResponses, DEFAULT_MAX_BODY_BYTES);
    }

    public RequestBodySizeLimitFilter(ErrorResponses errorResponses, long maxBodyBytes) {
        this.errorResponses = errorResponses;
        this.maxBodyBytes = maxBodyBytes;
        this.limitMessage = "请求体超过上限（" + (maxBodyBytes / (1024 * 1024)) + " MB）";
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        if (isMultipart(request)) {
            filterChain.doFilter(request, response);
            return;
        }

        long declaredLength = request.getContentLengthLong();
        if (declaredLength > maxBodyBytes) {
            reject(response);
            return;
        }
        if (declaredLength >= 0) {
            // 长度已声明且不超限：Tomcat 只会按声明的长度读取，无需再计数
            filterChain.doFilter(request, response);
            return;
        }

        CountingRequest countingRequest = new CountingRequest(request, maxBodyBytes, limitMessage);
        try {
            filterChain.doFilter(countingRequest, response);
        } catch (Exception ex) {
            // 计数流是在读取过程中「中断」请求的，异常可能会被上层（Jackson / Spring MVC）包装；
            // 只要标记为超限，就统一按 413 回答，不把内部的包装异常暴露成 500。
            if (countingRequest.isLimitExceeded() && !response.isCommitted()) {
                reject(response);
                return;
            }
            throw ex;
        }
        // 上游万一吞掉了异常：只要响应还没提交，也要给出正确的 413
        if (countingRequest.isLimitExceeded() && !response.isCommitted()) {
            reject(response);
        }
    }

    private void reject(HttpServletResponse response) throws IOException {
        errorResponses.write(response, ErrorCode.PAYLOAD_TOO_LARGE, limitMessage);
    }

    private static boolean isMultipart(HttpServletRequest request) {
        String contentType = request.getContentType();
        return contentType != null && contentType.toLowerCase(Locale.ROOT).startsWith(MULTIPART_PREFIX);
    }

    /**
     * 包一层计数。计数器放在 request 包装上而不是流上：多次 {@code getInputStream()} 共享同一个计数，
     * 不给「重复取流」留绕过的口子。
     */
    static final class CountingRequest extends HttpServletRequestWrapper {

        private final long maxBodyBytes;
        private final String limitMessage;
        private long consumedBytes;
        private boolean limitExceeded;

        CountingRequest(HttpServletRequest request, long maxBodyBytes, String limitMessage) {
            super(request);
            this.maxBodyBytes = maxBodyBytes;
            this.limitMessage = limitMessage;
        }

        boolean isLimitExceeded() {
            return limitExceeded;
        }

        @Override
        public ServletInputStream getInputStream() throws IOException {
            return new CountingServletInputStream(super.getInputStream());
        }

        @Override
        public BufferedReader getReader() throws IOException {
            String encoding = getCharacterEncoding();
            Charset charset = encoding == null ? StandardCharsets.UTF_8 : Charset.forName(encoding);
            return new BufferedReader(new InputStreamReader(getInputStream(), charset));
        }

        private final class CountingServletInputStream extends ServletInputStream {

            private final ServletInputStream delegate;

            CountingServletInputStream(ServletInputStream delegate) {
                this.delegate = delegate;
            }

            @Override
            public int read() throws IOException {
                int value = delegate.read();
                if (value != -1) {
                    count(1);
                }
                return value;
            }

            @Override
            public int read(byte[] buffer, int offset, int length) throws IOException {
                int read = delegate.read(buffer, offset, length);
                if (read > 0) {
                    count(read);
                }
                return read;
            }

            private void count(int added) {
                consumedBytes += added;
                if (consumedBytes > maxBodyBytes) {
                    limitExceeded = true;
                    throw new RequestBodyTooLargeException(limitMessage);
                }
            }

            @Override
            public boolean isFinished() {
                return delegate.isFinished();
            }

            @Override
            public boolean isReady() {
                return delegate.isReady();
            }

            @Override
            public void setReadListener(ReadListener readListener) {
                delegate.setReadListener(readListener);
            }
        }
    }
}
