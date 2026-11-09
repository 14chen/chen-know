// CDP 驱动真后端联调冒烟（真实时间）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const CDP = process.env.CDP || "http://127.0.0.1:9225";
const TARGET = process.env.TARGET || "http://127.0.0.1:8083/";
const FLOW = process.env.FLOW || path.join(scriptDir, "smoke-flow.js");