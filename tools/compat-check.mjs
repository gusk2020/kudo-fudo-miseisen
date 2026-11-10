#!/usr/bin/env node
/** Save compatibility check across two built versions of the game, in a real (emulated) browser, on ONE origin like the real site.
 *  usage: node tools/compat-check.mjs <OLD_DIST> <NEW_DIST> [--base /kudo-fudo-miseisen/] [--port 4190]
 *  1. the OLD build starts a game, plays a few years, saves (autosave + manual slot 2); its browser storage (IndexedDB + localStorage) is captured;
 *  2. the NEW build opens THAT storage: the game must come back (same month, capital, routes, cities) and keep playing and saving; the older save text is kept under `:pre-s35`;
 *  3. the OLD build opens what the NEW build wrote: it must either load it or put it aside without touching the stored game (the way back).
 *  Exit code 0 only if every check passed. Needs a Chromium (CHROMIUM_PATH) and Playwright from the repository. */
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { chromium } from "playwright";
const [OLD, NEW] = process.argv.slice(2, 4).map((p) => path.resolve(p)), arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "/kudo-fudo-miseisen/"), PORT = Number(arg("--port", "4190")), types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let root = OLD;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"); if (!u.pathname.startsWith(BASE)) { if (u.pathname === "/") { res.writeHead(302, { Location: BASE + u.search }); return res.end(); } res.writeHead(404); return res.end(); }
  let rel = decodeURIComponent(u.pathname.slice(BASE.length)); if (!rel || rel.endsWith("/")) rel += "index.html"; const f = path.join(root, rel);
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { "Content-Type": types[path.extname(f)] ?? "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(PORT);
const results = []; const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  " + detail : "")); };
const launch = () => chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const kfm = (page, f) => page.evaluate(`(() => { const a = window.__kfm; return (${f})(a); })()`);
const ready = (page) => page.waitForFunction(() => window.__kfm?.world, null, { timeout: 120000 });
const summary = (page) => kfm(page, "a => ({ month: a.sim.month, capital: a.sim.capital ?? 'default', routes: Object.keys(a.sim.routes).length, cities: Object.keys(a.sim.cities).length, pop: Math.round(Object.values(a.sim.cities).reduce((s, c) => s + c.pop, 0)), startYear: a.sim.startYear, relocFirst: a.sim.relocFirst ?? null })");
const rawKeys = (page) => page.evaluate(() => new Promise((res) => { indexedDB.databases().then(async (dbs) => { const out = {}; for (const d of dbs) { await new Promise((r2) => { const q = indexedDB.open(d.name); q.onsuccess = () => { const db = q.result; if (!db.objectStoreNames.contains("saves")) { db.close(); return r2(); } const st = db.transaction("saves").objectStore("saves"); const k = st.getAllKeys(); k.onsuccess = () => { const v = st.getAll(); v.onsuccess = () => { k.result.forEach((key, i) => { out[d.name + "/" + String(key)] = String(v.result[i]).length; }); db.close(); r2(); }; }; }; q.onerror = () => r2(); }); } res(out); }); }));

const b = await launch();
try {
  // ---- 1. OLD build writes a game
  root = OLD; let ctx = await b.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true }); let page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(`http://localhost:${PORT}${BASE}?nointro`); await ready(page);
  const pos = (n) => kfm(page, `a => a.world.cities.find((c) => c.name === '${n}').pos`), scr = (p) => page.evaluate((q) => window.__kfm.r.worldToScreen(q), p);
  await page.evaluate(() => { const a = window.__kfm; if (a.wizGo) a.wizGo(3); }); await page.click("#tool-cer-kokudo1");
  const A = await scr(await pos("東京")), B = await scr(await pos("大阪市")); await page.mouse.move(A[0], A[1]); await page.mouse.down(); await page.mouse.move(B[0], B[1], { steps: 14 }); await page.mouse.up();
  if (await page.locator("#wiz-ok").count()) { await kfm(page, "a => a.wizGo(0)"); await page.waitForFunction(() => { const a = window.__kfm; return !a.generating && !!a.terrain; }, null, { timeout: 90000 }); for (let k = 0; k < 4; k++) await page.click("#wiz-ok"); }
  await page.click("#cer-go"); await page.waitForFunction(() => window.__kfm.sim, null, { timeout: 90000 });
  await kfm(page, "a => { a.sim.speed = 0; a.sim.policy.mode = 'auto'; a.ffYears(6); return 1; }"); await page.evaluate(async () => { await window.__kfm.persist(true); });
  await kfm(page, "a => { a.openSheet('menu'); return 1; }"); await page.waitForSelector("#slot-2 .slot-save"); await page.click("#slot-2 .slot-save"); await page.waitForTimeout(800);
  const before = await summary(page), keys0 = await rawKeys(page); console.log("OLD wrote", JSON.stringify(before), JSON.stringify(keys0));
  check("old build: no page errors while writing the save", errs.length === 0, errs[0] ?? ""); check("old save is a plain game without the Stage 34 log", await kfm(page, "a => !a.sim.rec34"));
  const state1 = await ctx.storageState({ indexedDB: true }); const oldAuto = await page.evaluate(() => new Promise((res) => { indexedDB.databases().then((dbs) => { const q = indexedDB.open(dbs.find((d) => d.name.startsWith("kfm-stage1")).name); q.onsuccess = () => { const g = q.result.transaction("saves").objectStore("saves").get("s3:auto"); g.onsuccess = () => res(g.result); }; }); }));
  { const j = JSON.parse(oldAuto); const sv = j.save ?? j; console.log("old stored save: keys", Object.keys(j).join(","), "| sim.stage3", sv.sim?.stage3, "| sim.rec34", !!sv.sim?.rec34); }
  await ctx.close();

  // ---- 2. NEW build opens that storage
  root = NEW; ctx = await b.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, storageState: state1 }); page = await ctx.newPage(); const errs2 = []; page.on("pageerror", (e) => errs2.push(String(e)));
  await page.goto(`http://localhost:${PORT}${BASE}?nointro`); await ready(page); await page.waitForFunction(() => window.__kfm.sim, null, { timeout: 120000 }).catch(() => {});
  const loaded = await kfm(page, "a => !!a.sim"); check("new build: the old game comes back on its own", loaded);
  if (loaded) {
    const after = await summary(page); check("new build: same month / capital / routes / cities / population", after.month >= before.month && after.month - before.month <= 3 && after.capital === before.capital && after.routes === before.routes && after.cities === before.cities && Math.abs(after.pop - before.pop) / before.pop < 0.02, JSON.stringify(after));
    check("new build: the start year and first relocation boundary are unchanged", after.startYear === before.startYear && after.relocFirst === before.relocFirst, `${after.startYear}/${after.relocFirst}`);
    check("new build: the game was not quarantined or locked", !(await kfm(page, "a => a.saveLocked")));
    check("new build: an old game stays an old game (no reclamation log invented)", await kfm(page, "a => !a.sim.rec34 && !a.world.g34"));
    await kfm(page, "a => { a.sim.speed = 0; a.sim.policy.mode = 'auto'; a.ffYears(3); return 1; }"); await page.evaluate(async () => { await window.__kfm.persist(true); });
    const m2 = await kfm(page, "a => a.sim.month"); check("new build: it keeps playing", m2 > after.month);
    const keys1 = await rawKeys(page); const kn = Object.keys(keys1); check("new build: the original save text is kept for good under ':pre-s35'", kn.some((k) => k.endsWith("s3:auto:pre-s35")), kn.join(","));
    const preSame = await page.evaluate((orig) => new Promise((res) => { indexedDB.databases().then((dbs) => { const q = indexedDB.open(dbs.find((d) => d.name.startsWith("kfm-stage1")).name); q.onsuccess = () => { const g = q.result.transaction("saves").objectStore("saves").get("s3:auto:pre-s35"); g.onsuccess = () => res(g.result === orig); }; }); }), oldAuto);
    check("new build: ':pre-s35' is byte-identical to what the old build had saved", preSame);
    check("new build: the manual slot 2 written by the old build is still listed", await kfm(page, "a => { a.openSheet('menu'); return 1; }").then(async () => { await page.waitForSelector("#slot-2"); return (await page.textContent("#slot-2")).includes("年"); }));
    await page.reload(); await ready(page); await page.waitForFunction(() => window.__kfm.sim, null, { timeout: 120000 }).catch(() => {}); check("new build: reload brings back its own newer save", await kfm(page, "a => !!a.sim && a.sim.month >= " + m2 + " - 1"));
  }
  check("new build: no page errors", errs2.length === 0, errs2[0] ?? "");
  const state2 = await ctx.storageState({ indexedDB: true }); await ctx.close();

  // ---- 3. the way back: the OLD build opens what the NEW build wrote
  root = OLD; ctx = await b.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, storageState: state2 }); page = await ctx.newPage(); const errs3 = []; page.on("pageerror", (e) => errs3.push(String(e)));
  await page.goto(`http://localhost:${PORT}${BASE}?nointro`); await ready(page); await page.waitForTimeout(4000);
  const backLoaded = await kfm(page, "a => !!a.sim"); const locked = await kfm(page, "a => !!a.saveLocked");
  console.log("OLD reading NEW's save: loaded =", backLoaded, ", locked =", locked);
  check("rollback: the old build opens the newer save without a page error", errs3.length === 0, errs3[0] ?? "");
  check("rollback: either it loads the game or it puts it aside WITHOUT overwriting it", backLoaded || locked);
  const stillThere = await rawKeys(page); check("rollback: the stored game and the ':pre-s35' copy are still in storage", Object.keys(stillThere).some((k) => k.endsWith("s3:auto")) && Object.keys(stillThere).some((k) => k.endsWith("s3:auto:pre-s35")), Object.keys(stillThere).join(","));
  await ctx.close();
} finally { await b.close(); server.close(); }
const bad = results.filter((r) => !r.ok); console.log(`\n${results.length - bad.length}/${results.length} checks passed`); process.exit(bad.length ? 1 : 0);
