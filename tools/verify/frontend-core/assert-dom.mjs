// 验收用：对静态服务器上的 index.html 做骨架断言 + 全模块 import 链 200 校验
// 需要先起 mock-server.mjs（见 README.md）；运行时 DOM 由 Edge --dump-dom 产出后经 RUNTIME_DOM 传入
import os from "node:os";
import path from "node:path";

const BASE = process.env.BASE || "http://127.0.0.1:8099";
const DEFAULT_DOM = path.join(os.tmpdir(), "kb-verify", "dom.html");
/* --- next edit fragment --- */
const RUNTIME_DOM = process.env.RUNTIME_DOM || DEFAULT_DOM;