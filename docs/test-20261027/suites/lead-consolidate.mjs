
import fs from "node:fs";
import path from "node:path";
const OUT = "D:\\work\\知识库\\docs\\test-20261027";
const EV = path.join(OUT, "evidence");
const caseMap = new Map();
let rowCount = 0;
function add(c) {
  rowCount++;
  caseMap.set(c.stream + "|" + c.orig, c);
}
function modOf(id) { const m = /^TC-([A-Z]+)-\d+/.exec(id || ""); return m ? m[1] : "?"; }
function norm(r) {
  const s = String(r || "").replace(/\*/g, "").trim();
  if (/^(PASS|pass|通过|达标|OK|ok)/.test(s)) return "通过";
  if (/^(FAIL|fail|失败|不达标|NG)/.test(s)) return "失败";
  if (/阻塞|BLOCK/.test(s)) return "阻塞";
  return s || "未判定";
}

// ---------- E1: jsonl ----------
const e1dir = path.join(EV, "e1");
if (fs.existsSync(e1dir)) {
  for (const f of fs.readdirSync(e1dir).filter(x => x.endsWith(".jsonl")).sort()) {
    for (const line of fs.readFileSync(path.join(e1dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        add({ stream: "E1", orig: o.id, module: o.module || modOf(o.id), method: "判定表/等价类", title: o.title || "", result: norm(o.status), basis: String(o.actual || "").slice(0, 160) });
      } catch {}
    }
  }
}

// ---------- E2: markdown tables ----------
const e2dir = path.join(EV, "e2");
function parseMdTables(file, stream, methodDefault) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  let hdr = null;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t.startsWith("|")) { hdr = null; continue; }
    const isSep = /^\|[\s:\-|]+\|$/.test(t);
    if (!isSep && i + 1 < lines.length && /^\|[\s:\-|]+\|$/.test(lines[i + 1].trim())) {
      hdr = t.replace(/^\|/, "").replace(/\|$/, "").split("|").map(s => s.trim());
      continue;
    }
    if (isSep || !hdr) continue;
    const cells = t.replace(/^\|/, "").replace(/\|$/, "").split("|").map(s => s.trim());
    const iId = hdr.findIndex(h => /用例|编号/.test(h));
    const iName = hdr.findIndex(h => /名称|标题|用例名/.test(h));
    const iRes = hdr.findIndex(h => /结论|判定|结果|状态/.test(h));
    const iAct = hdr.findIndex(h => /实际|依据|实测|说明/.test(h));
    if (iId < 0 || iRes < 0) continue;
    const id = (cells[iId] || "").replace(/\*/g, "").trim();
    if (!/^TC-[A-Z]+-\d+$/.test(id)) continue;
    const judged = norm(cells[iRes]);
    if (judged !== "通过" && judged !== "失败" && judged !== "阻塞") continue;
    add({ stream, orig: id, module: modOf(id), method: methodDefault, title: (cells[iName] || "").slice(0, 120), result: judged, basis: ((cells[iAct] || "") + " " + (cells[iRes + 1] || "")).slice(0, 160) });
  }
}
if (fs.existsSync(e2dir)) {
  for (const f of fs.readdirSync(e2dir).filter(x => /cases.*\.md$/.test(x) && !x.startsWith("superseded")).sort()) parseMdTables(path.join(e2dir, f), "E2", "错误推测/攻击面");
}

// ---------- E3: perf report case table ----------
const e3rep = path.join(EV, "e3", "perf-report.md");
if (fs.existsSync(e3rep)) parseMdTables(e3rep, "E3", "正交/负载模型");

// ---------- E4: json ----------
const e4dir = path.join(EV, "e4");
if (fs.existsSync(e4dir)) {
  for (const f of fs.readdirSync(e4dir).filter(x => /results.*\.json$/.test(x)).sort()) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(e4dir, f), "utf8"));
      for (const r of (j.results || [])) add({ stream: "E4", orig: r.id, module: modOf(r.id), method: "场景法", title: r.name || "", result: r.ok ? "通过" : "失败", basis: String(r.note || "").slice(0, 160) });
    } catch {}
  }
}

const cases = Array.from(caseMap.values());
const byStream = {}, byMod = {}, byRes = {};
for (const c of cases) {
  byStream[c.stream] = byStream[c.stream] || { total: 0, pass: 0, fail: 0, block: 0 };
  byStream[c.stream].total++; if (c.result === "通过") byStream[c.stream].pass++; else if (c.result === "失败") byStream[c.stream].fail++; else byStream[c.stream].block++;
  byMod[c.module] = byMod[c.module] || { total: 0, pass: 0, fail: 0 };
  byMod[c.module].total++; if (c.result === "通过") byMod[c.module].pass++; else if (c.result === "失败") byMod[c.module].fail++;
  byRes[c.result] = (byRes[c.result] || 0) + 1;
}
console.log("TOTAL rows: " + rowCount + " | unique ids: " + cases.length);
console.log("byStream: " + JSON.stringify(byStream));
console.log("byModule: " + JSON.stringify(byMod));
console.log("byResult: " + JSON.stringify(byRes));

fs.writeFileSync(path.join(OUT, "evidence", "lead", "cases-normalized.json"), JSON.stringify(cases, null, 1), "utf8");
const esc = s => '"' + String(s).replace(/"/g, '""') + '"';
const csv = ["全局编号,流,原始编号,模块,设计方法,用例标题,结论,依据"];
for (const c of cases) csv.push([c.stream + "-" + c.orig, c.stream, c.orig, c.module, c.method, c.title, c.result, c.basis].map(esc).join(","));
fs.writeFileSync(path.join(OUT, "03-测试用例库.csv"), "\uFEFF" + csv.join("\r\n"), "utf8");
console.log("csv rows: " + (csv.length - 1));
