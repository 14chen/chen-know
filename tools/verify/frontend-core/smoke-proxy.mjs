// 联调冒烟用：反向代理真后端（默认 8083），并注入验收台
// 目的：在**真实后端 API** 上运行真实前端代码，且不修改后端任何文件
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STATIC_ROOT } from "./repo.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] || STATIC_ROOT);
const port = Number(process.argv[3] || 8098);
const upstream = process.argv[4] || "http://127.0.0.1:8083";
const testFile = process.argv[5] || path.join(scriptDir, "smoke-flow.js");