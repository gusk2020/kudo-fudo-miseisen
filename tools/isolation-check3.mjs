#!/usr/bin/env node
/** (Stage 43) The same isolation check for THREE builds on one origin: the real game at the root, the Stage 42 trial at /stage42/, the Stage 43 trial at /stage43/.
 *  Derived from tools/isolation-check.mjs (which stays as it is for the two-site case).
 *  Original header follows.
 *  Isolation check for a Stage 42 trial published BESIDE the real game (same origin, two paths), in a real (emulated) browser.
 *  usage: node tools/isolation-check.mjs <COMPOSITE_DIR> [--port 4191]      (COMPOSITE_DIR = the site as it would be deployed: Stage 41 at the root, the trial in ./stage42/)
 *  1. the REAL game (root) starts a game, plays a few years, saves (autosave + manual slot 2); its IndexedDB + localStorage are captured byte for byte;
 *  2. the TRIAL (/stage42/) opens in the SAME browser profile: it must start with NO game of its own (it must not see the real game's save), play, and save under its own names;
 *  3. the real game's IndexedDB + localStorage must be BYTE-IDENTICAL to step 1 (nothing of the trial leaked into them), and the real game must still load its own save.
 *  Exit code 0 only if every check passed. Needs Chromium (CHROMIUM_PATH) and Playwright. */
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import { chromium } from "playwright";
const DIR = path.resolve(process.argv[2]), arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = "/kudo-fudo-miseisen/", PORT = Number(arg("--port", "4191")), types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".wasm": "application/wasm" };
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

// the three sites, oldest first: path, namespace (database name kfm-stage1[-ns], localStorage prefix kfm[-ns].)
const SITES = [{ name: "Stage 41 (root)", path: BASE, ns: "" }, { name: "Stage 42 (/stage42/)", path: BASE + "stage42/", ns: "stage42trial" }, { name: "Stage 43 (/stage43/)", path: BASE + "stage43/", ns: "stage43trial" }];
const dbOf = (s) => (s.ns ? "kfm-stage1-" + s.ns : "kfm-stage1"), lsOf = (s) => (s.ns ? "kfm-" + s.ns + "." : "kfm.");
/** only what belongs to site s: its database and its localStorage keys (run markers excluded) */
const own = (d, s) => ({ idb: d.idb[dbOf(s)] ?? null, ls: Object.fromEntries(Object.entries(d.ls).filter(([k]) => k.startsWith(lsOf(s)) && !SESSION_KEYS(k))) });
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
try {
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true });
  const probe = async () => { const p = await ctx.newPage(); await p.goto(`http://localhost:${PORT}${BASE}blank-isolation-probe.html`); const d = await dump(p); await p.close(); return d; };
  const after = [];   // after[i] = the origin's storage right after site i saved
  for (let i = 0; i < SITES.length; i++) {
    const s = SITES[i], page = await ctx.newPage(), errs = []; page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(`http://localhost:${PORT}${s.path}?nointro`); await ready(page); await page.waitForTimeout(3000);
    check(`${s.name}: starts WITHOUT a game (does not see the older sites' saves)`, !(await kfm(page, "a => !!a.sim")));
    await page.evaluate(() => { const a = window.__kfm; if (a.wizGo) a.wizGo(3); }); await page.click("#tool-cer-kokudo1");
    const pos = (n) => kfm(page, `a => a.world.cities.find((c) => c.name === '${n}').pos`), scr = (p) => page.evaluate((q) => window.__kfm.r.worldToScreen(q), p);
    const A = await scr(await pos("東京")), B = await scr(await pos("大阪市")); await page.mouse.move(A[0], A[1]); await page.mouse.down(); await page.mouse.move(B[0], B[1], { steps: 14 }); await page.mouse.up();
    if (await page.locator("#wiz-ok").count()) { await kfm(page, "a => a.wizGo(0)"); await page.waitForFunction(() => { const a = window.__kfm; return !a.generating && !!a.terrain; }, null, { timeout: 90000 }); for (let k = 0; k < 4; k++) await page.click("#wiz-ok"); }
    await page.click("#cer-go"); await page.waitForFunction(() => window.__kfm.sim, null, { timeout: 90000 });
    await kfm(page, `a => { a.sim.speed = 0; a.sim.policy.mode = 'auto'; a.ffYears(${6 - i}); return 1; }`); await page.evaluate(async () => { await window.__kfm.persist(true); });
    // the UI preferences a player changes: the layer window and (Stage 43) the speed panel
    await kfm(page, "a => { a.openSheet('menu'); return 1; }"); await page.waitForSelector("#slot-2 .slot-save"); await page.click("#slot-2 .slot-save"); await page.waitForTimeout(800);
    await kfm(page, "a => { a.openSheet(null); if (a.setToolsOpen) a.setToolsOpen(false); return 1; }");
    s.month = await kfm(page, "a => a.sim.month"); await page.waitForTimeout(1500); check(`${s.name}: no page errors while playing`, errs.length === 0, errs[0] ?? ""); await page.close();
    const d = await probe(); after.push(d); const mine = own(d, s);
    console.log(`${s.name} wrote: month ${s.month}; databases now: ${Object.keys(d.idb).join(",")}; its keys: ${Object.keys(mine.ls).join(",")}`);
    check(`${s.name}: saved under its own database (${dbOf(s)})`, !!mine.idb && Object.keys(mine.idb).length > 0);
    const foreign = Object.keys(d.ls).filter((k) => k.startsWith("kfm") && !SITES.some((t) => k.startsWith(lsOf(t))));
    check(`every kfm localStorage key belongs to exactly one site's prefix`, foreign.length === 0, foreign.join(","));
    for (let j = 0; j < i; j++) { const t = SITES[j]; check(`${s.name} left ${t.name}'s storage byte-identical`, hash(own(after[j], t)) === hash(own(d, t)), `${hash(own(after[j], t))} vs ${hash(own(d, t))}`); }
  }
  // finally every site reopens its own game, and nothing changed for the others by being opened
  const final0 = await probe();
  for (const s of SITES) {
    const page = await ctx.newPage(), errs = []; page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(`http://localhost:${PORT}${s.path}?nointro`); await ready(page); await page.waitForFunction(() => window.__kfm.sim, null, { timeout: 120000 }).catch(() => {});
    check(`${s.name}: still loads its own game (month ${s.month})`, await kfm(page, "a => !!a.sim && a.sim.month >= " + s.month + " - 1"));
    check(`${s.name}: no page errors on reload`, errs.length === 0, errs[0] ?? ""); await page.close();
  }
  const final1 = await probe();
  for (const s of SITES.slice(0, 2)) check(`${s.name}: its database is byte-identical to right after its own save (through all later sites)`, hash(own(after[SITES.indexOf(s)], s).idb) === hash(own(final0, s).idb));
  check("the Stage 41 database holds no key mentioning a trial", Object.values(final1.idb["kfm-stage1"] ?? {}).every((kv) => Object.keys(kv).every((k) => !/stage4[23]/.test(k))));
  await ctx.close();
} finally { await b.close(); server.close(); }
const bad = results.filter((r) => !r.ok); console.log(`\n${results.length - bad.length}/${results.length} checks passed`); process.exit(bad.length ? 1 : 0);
