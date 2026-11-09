/**
 * repo.mjs —— 路径推导：一切路径从脚本自身位置推导，不写死机器路径
 * 向上查找含 docs/SCHEMA.md 的目录作为仓库根。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

export function findRepoRoot(startDir = SCRIPT_DIR) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, "docs", "SCHEMA.md"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("未找到仓库根：向上未发现 docs/SCHEMA.md");
    dir = parent;
  }
}

export const REPO_ROOT = findRepoRoot();
export const STATIC_ROOT = path.join(REPO_ROOT, "backend", "src", "main", "resources", "static");
export const ARTIFACT_DIR = path.join(os.tmpdir(), "kb-verify");

export function ensureArtifactDir() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  return ARTIFACT_DIR;
}

const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

/** 浏览器可执行文件：优先 EDGE/CHROME 环境变量，其次标准安装路径 */
export function findBrowser() {
  const fromEnv = process.env.EDGE || process.env.CHROME;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  for (const p of EDGE_CANDIDATES) if (fs.existsSync(p)) return p;
  return null;
}
