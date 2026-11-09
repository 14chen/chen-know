# 流 D 进展

（追加式记录：改了什么、怎么验的）

> 2026-10-28 · D 流（安全响应头与 Cookie）完成记录

## 0 改了哪些文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `com/kb/config/SecurityConfig.java` | 改 | 加 `.headers(...)`（CSP + Referrer-Policy）；注册 `OriginGuardFilter`，并明确它与 body-size 过滤器的先后 |
| `com/kb/config/CspDirectives.java` | 新增 | 生成 CSP 策略串；**启动时从 classpath static/index.html 现算内联脚本 sha256** |
| `com/kb/config/OriginGuardFilter.java` | 新增 | 非 GET/HEAD/OPTIONS/TRACE 的同源校验（DEF-E2-004） |
| `backend/src/main/resources/application.properties` | 改 | 加 `server.forward-headers-strategy=native`（让 request.isSecure() 认 X-Forwarded-Proto，Tomcat 据此给会话 Cookie 加 Secure） |

未改他人包 / pom.xml / 前端 / jar；未碰 data\kb.db 与 8080。

## 1 DEF-E2-002（S3）缺 CSP 与 Referrer-Policy —— 已修

修前（E2 TC-NF-201）：`GET /` 只有 nosniff + X-Frame-Options: DENY，无 CSP、无 Referrer-Policy。

改法：`SecurityConfig` 的 `http.headers(...)` 挂 `contentSecurityPolicy(...)` 与 `referrerPolicy(STRICT_ORIGIN_WHEN_CROSS_ORIGIN)`；策略由 `CspDirectives` 生成：

    default-src 'self'; script-src 'self' 'sha256-<现算>'; style-src 'self' 'unsafe-inline';
    img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self';
    manifest-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none';
    base-uri 'self'; form-action 'self'

**为什么 script-src 带哈希，而不是只写 'self'**：`static/index.html` 里有一段**内联**主题引导脚本（在任何样式生效前设 data-theme，避免刷新白/黑闪）。只写 'self' 会拦掉它 —— 页面不白屏，但主题引导失效并产生 securitypolicyviolation。既不放开 'unsafe-inline'（等于放弃 XSS 兜底），也不写死哈希（前端一改就过期），所以启动时读 classpath `static/index.html`，把没有 src 的 `<script>` 逐段算 sha256 拼进策略；读不到就退化为 `script-src 'self'`。当前实测 1 段：H3+luiNZMrZEA0QtLzIs8oHR6f0xVV6Jvl2JGxN6TRk=

修后证据：8 类端点（SPA/静态 HTML/manifest/图标/健康检查/打包 JS/401 API/未知路径）全部带 CSP + Referrer-Policy（d-headers-matrix.json，ALL-HEADERS-ON-EVERY-RESPONSE=true）；浏览器 14/14，securitypolicyviolation = 0。

## 2 DEF-E2-003（S3）Cookie 无 Secure —— 已修

修前：properties 固定 `server.servlet.session.cookie.secure=false`，全仓无 setSecure 调用 → 反代声明 https 时 KB_SESSION 仍不带 Secure。

改法（不改业务代码，用容器能力）：加 `server.forward-headers-strategy=native`。该开关让 Boot 给内置 Tomcat 配 RemoteIpValve，于是带 `X-Forwarded-Proto: https` 的请求 `request.isSecure()` 为 true；Tomcat 生成会话 Cookie 时按 `createSessionCookie(ctx, id, isSecure())` 决定 Secure —— **同一个 KB_SESSION，安全请求带 Secure、纯 http 不带**。base 值保持 false，本地 http 调试不受影响。

修后证据（d-verify.log）：
- 纯 http：`KB_SESSION=…; Path=/; HttpOnly; SameSite=Lax`（无 Secure）
- X-Forwarded-Proto: https：`KB_SESSION=…; Path=/; Secure; HttpOnly; SameSite=Lax`（有 Secure）

## 3 DEF-E2-004（S4）跨源写请求无校验 —— 已修

改法：新增 `OriginGuardFilter`，只对非 GET/HEAD/OPTIONS/TRACE 生效：
1. 有 Origin → 必须与 Host 同源（只比主机名；有显式端口才比端口；**不比协议**，否则反代后误杀），否则 403 `{"error":{"code":"FORBIDDEN","message":"跨源请求被拒绝"}}`
2. 无 Origin → `Sec-Fetch-Site: cross-site` 则 403
3. 两者都没有 → 放行（curl / Node fetch / 既有自动化脚本都不发 Origin）

修后证据（d-verify.log）：跨源 POST/PATCH/DELETE/登录 全 403；同源 Origin 201；无 Origin 201；cross-site 403；same-site 201；GET/OPTIONS 不受影响。
**既有脚本未被误杀**：把 docs/test-20261027/suites/e2-security.mjs 原件复制到 evidence/d/e2-regression-copy.mjs（只改端口与 setup 复用 admin），跑出 **110 例 / 108 通过 / 0 失败 / 2 阻塞**（2 条阻塞是该脚本自身 multipart 字段名问题，与本改动无关）；CSRF 分类从修前 2 通过 1 失败 → **3 通过 0 失败**（原 TC-AUTH-010 跨源 POST 由 201 变 403）。

## 4 验证汇总

| 验证 | 命令 | 结果 |
|---|---|---|
| 编译 | `powershell -File F:\work\test\kb\kb-build.ps1` | **mvn exit=0** |
| 头/Cookie/Origin 24 项 | `node suites/d-verify.mjs` | **24/24** |
| 头矩阵 8 类端点 | `node suites/d-headers.mjs` | **8/8**，exit=0 |
| 浏览器 CSP 不破页面 14 项 | `node suites/d-browser.mjs` | **14/14**（含 0 violation） |
| 既有 E2 安全脚本回归 110 例 | `node evidence/d/e2-regression-copy.mjs` | **108 通过 / 0 失败 / 2 阻塞** |

## 5 说明 / 未做

- 没有引入 CSRF token（契约 §0.2 明确不引入），只把服务端 Origin 校验补成第二道防线。
- 没改 `static/index.html`（属 F 流）。若 F 之后改了那段内联主题脚本，**不需要同步改我这边** —— 哈希是启动时现算的。
- 若将来打包导致 classpath 里没有 `static/index.html`，CSP 退化为 `script-src 'self'`：页面仍可用，只是内联主题引导被拦（控制台 1 条 violation）。
