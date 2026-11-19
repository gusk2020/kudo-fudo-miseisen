#!/usr/bin/env node
/** Isolation check for a Stage 42 trial published BESIDE the real game (same origin, two paths), in a real (emulated) browser.
 *  usage: node tools/isolation-check.mjs <COMPOSITE_DIR> [--port 4191]      (COMPOSITE_DIR = the site as it would be deployed: Stage 41 at the root, the trial in ./stage42/)
 *  1. the REAL game (root) starts a game, plays a few years, saves (autosave + manual slot 2); its IndexedDB + localStorage are captured byte for byte;
 *  2. the TRIAL (/stage42/) opens in the SAME browser profile: it must start with NO game of its own (it must not see the real game's save), play, and save under its own names;
 *  3. the real game's IndexedDB + localStorage must be BYTE-IDENTICAL to step 1 (nothing of the trial leaked into them), and the real game must still load its own save.
 *  Exit code 0 only if every check passed. Needs Chromium (CHROMIUM_PATH) and Playwright. */
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import { chromium } from "playwright";
const DIR = path.resolve(process.argv[2]), arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = "/kudo-fudo-miseisen/", TRIAL = BASE + "stage42/", PORT = Number(arg("--port", "4191")), types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".wasm": "application/wasm" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"); if (!u.pathname.startsWith(BASE)) { res.writeHead(404); return res.end(); }
  let rel = decodeURIComponent(u.pathname.slice(BASE.length)); if (rel === "blank-isolation-probe.html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end("<!doctype html><title>probe</title>"); } if (!rel || rel.endsWith("/")) rel += "index.html"; const f = path.join(DIR, rel);
  if (!f.startsWith(DIR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { "Content-Type": types[path.extname(f)] ?? "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(PORT);
const results = []; const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  " + detail : "")); };
const kfm = (page, f) => page.evaluate(`(() => { const a = window.__kfm; return (${f})(a); })()`);
const ready = (page) => page.waitForFunction(() => window.__kfm?.world, null, { timeout: 120000 });
/** every IndexedDB database (name -> store -> key -> JSON text) and every localStorage entry of this origin, as one stable text */
const dump = (page) => page.evaluate(() => new Promise((res) => { indexedDB.databases().then(async (dbs) => { const out = { idb: {}, ls: {} };
  for (const d of dbs.sort((a, b) => (a.name < b.name ? -1 : 1))) { await new Promise((r2) => { const q = indexedDB.open(d.name); q.onsuccess = () => { const db = q.result, o = {}; const names = [...db.objectStoreNames]; if (!names.length) { out.idb[d.name] = o; db.close(); return r2(); }
    const tx = db.transaction(names, "readonly"); let left = names.length; for (const sn of names) { const rq = tx.objectStore(sn).openCursor(); o[sn] = {}; rq.onsuccess = () => { const c = rq.result; if (c) { o[sn][String(c.key)] = JSON.stringify(c.value); c.continue(); } else if (--left === 0) { out.idb[d.name] = o; db.close(); r2(); } }; } }; q.onerror = () => r2(); }); }
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); out.ls[k] = localStorage.getItem(k); } res(out); }); }));
/** localStorage entries that are not part of the game's own state (run markers change on every open by design); compared by KEY only for those */
const SESSION_KEYS = (k) => /(^|\.)run$/.test(k);
const hash = (o) => crypto.createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);
const stable = (d) => ({ idb: d.idb, ls: Object.fromEntries(Object.entries(d.ls).filter(([k]) => !SESSION_KEYS(k))) });
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
try {
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true }); const errs = []; let page = await ctx.newPage(); page.on("pageerror", (e) => errs.push(String(e)));
  // ---- 1. the REAL game writes a game
  await page.goto(`http://localhost:${PORT}${BASE}?nointro`); await ready(page);
  const pos = (n) => kfm(page, `a => a.world.cities.find((c) => c.name === '${n}').pos`), scr = (p) => page.evaluate((q) => window.__kfm.r.worldToScreen(q), p);
  await page.evaluate(() => { const a = window.__kfm; if (a.wizGo) a.wizGo(3); }); await page.click("#tool-cer-kokudo1");
  const A = await scr(await pos("東京")), B = await scr(await pos("大阪市")); await page.mouse.move(A[0], A[1]); await page.mouse.down(); await page.mouse.move(B[0], B[1], { steps: 14 }); await page.mouse.up();
  if (await page.locator("#wiz-ok").count()) { await kfm(page, "a => a.wizGo(0)"); await page.waitForFunction(() => { const a = window.__kfm; return !a.generating && !!a.terrain; }, null, { timeout: 90000 }); for (let k = 0; k < 4; k++) await page.click("#wiz-ok"); }
  await page.click("#cer-go"); await page.waitForFunction(() => window.__kfm.sim, null, { timeout: 90000 });
  await kfm(page, "a => { a.sim.speed = 0; a.sim.policy.mode = 'auto'; a.ffYears(6); return 1; }"); await page.evaluate(async () => { await window.__kfm.persist(true); });
  await kfm(page, "a => { a.openSheet('menu'); return 1; }"); await page.waitForSelector("#slot-2 .slot-save"); await page.click("#slot-2 .slot-save"); await page.waitForTimeout(800);
  const realMonth = await kfm(page, "a => a.sim.month"); await page.waitForTimeout(1500); await page.close(); page = await ctx.newPage(); await page.goto(`http://localhost:${PORT}${BASE}blank-isolation-probe.html`); const real0 = await dump(page); console.log("REAL wrote: month", realMonth, "idb", Object.keys(real0.idb).join(","), "ls", Object.keys(real0.ls).join(","));
  check("the real game saved under its own names (kfm-stage1, kfm.*)", Object.keys(real0.idb).includes("kfm-stage1") && Object.keys(real0.idb).every((n) => !n.includes("stage42trial")) && Object.keys(real0.ls).every((k) => !k.includes("stage42trial")));
  check("the real game: no page errors", errs.length === 0, errs[0] ?? "");
  await page.close();

  // ---- 2. the TRIAL opens in the same profile
  page = await ctx.newPage(); const errs2 = []; page.on("pageerror", (e) => errs2.push(String(e)));
  await page.goto(`http://localhost:${PORT}${TRIAL}?nointro`); await ready(page); await page.waitForTimeout(3000);
  check("the trial does NOT see the real game's save (starts without a game)", !(await kfm(page, "a => !!a.sim")));
  await page.evaluate(() => { const a = window.__kfm; if (a.wizGo) a.wizGo(3); }); await page.click("#tool-cer-kokudo1");
  const pos2 = (n) => kfm(page, `a => a.world.cities.find((c) => c.name === '${n}').pos`), scr2 = (p) => page.evaluate((q) => window.__kfm.r.worldToScreen(q), p);
  const A2 = await scr2(await pos2("東京")), B2 = await scr2(await pos2("大阪市")); await page.mouse.move(A2[0], A2[1]); await page.mouse.down(); await page.mouse.move(B2[0], B2[1], { steps: 14 }); await page.mouse.up();
  if (await page.locator("#wiz-ok").count()) { await kfm(page, "a => a.wizGo(0)"); await page.waitForFunction(() => { const a = window.__kfm; return !a.generating && !!a.terrain; }, null, { timeout: 90000 }); for (let k = 0; k < 4; k++) await page.click("#wiz-ok"); }
  await page.click("#cer-go"); await page.waitForFunction(() => window.__kfm.sim, null, { timeout: 90000 });
  await kfm(page, "a => { a.sim.speed = 0; a.sim.policy.mode = 'auto'; a.ffYears(4); return 1; }"); await page.evaluate(async () => { await window.__kfm.persist(true); });
  await kfm(page, "a => { a.openSheet('menu'); return 1; }"); await page.waitForSelector("#slot-2 .slot-save"); await page.click("#slot-2 .slot-save"); await page.waitForTimeout(800);
  // toggle a stored UI preference too (the one that had been written without its prefix)
  await page.evaluate(() => { try { localStorage.setItem("probe", "1"); localStorage.removeItem("probe"); } catch {} });
  await page.waitForTimeout(1500); await page.close(); page = await ctx.newPage(); await page.goto(`http://localhost:${PORT}${BASE}blank-isolation-probe.html`); const mid = await dump(page); console.log("TRIAL wrote: idb", Object.keys(mid.idb).join(","), "| ls", Object.keys(mid.ls).join(","));
  check("the trial saved under its own database (kfm-stage1-stage42trial)", Object.keys(mid.idb).includes("kfm-stage1-stage42trial"));
  check("the trial's localStorage keys are all its own (kfm-stage42trial.*)", Object.keys(mid.ls).filter((k) => k.startsWith("kfm")).every((k) => k.startsWith("kfm-stage42trial.")), Object.keys(mid.ls).filter((k) => k.startsWith("kfm") && !k.startsWith("kfm-stage42trial.")).join(","));
  check("the trial: no page errors", errs2.length === 0, errs2[0] ?? ""); await page.close();

  // ---- 3. the real game must be exactly as step 1 left it
  page = await ctx.newPage(); const errs3 = []; page.on("pageerror", (e) => errs3.push(String(e)));
  await page.goto(`http://localhost:${PORT}${BASE}?nointro`); await ready(page); await page.waitForFunction(() => window.__kfm.sim, null, { timeout: 120000 }).catch(() => {});
  check("the real game still loads its own save", await kfm(page, "a => !!a.sim && a.sim.month >= " + realMonth + " - 1"));
  const real1 = await dump(page);
  const onlyReal = (d) => ({ idb: Object.fromEntries(Object.entries(d.idb).filter(([n]) => !n.includes("stage42trial"))), ls: Object.fromEntries(Object.entries(d.ls).filter(([k]) => !k.includes("stage42trial"))) });
  const rs0 = stable(onlyReal(real0)), rs1 = stable(onlyReal(mid));
  { const names = (d) => Object.fromEntries(Object.entries(d.idb).map(([n, st]) => [n, Object.fromEntries(Object.entries(st).map(([s, kv]) => [s, Object.fromEntries(Object.entries(kv).map(([k, v]) => [k, v.length + ":" + crypto.createHash("sha256").update(v).digest("hex").slice(0, 8)]))]))])); const x = names(onlyReal(real0)), y = names(onlyReal(mid)); for (const n of Object.keys({ ...x, ...y })) for (const st of Object.keys({ ...(x[n] ?? {}), ...(y[n] ?? {}) })) for (const k of Object.keys({ ...(x[n]?.[st] ?? {}), ...(y[n]?.[st] ?? {}) })) if (x[n]?.[st]?.[k] !== y[n]?.[st]?.[k]) console.log("DIFF", n, st, k, x[n]?.[st]?.[k], "->", y[n]?.[st]?.[k]); } check("after the trial played: the real game's IndexedDB and localStorage are BYTE-IDENTICAL to before", hash(rs0) === hash(rs1), hash(rs0) + " vs " + hash(rs1));
  check("the real game's database holds no trial data (no key mentions stage42)", Object.values(real1.idb["kfm-stage1"] ?? {}).every((kv) => Object.keys(kv).every((k) => !k.includes("stage42"))) && Object.keys(real1.ls).filter((k) => !k.includes("stage42trial")).every((k) => k.startsWith("kfm.")));
  check("the real game: no page errors", errs3.length === 0, errs3[0] ?? ""); 
  await ctx.close();
} finally { await b.close(); server.close(); }
const bad = results.filter((r) => !r.ok); console.log(`\n${results.length - bad.length}/${results.length} checks passed`); process.exit(bad.length ? 1 : 0);
