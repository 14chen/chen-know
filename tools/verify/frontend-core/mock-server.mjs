/**
 * mock-server.mjs —— 静态服务器 + 契约 mock API + 验收台注入
 *
 * ⚠️ mock 不是交付物：它只是前端核心视图的验收夹具，用来在没有后端的情况下
 *    按 docs/API.md 的固化结构回放响应（含 XSS 载荷），并给 Edge 注入探针与测试脚本。
 *
 * 用法：node mock-server.mjs [--port 8099] [--log <file>]
 *   GET  /                 → 真实 static/index.html（注入探针 + /__test.mjs）
 *   GET  /__harness.html   → 同上（验收台入口）
 *   GET  /__test.mjs       → harness-views.js
 *   /api/**                → mock 数据（结构与 docs/API.md §4.1/4.2/4.3 一致）
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { STATIC_ROOT, SCRIPT_DIR, ARTIFACT_DIR, ensureArtifactDir } from "./repo.mjs";

const argOf = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

const root = path.resolve(argOf("--root", STATIC_ROOT));
const port = Number(argOf("--port", process.env.PORT || 8099));
const logFile = path.resolve(argOf("--log", path.join(ensureArtifactDir() || ARTIFACT_DIR, "requests.jsonl")));
const testFile = path.resolve(argOf("--test", path.join(SCRIPT_DIR, "harness-views.js")));
const loginTestFile = path.resolve(argOf("--test-login", path.join(SCRIPT_DIR, "harness-login.js")));

// 「注册成功但自动登录失败」用例：由 /__harness-login.html 打开（在页面脚本执行前就置位）
let loginFailMode = false;

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
};
const json = (res, code, data) => { res.writeHead(code, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(data)); };
const log = (e) => { try { fs.appendFileSync(logFile, JSON.stringify(e) + "\n"); } catch { /* 忽略 */ } };

const NOW = "2026-10-16T02:33:14Z";

/* ------------------------------ 夹具（XSS 载荷系故意注入，用于验收净化） ------------------------------ */
const XSS = {
  title: '今天<em>天气</em>很好 <img src=x onerror="window.__xssTitle=1">',
  highlight: '……适合出去散步<em>天气</em>……<script>window.__xssSnippet=1</script><img src=x onerror="window.__xssImg=1">',
};

let tags = [
  { id: 2, name: 'Java', color: '#2563eb', count: 5 },
  { id: 3, name: '<img src=x onerror="window.__xssTag=1">', color: '#dc2626', count: 1 },
  { id: 4, name: '生活', color: '#16a34a', count: 0 },
];

const note1 = {
  id: 1, folderId: 1, title: 'Spring Boot 笔记', version: 7, isFavorite: true, isPinned: false,
  createdAt: NOW, updatedAt: NOW, backlinkCount: 1, tags: [tags[0]],
  content: [
    '# 自动配置原理', '', '正文引用 [[索引表]] 与 [[还没写的笔记]]。', '',
    '```java', '// 示例', 'public class Demo {',
    '  private final String name = "kb";',
    '  static int add(int a, int b) { return a + b; }', '}', '```', '',
    '| 项 | 值 |', '|---|---|', '| 端口 | 8080 |', '',
    '- [x] 已完成', '- [ ] 待办', '', '> 引用块', '',
    '<script>window.__xss = 1;</script><img src=x onerror="window.__xss=2">',
  ].join('\n'),
};
const V7_CONTENT = note1.content;
const V6_CONTENT = '# 自动配置原理\n\n旧版本的正文，没有双向链接。\n';
const versions = [
  { version: 7, createdAt: NOW, size: V7_CONTENT.length },
  { version: 6, createdAt: '2026-10-15T10:00:00Z', size: V6_CONTENT.length },
];
const note2 = { id: 2, folderId: 1, title: '索引表', version: 2, content: '见 [[Spring Boot 笔记]]', createdAt: NOW, updatedAt: NOW, isFavorite: false, isPinned: true };
const listItem = (n) => ({
  id: n.id, folderId: n.folderId, title: n.title, version: n.version,
  excerpt: String(n.content || '').replace(/[#>*`\n]/g, ' ').slice(0, 70),
  isFavorite: n.isFavorite, isPinned: n.isPinned, tags: n.tags || [], createdAt: n.createdAt, updatedAt: n.updatedAt,
});

/* ------------------------------ 注入探针 ------------------------------ */
const HOOK = `<script>
window.__reqs=[];window.__errors=[];
(function(){
  var of=window.fetch;
  window.fetch=function(input,init){
    try{ var url=typeof input==='string'?input:(input&&input.url); window.__reqs.push({url:String(url),method:(init&&init.method)||'GET',body:(init&&typeof init.body==='string')?init.body:null}); }catch(e){}
    return of.apply(this,arguments);
  };
  var oe=console.error;
  console.error=function(){ window.__errors.push(Array.prototype.slice.call(arguments).map(function(a){return a&&a.message?a.message:String(a);}).join(' ')); oe.apply(console,arguments); };
  window.addEventListener('error',function(e){ window.__errors.push('onerror: '+(e.message||'')); });
  window.addEventListener('unhandledrejection',function(e){ window.__errors.push('unhandledrejection: '+String((e.reason&&e.reason.message)||e.reason)); });
})();
</script>`;

/* ------------------------------ 路由 ------------------------------ */
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://127.0.0.1");
  const p = decodeURIComponent(u.pathname);

  if (p === "/__test.mjs" || p === "/__test-login.mjs") {
    const file = p === "/__test-login.mjs" ? loginTestFile : testFile;
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(500).end("harness 缺失: " + file); return; }
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(data);
    });
    return;
  }

  if (p === "/__harness-login.html") loginFailMode = true;   // 进入「自动登录失败」夹具模式

  if (p === "/__harness.html" || p === "/__harness-login.html" || (p === "/" && u.searchParams.get("harness") === "1")) {
    fs.readFile(path.join(root, "index.html"), "utf8", (err, html) => {
      if (err) { res.writeHead(500).end("index.html 缺失: " + root); return; }
      const script = p === "/__harness-login.html" ? "/__test-login.mjs" : "/__test.mjs";
      const out = html
        .replace("</head>", HOOK + "</head>")
        .replace("</body>", `<pre id="selftest">RUNNING</pre>\n<script type="module" src="${script}"></script>\n</body>`);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(out);
    });
    return;
  }

  if (p.startsWith("/api/")) {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      log({ method: req.method, url: req.url, body: body || null });
      const q = u.searchParams.get("q");
      const tag = u.searchParams.get("tag");

      if (p === "/api/auth/me") {
        if (loginFailMode) return json(res, 401, { error: { code: "UNAUTHORIZED", message: "未登录或会话已过期" } });
        return json(res, 200, { id: 1, username: "alice", displayName: "爱丽丝", role: "admin" });
      }
      if (p === "/api/auth/login" && req.method === "POST") {
        // 夹具：注册成功后的自动登录失败（验证契约 §1 的降级提示）
        if (loginFailMode) return json(res, 401, { error: { code: "UNAUTHORIZED", message: "用户名或密码错误" } });
        return json(res, 200, { id: 1, username: "alice", displayName: "爱丽丝", role: "admin" });
      }
      if (p === "/api/auth/register" && req.method === "POST") {
        const reg = JSON.parse(body || "{}");
        return json(res, 201, { id: 7, username: reg.username || "newbie", displayName: reg.displayName || "新用户", role: "member" });
      }
      if (p === "/api/folders") return json(res, 200, [
        { id: 1, parentId: null, name: "技术", sortOrder: 0, noteCount: 2, children: [{ id: 5, parentId: 1, name: "Spring", sortOrder: 0, noteCount: 1, children: [] }] },
        { id: 3, parentId: null, name: "生活", sortOrder: 1, noteCount: 0, children: [] },
      ]);
      if (p === "/api/notes" && req.method === "GET") {
        return json(res, 200, { items: [listItem(note1), listItem(note2)], page: 1, size: 50, total: 2 });
      }
      if (p === "/api/search") {
        if (q === "zzzz") return json(res, 200, { items: [], page: 1, size: 20, total: 0 });   // 空结果用例
        return json(res, 200, {
          items: [
            { noteId: 1, title: XSS.title, highlight: XSS.highlight, score: -1.23, folderId: 1, updatedAt: NOW },
            { noteId: 2, title: `索引表${tag ? ' · 标签:' + tag : ''}`, highlight: '……见 <em>Spring Boot 笔记</em>……', score: -2.5, folderId: 1, updatedAt: NOW },
          ], page: 1, size: 20, total: 2,
        });
      }
      if (p === "/api/tags" && req.method === "GET") return json(res, 200, tags);           // §4.3 裸数组
      if (p === "/api/tags" && req.method === "POST") {
        const t = JSON.parse(body || "{}");
        const created = { id: 9, name: t.name, color: t.color || '#6b7280', count: 0 };
        tags = tags.concat([created]);
        return json(res, 201, created);
      }
      if (/^\/api\/tags\/\d+$/.test(p)) {
        const id = Number(p.split("/").pop());
        if (req.method === "PATCH") {
          const t = JSON.parse(body || "{}");
          tags = tags.map((x) => (x.id === id ? { ...x, ...t } : x));
          return json(res, 200, tags.find((x) => x.id === id));
        }
        if (req.method === "DELETE") { tags = tags.filter((x) => x.id !== id); res.writeHead(204).end(); return; }
      }
      if (p === "/api/favorites") {                                                          // §4.3 分页信封
        return json(res, 200, {
          items: [listItem(note1), { ...listItem(note2), title: '<img src=x onerror="window.__xssFav=1">' }],
          page: 1, size: 50, total: 2,
        });
      }
      if (p === "/api/recent") {                                                             // §4.2 {items, viewedAt}
        const limit = Number(u.searchParams.get("limit") || 20);
        const items = [
          { noteId: 1, title: 'Spring Boot 笔记', version: 7, folderId: 1, viewedAt: NOW, excerpt: '自动配置原理' },
          { noteId: 2, title: '索引表', version: 2, folderId: 1, viewedAt: '2026-10-15T10:00:00Z', excerpt: '见 [[Spring Boot 笔记]]' },
        ];
        return json(res, 200, { items: items.slice(0, limit) });
      }
      if (p === "/api/notes/1" && req.method === "GET") return json(res, 200, note1);
      if (p === "/api/notes/1" && req.method === "PATCH") {
        Object.assign(note1, JSON.parse(body || "{}"));
        return json(res, 200, note1);
      }
      if (p === "/api/notes/1/view") { res.writeHead(204).end(); return; }
      if (p === "/api/notes" && req.method === "POST") {
        const b = JSON.parse(body || "{}");
        log({ note: "created-from-dangling", title: b.title });
        return json(res, 201, { id: 99, title: b.title, folderId: b.folderId ?? null, version: 1, content: b.content || '', createdAt: NOW, updatedAt: NOW });
      }
      if (p === "/api/notes/1/backlinks") {
        return json(res, 200, { items: [{ noteId: 2, title: '索引表', excerpt: '……见 [[Spring Boot 笔记]]……' }, { noteId: 3, title: '读书笔记', excerpt: '参考 [[Spring Boot 笔记]] 的自动配置' }] });
      }
      if (p === "/api/notes/1/links") {                                                      // §4.1 resolved[].{noteId,title,folderId}
        return json(res, 200, { resolved: [{ noteId: 2, title: '索引表', folderId: 1 }], dangling: ['还没写的笔记'] });
      }
      if (p === "/api/notes/1/versions" && req.method === "GET") return json(res, 200, versions);   // 裸数组
      if (p === "/api/notes/1/versions/7") return json(res, 200, { version: 7, title: note1.title, content: V7_CONTENT, createdAt: NOW });
      if (p === "/api/notes/1/versions/6") return json(res, 200, { version: 6, title: 'Spring Boot 笔记（旧）', content: V6_CONTENT, createdAt: '2026-10-15T10:00:00Z' });
      if (p === "/api/notes/1/versions/6/restore" && req.method === "POST") return json(res, 200, { version: 8 });
      if (p === "/api/stats") return json(res, 200, { noteCount: 2, folderCount: 3, tagCount: tags.length, attachmentCount: 0, totalAttachmentBytes: 0, trashCount: 0, updatedToday: 1, dailyCreated: [] });

      return json(res, 404, { error: { code: "NOT_FOUND", message: "mock 未实现: " + p } });
    });
    return;
  }

  const file = path.join(root, p === "/" ? "index.html" : p);
  if (!file.startsWith(root)) { res.writeHead(403).end("forbidden"); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { "content-type": "text/plain" }).end("404"); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(port, () => {
  console.log(`mock 静态服务已启动 http://127.0.0.1:${port}`);
  console.log(`  static root : ${root}`);
  console.log(`  harness     : http://127.0.0.1:${port}/__harness.html`);
  console.log(`  test script : ${testFile}`);
  console.log(`  请求日志    : ${logFile}`);
});
