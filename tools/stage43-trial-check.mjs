#!/usr/bin/env node
/** Stage 43 trial: the features of PR #100 in a NEW 1800 game of the /stage43/ build, in a real (emulated, Pixel 7 size) browser, served as it would be deployed.
 *  usage: node tools/stage43-trial-check.mjs <COMPOSITE_DIR> [--port 4193]. Exit code 0 only if every check passed. Not the phone: Chromium emulation. */
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import { chromium } from "playwright";
const DIR = path.resolve(process.argv[2]), arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = "/kudo-fudo-miseisen/", TRIAL = BASE + "stage43/", PORT = Number(arg("--port", "4193")), types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".wasm": "application/wasm" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"); if (!u.pathname.startsWith(BASE)) { res.writeHead(404); return res.end(); }
  let rel = decodeURIComponent(u.pathname.slice(BASE.length)); if (rel === "blank-isolation-probe.html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end("<!doctype html><title>probe</title>"); } if (!rel || rel.endsWith("/")) rel += "index.html"; const f = path.join(DIR, rel);
  if (!f.startsWith(DIR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { "Content-Type": types[path.extname(f)] ?? "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(PORT);
const results = []; const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  " + detail : "")); };
const kfm = (page, f) => page.evaluate(`(() => { const a = window.__kfm; return (${f})(a); })()`);
const pos = (page, n) => kfm(page, `a => a.world.cities.find((c) => c.name === '${n}').pos`), scr = (page, p) => page.evaluate((q) => window.__kfm.r.worldToScreen(q), p);
/** one stroke through several towns (the view is fitted to all of them first) */
async function drawPath(page, names) { const ps = []; for (const n of names) ps.push(await pos(page, n)); const xs = ps.map((p) => p[0]), ys = ps.map((p) => p[1]);
  await page.evaluate(([cx, cy]) => window.__kfm.r.setView({ cx, cy, zoom: 0.75 }), [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]); await page.waitForTimeout(500);
  const S = []; for (const p of ps) S.push(await scr(page, p)); await page.mouse.move(S[0][0], S[0][1]); await page.mouse.down(); for (let i = 1; i < S.length; i++) await page.mouse.move(S[i][0], S[i][1], { steps: 14 }); await page.mouse.up(); }
const year = (page) => kfm(page, "a => a.sim.startYear + Math.floor(a.sim.month / 12)");
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
try {
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, deviceScaleFactor: 1 }); const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(String(e))); page.on("dialog", (d) => void d.accept()); page.setDefaultTimeout(30000);
  // ---- a new 1800 game: 空路重視 / 地方分散 / 日本海側
  await page.goto(`http://localhost:${PORT}${TRIAL}?nointro`); await page.waitForFunction(() => window.__kfm?.world, null, { timeout: 120000 });
  await kfm(page, "a => a.wizGo(1)"); await page.waitForSelector("#e86-name"); await page.click("#e86-name button:not([disabled])"); await page.click("#e86-stance-kuuro"); await page.click("#e86-focus-disperse"); await page.click("#e86-coast-japansea");
  await kfm(page, "a => a.wizGo(3)"); await page.click("#tool-cer-kokudo1"); await drawPath(page, ["東京", "大阪市"]);
  await kfm(page, "a => a.wizGo(0)"); await page.waitForFunction(() => { const a = window.__kfm; return !a.generating && !!a.terrain; }, null, { timeout: 90000 }); for (let k = 0; k < 4; k++) await page.click("#wiz-ok"); await page.click("#cer-go"); await page.waitForFunction(() => window.__kfm.sim, null, { timeout: 90000 });
  const flags = await kfm(page, "a => ({ start: a.sim.startYear, s43: a.sim.s43, north41: a.sim.north41, trunk42: a.sim.trunk42, stance: a.sim.kaigen.eras[0].stance, focus: a.sim.kaigen.recon.focus })"); console.log("flags", JSON.stringify(flags));
  check("new 1800 game carries the Stage 43 rules (s43, north41, trunk42) under 空路重視・地方分散", flags.start === 1800 && flags.s43 === true && flags.north41 === true && flags.trunk42 === true && flags.stance === "kuuro" && flags.focus === "disperse");
  const north = await kfm(page, "a => ['大泊', '真岡', '泊(国後島)', '斜古丹(色丹島)', '紗那(択捉島)'].filter((n) => { const c = a.world.cities.find((x) => x.name === n); return c && a.sim.cities[c.id]; })");
  check("北方: 樺太 and 千島 towns are on the map and in the game", north.length === 5, north.join(","));
  // ---- the top line, the title, the speed panel
  await kfm(page, "a => { a.sim.speed = 0; a.runner.settle(); a.render(); return 1; }"); await page.waitForTimeout(500);
  const hud = await page.textContent("#status"); check("top line: one policy line 方針(初期/現在) 空路/空路・分散/分散", hud.includes("方針(初期/現在) 空路/空路・分散/分散"), hud.slice(0, 60));
  check("the title bar is hidden while playing", await page.evaluate(() => { const t = document.getElementById("top"); return !t || getComputedStyle(t).display === "none"; }));
  { const st = await page.locator("#status").boundingBox(); check("the information line sits at the top edge", st && st.y < 12, JSON.stringify(st)); }
  await kfm(page, "a => { a.setToolsOpen(false); a.buildUI(); return 1; }"); await page.waitForTimeout(300);
  check("speed panel folds to a chip", await page.isVisible("#speed-chip") && !(await page.isVisible("#speed-20")));
  await page.click("#speed-chip"); await page.waitForTimeout(300); check("one tap on the chip opens the speed panel", await page.isVisible("#speed-20"));
  // ---- layers: three folding groups, eight transport rows, each with a sample
  await kfm(page, "a => { a.layerOpen.add('traffic'); a.openSheet('layers'); return 1; }"); await page.waitForTimeout(400);
  const rows = ["lr-hwy", "lr-road", "lr-hsr", "lr-rail", "lr-air-trunk", "lr-air-local", "lr-sea-trunk", "lr-sea-local"];
  const lay = await page.evaluate((ids) => ({ groups: ["terrain", "traffic", "other"].filter((g) => document.getElementById("lhead-" + g)).length, rows: ids.filter((id) => { const e = document.getElementById(id); return e && e.closest("label")?.querySelector(".lsample svg"); }).length }), rows);
  check("layer window: 地形/交通/その他 groups and 8 transport rows with samples", lay.groups === 3 && lay.rows === 8, JSON.stringify(lay));
  await page.uncheck("#lr-air-local"); check("a transport row switches its own layer only (空路・地方 off)", await kfm(page, "a => a.hide.has('air:local') && !a.hide.has('air:trunk')")); await page.check("#lr-air-local"); await kfm(page, "a => { a.openSheet(null); return 1; }");
  // ---- night: the moon button, the slider only while on
  await page.click("#btn-night"); await page.waitForTimeout(300); const n1 = await page.isVisible("#night-size"); await page.click("#btn-night"); await page.waitForTimeout(300); const n2 = await page.isVisible("#night-size");
  check("night view: moon button toggles it, the vertical slider shows only while on", n1 && !n2 && !(await kfm(page, "a => a.night")));
  // ---- the 1900 relocation: a special line that only PASSES the capital and a sub-capital (千葉→東京→大阪→神戸)
  await kfm(page, "a => { a.sim.speed = 0; a.sim.policy.mode = 'autoReloc'; a.ffYears(88); a.runner.settle(); return 1; }"); console.log("year before relocation", await year(page));
  await kfm(page, "a => { const s = a.sim; a.runner.settle(); s.policy.pending = null; s.kaigen.pending = null; s.kaigen.next = 1940; s.policy.mode = 'priority'; s.month = (1900 - s.startYear) * 12; s.speed = 20; return 1; }");
  await page.waitForFunction(() => window.__kfm.sim.e2200?.state === "pending", null, { timeout: 120000 }); await page.waitForSelector("#e22-box"); await page.click("[id^=e22-era-]:not(.blocked)"); await page.click("#e22-next"); await page.click("#e22-decide");
  await page.waitForFunction(() => window.__kfm.sim.e2200?.state === "road0", null, { timeout: 60000 }); await page.waitForSelector("#sp-row");
  const seats = await kfm(page, "a => { const e = a.sim.e2200; return JSON.stringify({ cap: e.capital ?? a.sim.capital, subs: e.subs ?? null }); }"); console.log("seats", seats);
  await page.click("#tool-cer-kokudo0").catch(() => {}); await drawPath(page, ["千葉市", "東京", "大阪市", "神戸市"]); await page.waitForSelector("#cer-status-kokudo0"); const s0 = await page.textContent("#cer-status-kokudo0"); console.log("free 0号:", s0);
  check("special line through the capital and a sub-capital (not starting/ending there) is accepted", s0.includes("✓"), s0);
  await page.click("#rw-review"); await page.click("#rw-confirm"); await page.waitForFunction(() => window.__kfm.sim.e2200?.state === "done", null, { timeout: 60000 });
  const r0 = await kfm(page, "a => { const r = Object.values(a.sim.routes).find((r) => r.grade === 'national' && r.scope === 'JP' && r.number === 0); if (!r) return null; const cells = r.edges.flatMap((ref) => a.sim.edges[ref.edgeId]?.cells ?? []); const near = (n) => { const c = a.world.cities.find((x) => x.name === n); return Math.round(Math.min(...cells.map((k) => { const p = a.world.cellPos(k); return Math.hypot(p[0] - c.pos[0], p[1] - c.pos[1]); }))); }; return { edges: r.edges.length, chibaKm: near('千葉市'), kobeKm: near('神戸市') }; }");
  check("the built 国道0号 reaches beyond the seats at both ends (千葉 and 神戸, within 15 km)", r0 && r0.chibaKm < 15 && r0.kobeKm < 15, JSON.stringify(r0));
  // ---- the decade mode runs and the years advance
  await kfm(page, "a => { a.openSheet(null); a.sim.policy.mode = 'autoReloc'; a.setTurbo(true); return 1; }"); const y0 = await year(page); await page.waitForTimeout(12000); const y1 = await year(page); await kfm(page, "a => { a.setTurbo(false); a.setSpeed(0); return 1; }");
  check("10年モード advances the years (12 s)", y1 > y0, `${y0} -> ${y1}`);
  // ---- to about 2000: flights by tier, islands served
  await kfm(page, "a => { a.sim.speed = 0; a.sim.policy.mode = 'autoReloc'; const t = 2000 - (a.sim.startYear + Math.floor(a.sim.month / 12)); if (t > 0) a.ffYears(t); a.runner.settle(); return 1; }"); console.log("year now", await year(page));
  const air = await kfm(page, "a => { const h = a.sim.hubs, aps = Object.values(h.airports).filter((x) => x.until === undefined), open = h.routes.filter((r) => r.mode === 'air' && !r.intl && r.state === 'open'); const served = new Set(open.flatMap((r) => [r.a, r.b])); return { airports: aps.length, withRoute: aps.filter((x) => served.has(x.city)).length, local: open.filter((r) => r.local).length, domestic: open.length }; }");
  await kfm(page, "a => { const c = a.world.cities.find((x) => x.name === '札幌市') || a.world.cities[0]; a.r.setView({ cx: c.pos[0], cy: c.pos[1], zoom: 0.6 }, true); a.renderRoads(); return 1; }"); await page.waitForTimeout(500); const drawn = await kfm(page, "a => a.r.roads.airDrawn");
  console.log("air", JSON.stringify(air), "drawn", JSON.stringify(drawn));
  check("every airport has a flight and both tiers (幹線 / 地方路線) are drawn (the lifeline-route count is logged: it is only needed when demand alone leaves an airport without a flight)", air.airports > 20 && air.withRoute === air.airports && drawn.trunk > 0 && drawn.local > 0, JSON.stringify({ air, drawn }));
  // ---- save, reload, the same game comes back
  const m = await kfm(page, "a => a.sim.month"); await page.evaluate(async () => { await window.__kfm.persist(true); }); await page.reload(); await page.waitForFunction(() => window.__kfm?.sim, null, { timeout: 120000 });
  check("reload brings back the same Stage 43 game", (await kfm(page, "a => a.sim.month")) === m && (await kfm(page, "a => a.sim.s43")) === true);
  check("no page errors", errs.length === 0, errs.slice(0, 2).join(" | "));
  await ctx.close();
} finally { await b.close(); server.close(); }
const bad = results.filter((r) => !r.ok); console.log(`\n${results.length - bad.length}/${results.length} checks passed`); process.exit(bad.length ? 1 : 0);
