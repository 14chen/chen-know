/**
 * run-mock-suite.mjs —— 一条命令跑完两套 mock 验收
 *   A) assert-dom.mjs    → 92 项：index.html 骨架 / CSS 选择器 / 全模块 import 链 / 运行时 DOM
 *   B) harness-views.js  → 71 项：6 个笔记类视图 + 顶栏搜索 + XSS + 卸载不重复请求
 *
 * 用法：node run-mock-suite.mjs            （在任意目录下执行都可以）
 * 环境：EDGE=<浏览器 exe 路径>  可覆盖自动探测；PORT=<端口> 默认 8099
 * 前置：node ≥ 20；Edge 或 Chrome；本机 8099 端口空闲
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { SCRIPT_DIR, ensureArtifactDir, findBrowser } from "./repo.mjs";

const PORT = Number(process.env.PORT || 8099);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = ensureArtifactDir();
const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const browser = findBrowser();
if (!browser) {
  console.error("未找到 Edge/Chrome，请设置环境变量：EDGE=\"C:\\path\\to\\msedge.exe\"");
  process.exit(2);
}
console.log(`浏览器：${browser}`);
console.log(`产物目录：${dir}`);

const mock = spawn(process.execPath, [path.join(SCRIPT_DIR, "mock-server.mjs"), "--port", String(PORT)], { stdio: ["ignore", "pipe", "pipe"] });
mock.stdout.on("data", (d) => process.stdout.write("[mock] " + d));
mock.stderr.on("data", (d) => process.stderr.write("[mock] " + d));

const dumpDom = (url, profileName, budget) => {
  const profile = path.join(dir, profileName);
  fs.rmSync(profile, { recursive: true, force: true });
  return spawnSync(browser, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${profile}`, `--virtual-time-budget=${budget}`, "--dump-dom", url,
  ], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
};

let failures = 0;
try {
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    try { up = (await fetch(BASE + "/index.html")).ok; } catch { /* 未就绪 */ }
    if (!up) await sleep(250);
  }
  if (!up) throw new Error("mock 未就绪（端口被占用？）");

  /* ---------- A) 92 项：先产出运行时 DOM（夹具未被改动），再跑断言 ---------- */
  const domPath = path.join(dir, "dom.html");
  const dump = dumpDom(`${BASE}/#/notes?note=1`, "profile-a", 20000);
  if (!dump.stdout) throw new Error("Edge --dump-dom 失败：" + String(dump.stderr || "").slice(0, 300));
  fs.writeFileSync(domPath, dump.stdout, "utf8");
  console.log(`\n########## A) DOM/资源断言（期望 92/92）  运行时 DOM = ${domPath} ##########`);
  const a = spawnSync(process.execPath, [path.join(SCRIPT_DIR, "assert-dom.mjs")], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, BASE, RUNTIME_DOM: domPath },
  });
  process.stdout.write(a.stdout || "");
  failures += (String(a.stdout || "").match(/^FAIL/gm) || []).length;

  /* ---------- B) 72 项：浏览器内验收台 ---------- */
  console.log("\n########## B) 视图验收台（期望 72/72）  ##########");
  const run = dumpDom(`${BASE}/__harness.html`, "profile-b", 80000);
  const m = /<pre id="selftest">([\s\S]*?)<\/pre>/.exec(run.stdout || "");
  if (!m) {
    console.log("未取到验收台结果块（页面未跑完或脚本报错）");
    failures += 1;
  } else {
    const text = decode(m[1]);
    console.log(text.trim());
    failures += (text.match(/^FAIL/gm) || []).length;
  }

  /* ---------- C) 注册自动登录失败分支（契约 §1 的降级行为） ---------- */
  console.log("\n########## C) 注册自动登录失败分支（期望 7/7）  ##########");
  const loginRun = dumpDom(`${BASE}/__harness-login.html`, "profile-c", 40000);
  const m2 = /<pre id="selftest">([\s\S]*?)<\/pre>/.exec(loginRun.stdout || "");
  if (!m2) {
    console.log("未取到结果块（页面未跑完或脚本报错）");
    failures += 1;
  } else {
    const text2 = decode(m2[1]);
    console.log(text2.trim());
    failures += (text2.match(/^FAIL/gm) || []).length;
  }
} catch (e) {
  console.error("验收套件异常：" + e.message);
  failures += 1;
} finally {
  try { mock.kill(); } catch { /* 已退出 */ }
}

console.log(`\n=== 合计失败 ${failures} 项 ===`);
process.exit(failures ? 1 : 0);
