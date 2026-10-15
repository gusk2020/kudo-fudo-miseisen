import { worldToPostOps, worldParts } from "../core/body";
import { axisFrame, tOf } from "../core/constraints";
import { ISLAND_LABEL } from "../core/data";
import { dist, pointInPolygon, pointSegDist, rot as rotv, simplifyLine } from "../core/geom";
import { exportGame, getRaw, listSlots, loadGame, makeSave, mapStateHash, parseSave, putRaw, saveGame, validateSimAgainstWorld } from "../core/save2";
import { Store, featureWorldPos, LAYER_KEYS, LAYER_LABELS, ROAD_LAYER_KEYS, defaultState, realState } from "../core/state";
import { suggestRidge } from "../core/suggest";
import type { TerrainResult } from "../core/terrain";
import { TerrainClient } from "../core/terrainClient";
import { GeoMap } from "../core/geoid";
import { STEPS, STEP_LABELS, type IslandId, type Issue, type Op, type Place, type StepId, type Vec } from "../core/types";
import { clampOp } from "../core/warp";
import { derive, errorsFor, validate } from "../core/validate";
import { Renderer, type Pending } from "../render/renderer";
import { attachGestures } from "./gestures";
import { CER_LABEL, performCeremony, previewCeremony, type CerKind, type CerPreview } from "../sim/ceremony";
import { MS_PER_MONTH_X1, advance, createSimGen, noteSkipped, planCatchUp, prefName, routeLabel, routeOfficial, summary } from "../sim/engine";
import { exportScenery } from "../sim/scenery";
import { codesAt } from "../sim/ledger";
import { displayName } from "../sim/straits";
import { finishMigration } from "../sim/migrate";
import { SimRunner } from "../sim/runner";
import { ERA, GRADE_LABEL, KIND_LABEL, NICK_LABEL, PROJECT_LABEL, STANDARD_LABEL, STANDARD_LABEL_RAIL, STATE_LABEL, SURFACE_LABEL, eraLabel, monthToYM, setActiveEra, ymLabel, type SimState } from "../sim/types";
import { COND, CASING } from "../render/roads";
import { edgePoints } from "../sim/network";
import { buildWorld, type World } from "../sim/world";
import { eraKeyOf, type EraKey } from "../sim/eras";
import { buildAtlas, buildLedger, buildPolicy, buildTimeline, eraPicker } from "./stage3";

type Tool = "view" | "pull" | "bulge" | "dent" | "move" | "feature" | "ridge-sw" | "ridge-ne" | "ridge-edit" | "cer-kokudo1" | "cer-fudo1" | "pick" | "why";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k.startsWith("on") && typeof v === "function") (e as any)[k] = v; else if (k === "class") e.className = v; else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : String(v)); }
  for (const k of kids) e.append(k);
  return e;
}
const ROT_STEP = Math.PI / 36; // 5 degrees
const stateKey = (s: Store["state"]) => JSON.stringify([s.seed, s.bodies, s.features, s.ridges]);

export class App {
  store = new Store(); r!: Renderer;
  terrain: TerrainResult | null = null; terrainKey = ""; generating = false; genProgress = 0;
  issues: Issue[] = []; tool: Tool = "view"; activeBody: IslandId = "honshu"; selFeature: "biwa" | "fuji" = "biwa";
  brushKm = 160; pending: Pending | null = null; sheet: string | null = null;
  client = new TerrainClient(new URL(import.meta.env.BASE_URL + "japan-dem.bin", document.baseURI).href, () => new Worker(new URL("../core/terrain.worker.ts", import.meta.url), { type: "module" }));
  private genTimer: any = 0; private saveTimer: any = 0; private grab: any = null;
  // ---- Stage 2 ----
  sim: SimState | null = null; world: World | null = null; private worldRef: TerrainResult | null = null; pendingSim: SimState | null = null;
  cerDraft: Partial<Record<CerKind, { pts: Vec[]; prev: CerPreview }>> = {}; private cerLive: Vec[] | null = null; pin: Vec | null = null; scenery: any = null;
  compareYear: number | null = null; selEdge: string | null = null;
  /** Stage 3: the era chosen before the ceremony, the year being looked at (null = now, time running), and the background map. */
  lite = false; private slowTicks = 0;
  eraChoice: EraKey = "heisei"; viewYear: number | null = null; bg: "terrain" | "roadmap" = "terrain"; hide = new Set<string>(); names = false; legendOpen = true;
  runner: SimRunner | null = null; building = 0; safeMode = false; behind = false; private lastRoads = 0;
  private lastBackup = 0; private lastSaved = 0; private persistRetry = 0; catching = false; catchInfo = ""; private acc = 0; private lastTick = 0; private hiddenAt = 0; private lastPersist = 0; private lastHud = 0;

  /** Stage 3 plays on the real Japan; the old hand-edited-map flow stays reachable with ?legacy=1 and keeps its own save key. */
  /** Set when a stored save existed but its road data could not be attached: autosave must not overwrite it with an empty state. */
  private saveLocked = false; private prevCopied = false;
  real = false; get saveKey() { return this.real ? "s3:auto" : "auto"; }
  static async start(host: HTMLElement, real = false) {
    const a = new App(); a.real = real; a.r = await Renderer.create(host);
    if (real) { a.store.replace(realState()); document.body.classList.add("real"); try { if (localStorage.getItem("kfm.bg") !== "terrain") { a.bg = "roadmap"; a.r.setBg("roadmap"); }   /* default: road map */
      try { const u = JSON.parse(localStorage.getItem("kfm.ui") || "{}"); if (Array.isArray(u.hide)) a.hide = new Set(u.hide.filter((x: unknown) => typeof x === "string")); a.names = u.names === true; a.legendOpen = u.legendOpen !== false; } catch { /* ignore */ } a.lite = localStorage.getItem("kfm.lite") === "1"; } catch { /* ignore */ } }
    // A tab that was killed (out of memory, renderer crash) never ran pagehide, so the marker is still set: start in safe mode.
    try { a.safeMode = !!localStorage.getItem("kfm.run"); localStorage.setItem("kfm.run", String(Date.now())); } catch { /* storage may be blocked */ }
    a.r.onContextLost = () => a.toast("画面の描画が一時的に失われました。復帰を待っています…"); a.r.onContextRestored = () => { a.render(); a.toast("描画が復帰しました"); };
    let saved = await loadGame(a.saveKey), restoredFromBackup = false;
    if (!saved && real) {
      // The latest save exists but cannot be read (storage cut off mid-write, a crash): keep the broken copy aside and fall back to the backup.
      const raw = await getRaw(a.saveKey);
      if (raw) { await putRaw(a.saveKey + ":broken", { savedAt: Date.now(), raw }); saved = await loadGame(a.saveKey + ":backup"); restoredFromBackup = !!saved; }
    }
    if (!saved && real && (await getRaw(a.saveKey))) a.saveLocked = true;   // an unreadable save is never replaced by a fresh empty state
    if (saved && saved.quarantine) a.saveLocked = true;
    if (restoredFromBackup) setTimeout(() => a.toast("最新のセーブが壊れていたため、バックアップから復元しました(壊れたデータは別に保管しています)"), 800);
    if (saved) {
      a.store.replace(saved.map); a.pendingSim = saved.sim;
      if (saved.quarantine) { await putRaw(a.saveKey + ":quarantine", { savedAt: Date.now(), quarantine: saved.quarantine }); }
      if (saved.problems.length) a.toast("保存データについて: " + saved.problems.slice(0, 2).join(" / "));
    }
    attachGestures(a.r.app.canvas, a.r, a.handler());
    a.store.subscribe(() => a.onChange()); a.store.onBlocked = () => a.toast("地図は最終確定済みでロックされています(保存メニューから解除できます)");
    a.bindStatic(); a.r.fit(a.store.state); a.onChange(true);
    (window as any).__kfm = a; (window as any).__adv = advance;
    window.addEventListener("resize", () => a.r.setView({}, true));
    a.lastTick = performance.now(); const loop = (t: number) => { a.tickClock(t); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
    if (a.safeMode) a.toast("前回は異常終了した可能性があります。安全モード(停止状態・追いつき計算なし)で再開します");
    document.addEventListener("visibilitychange", () => a.onVisibility()); window.addEventListener("pagehide", () => { a.persist(true); a.markClean(); });
    return a;
  }
  get s() { return this.store.state; }
  get stepId(): StepId { return STEPS[this.s.step]; }
  toast(msg: string) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout((this as any)._tt); (this as any)._tt = setTimeout(() => (t.hidden = true), 3200); }

  // ---------- change pipeline ----------
  onChange(initial = false) {
    this.issues = validate(this.s);
    const key = stateKey(this.s);
    if (key !== this.terrainKey) { this.terrain = null; this.terrainKey = ""; if (this.generating) { this.client.cancel(); this.generating = false; } }
    if ((this.s.step >= 4 || this.pendingSim) && !this.terrain && !this.generating) { clearTimeout(this.genTimer); this.genTimer = setTimeout(() => this.generate(), initial ? 0 : 250); }
    this.render(); this.buildUI();
    clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.persist(), 400);
  }
  render() { this.r.update(this.s, this.terrain, this.issues, this.pending); this.renderRoads(); }
  markClean() { try { localStorage.removeItem("kfm.run"); } catch { /* ignore */ } }
  /** Saves only between simulated months (never a half-finished one). `force` finishes the month first (the page is going away). */
  persist(force = false): Promise<boolean> {
    // Saves only between months. While the clock is busy, wait for a gap (one retry timer at a time, never a growing pile of them);
    // if none comes for 30 s (×20 never goes idle), finish the month in progress and save anyway so progress is never lost.
    if (this.runner && !this.runner.idle) {
      if (!force && performance.now() - this.lastSaved < 30000) { if (!this.persistRetry) this.persistRetry = window.setTimeout(() => { this.persistRetry = 0; void this.persist(); }, 120); return Promise.resolve(false); }
      this.runner.settle();
    }
    this.lastSaved = performance.now();
    if (!this.prevCopied) { this.prevCopied = true; void getRaw(this.saveKey).then((raw) => { if (raw) { try { return putRaw(this.saveKey + ":prev", JSON.parse(raw)); } catch { return putRaw(this.saveKey + ":prev", { raw }); } } }).catch(() => { /* ignore */ }); }
    if (this.saveLocked && !this.sim && !this.pendingSim) return Promise.resolve(false);
    if (this.sim) this.sim.lastWallMs = Date.now(); this.lastPersist = performance.now();
    if (this.real && this.sim && performance.now() - this.lastBackup > 120000) { this.lastBackup = performance.now(); void saveGame(this.saveKey + ":backup", makeSave(this.s, this.sim)); }   /* a second copy every two minutes; a sim still waiting for its terrain is kept in the save, never dropped */ return saveGame(this.saveKey, makeSave(this.s, this.sim ?? this.pendingSim)); }
  ensureWorld(): World | null { if (!this.terrain) return null; if (this.worldRef !== this.terrain) { this.world = buildWorld(this.terrain, this.s.seed); this.worldRef = this.terrain; } return this.world; }
  renderRoads() {
    const cer = (["kokudo1", "fudo1"] as CerKind[]).map((k) => this.cerDraft[k]).filter(Boolean).map((d) => ({ pts: d!.pts, path: d!.prev.path, ok: d!.prev.ok }));
    if (this.cerLive) cer.push({ pts: this.cerLive, path: undefined as any, ok: true });
    const L = this.s.layers, onRoads = (this.s.step >= 5 && !!this.sim) || this.s.step === 6;
    if (onRoads) this.ensureWorld();
    this.r.setRoads({ sim: this.sim, w: onRoads ? this.world : null, layers: { roads: L.roads, rail: L.rail, plans: L.plans, signs: L.signs, abandoned: L.abandoned, ports: L.ports }, cer: this.s.step === 6 ? cer : [], pin: this.s.step === 6 ? this.pin : null, compare: this.compareYear && this.sim ? (this.sim.stage3 ? codesAt(this.sim.snaps, this.compareYear) : this.sim.snaps.find((x) => x.year === this.compareYear)?.edges ?? null) : null, compareYear: this.compareYear, lite: this.lite, past: this.viewYear !== null && this.sim ? { year: this.viewYear, codes: codesAt(this.sim.snaps, this.viewYear) ?? {} } : null, sel: this.selEdge, hide: [...this.hide], names: this.names });
  }
  /** After terrain exists: attach a loaded sim only if it matches this map and terrain exactly; otherwise quarantine it. */
  private attachPendingSim() {
    if (!this.pendingSim) return; const w = this.ensureWorld(), sim = this.pendingSim; if (!w || !this.terrain) return; this.pendingSim = null;
    const err = mapStateHash(this.s) !== sim.mapHash ? "地図が道路データと一致しません" : validateSimAgainstWorld(sim, w, this.terrain.hash);
    if (err) { putRaw(this.saveKey + ":quarantine", { savedAt: Date.now(), reason: err, sim }); this.saveLocked = true; this.toast(`道路データは読み込まず退避しました(保存データは上書きしません): ${err}`); return; }
    finishMigration(sim, w); this.sim = sim; setActiveEra(eraKeyOf(sim.era)); this.runner = new SimRunner(sim, w);
    if (this.safeMode) { sim.speed = 0; this.status(); return; }
    const away = sim.lastWallMs > 0 ? Date.now() - sim.lastWallMs : 0; void this.catchUp(away);
  }
  async generate() {
    if (errorsFor(this.issues, "honshu").length || errorsFor(this.issues, "islands").length || errorsFor(this.issues, "features").length) { this.status(); return; }
    const key = stateKey(this.s); this.generating = true; this.genProgress = 0; this.status();
    try {
      const res = await this.client.generate(JSON.parse(JSON.stringify(this.s)), (p) => { this.genProgress = p; this.status(); });
      if (stateKey(this.s) !== key) return;
      this.terrain = res; this.terrainKey = key; this.ensureWorld(); this.attachPendingSim();
    } catch (e: any) { if (String(e?.message) !== "cancelled") this.toast("地形生成に失敗: " + e?.message); }
    this.generating = false; this.render(); this.buildUI();
  }
  status() {
    const el = $("status"); el.replaceChildren();
    const add = (t: string, c = "") => el.append(h("span", { class: c }, t));
    const errs = this.issues.filter((i) => i.severity === "error" && STEPS.indexOf(i.step) <= Math.min(this.s.step, 3));
    if (this.building > 0) add(`1950年の道路網を生成中 ${Math.round(this.building * 100)}%`, "bad");
    if (this.s.step === 6 && this.sim) {
      const m = summary(this.sim), sp = this.sim.speed;
      add(`${m.ym}`, "ok"); add(sp ? `速度 ×${sp}` : "停止中"); add(this.sim.stage3 ? `路線${m.routes}本 道路${m.roadKm.toLocaleString()}km・鉄道${m.railKm.toLocaleString()}km` : `路線${m.routes}本 総延長${m.km.toLocaleString()}km`); if (this.viewYear !== null) add(`${this.viewYear}年を閲覧中(読み取り専用)`, "bad"); if (this.sim.policy?.pending) add("政策介入の待機中", "bad"); add(`建設中${m.building} 未成${m.unbuilt}`);
      add(`状態 良${m.good}/可${m.fair}/悪${m.poor}`); add(`休止${m.dormant} 閉鎖${m.closed} 廃道${m.lost}`);
      const last = this.sim.events[this.sim.events.length - 1]; if (last) add(`最近: ${last.text}`);
      if (this.catching) add(this.catchInfo, "bad");
      if (this.behind) add("端末の処理が追いつかず、速度を自動で落としています", "bad");
      if (this.safeMode) add("安全モード", "bad");
      if (this.sim.skippedMonths) add(`省略${Math.floor(this.sim.skippedMonths / 12)}年分`, "bad");
    }
    if (this.generating) add(`地形生成中 ${Math.round(this.genProgress * 100)}%`);
    if (errs.length) add(`⚠ 不正 ${errs.length}件`, "bad");
    else if (this.s.step > 0) add("✓ 検証OK", "ok");
    if (this.s.finalized && this.s.step !== 6) add("確定済み🔒", "ok");
    $("dock-issues").classList.toggle("warn", errs.length > 0);
    $("dock-issues").textContent = errs.length ? `検証(${errs.length})` : "検証";
  }

  // ---------- navigation ----------
  canAdvance(): boolean {
    const i = this.s.step; if (i >= STEPS.length - 1) return false;
    if (i === 5) return this.s.finalized && !!this.terrain;
    for (let k = 1; k <= Math.min(i, 3); k++) if (errorsFor(this.issues, STEPS[k]).length) return false;
    return true;
  }
  go(n: number) { n = Math.max(0, Math.min(STEPS.length - 1, n)); this.tool = "view"; this.pending = null; if (n === 2 && this.activeBody === "honshu") this.activeBody = "hokkaido"; if (n === 1) this.activeBody = "honshu"; this.store.set((s) => { s.step = n; }); }

  // ---------- editing tools ----------
  private bodyForTool(): IslandId { return this.s.step === 1 ? "honshu" : this.activeBody; }
  private editable() { return this.tool !== "view" && !this.generating && !this.catching && (this.s.step === 6 || !this.store.locked); }
  handler() {
    return {
      active: () => this.editable(),
      begin: (w: Vec, sc: Vec) => this.toolBegin(w, sc),
      move: (w: Vec, sc: Vec) => this.toolMove(w, sc),
      end: () => this.toolEnd(),
      cancel: () => { this.grab = null; this.pending = null; this.render(); },
    };
  }
  toolBegin(w: Vec, sc: Vec): boolean {
    const t = this.tool, s = this.s;
    if (t === "cer-kokudo1" || t === "cer-fudo1") { this.grab = { t, kind: t === "cer-kokudo1" ? "kokudo1" : "fudo1", pts: [w] }; this.cerLive = [w]; this.renderRoads(); return true; }
    if (t === "pick" || t === "why") { this.grab = { t, w }; return true; }
    if (t === "pull" || t === "bulge" || t === "dent" || t === "move") {
      const id = this.bodyForTool(), bs = s.bodies[id];
      const c = worldToPostOps(bs.place, w);
      this.grab = { t, id, w0: w, sc0: sc, c, place0: { ...bs.place, pos: [...bs.place.pos] as Vec } };
      return true;
    }
    if (t === "feature") {
      let best: "biwa" | "fuji" | null = null, bd = 34 / this.r.view.zoom;
      for (const f of ["biwa", "fuji"] as const) { const d = dist(featureWorldPos(s, f), w); if (d < bd) { bd = d; best = f; } }
      if (!best) return false;
      this.selFeature = best; this.grab = { t, which: best, off: [featureWorldPos(s, best)[0] - w[0], featureWorldPos(s, best)[1] - w[1]] as Vec };
      this.buildUI(); return true;
    }
    if (t === "ridge-sw" || t === "ridge-ne") { if (!this.onHonshu(w)) return false; this.grab = { t, key: t === "ridge-sw" ? "sw" : "ne", pts: [w] }; this.pending = { ridge: { key: this.grab.key, pts: [w] } }; this.render(); return true; }
    if (t === "ridge-edit") {
      let best: { key: "sw" | "ne"; i: number } | null = null, bd = 30 / this.r.view.zoom;
      for (const key of ["sw", "ne"] as const) (s.ridges[key] ?? []).forEach((q, i) => { const d = dist(q, w); if (d < bd) { bd = d; best = { key, i }; } });
      if (!best) return false;
      this.grab = { t, ...(best as { key: "sw" | "ne"; i: number }) }; return true;
    }
    return false;
  }

  private onHonshu(w: Vec) { return pointInPolygon(w, worldParts("honshu", this.s.bodies.honshu)[0]); }
  toolMove(w: Vec, sc: Vec) {
    const g = this.grab; if (!g) return;
    if (g.t === "cer-kokudo1" || g.t === "cer-fudo1") { if (dist(g.pts[g.pts.length - 1], w) >= 8 / this.r.view.zoom) { g.pts.push(w); this.cerLive = g.pts; this.renderRoads(); } return; }
    if (g.t === "pick" || g.t === "why") { g.w = w; return; }
    if (g.t === "pull" || g.t === "bulge" || g.t === "dent") {
      const scl = g.place0.scale, r = this.brushKm / scl;
      let op: Op;
      if (g.t === "pull") { const dw: Vec = [w[0] - g.w0[0], w[1] - g.w0[1]], d = rotv(dw, -g.place0.rot); op = clampOp({ t: "pull", c: g.c, d: [d[0] / scl, d[1] / scl], r }); }
      else { const dk = dist(w, g.w0) / this.brushKm; op = clampOp({ t: "bulge", c: g.c, r, k: (g.t === "bulge" ? 1 : -1) * Math.min(0.6, 0.15 + 0.5 * dk) }); }
      g.op = op; this.pending = { body: { id: g.id, op } }; this.render();
    } else if (g.t === "move") {
      const place: Place = { ...g.place0, pos: [g.place0.pos[0] + w[0] - g.w0[0], g.place0.pos[1] + w[1] - g.w0[1]] };
      g.place = place; this.pending = { body: { id: g.id, place } }; this.render();
    } else if (g.t === "feature") {
      g.pos = [w[0] + g.off[0], w[1] + g.off[1]]; this.pending = { feature: { which: g.which, pos: g.pos } }; this.render();
    } else if (g.t === "ridge-sw" || g.t === "ridge-ne") {
      if (dist(g.pts[g.pts.length - 1], w) >= 10 / this.r.view.zoom && this.onHonshu(w)) { g.pts.push(w); this.pending = { ridge: { key: g.key, pts: g.pts } }; this.render(); }
    } else if (g.t === "ridge-edit") {
      const pts = [...(this.s.ridges[g.key as "sw" | "ne"] ?? [])]; pts[g.i] = w; g.pts = pts; this.pending = { ridge: { key: g.key, pts } }; this.render();
    }
  }
  toolEnd() {
    const g = this.grab; this.grab = null; if (!g) return;
    this.pending = null; this.cerLive = null;
    if (g.t === "cer-kokudo1" || g.t === "cer-fudo1") { this.finishDraw(g.kind, g.pts); return; }
    if (g.t === "pick") { this.pickScenery(g.w); return; }
    if (g.t === "why") { this.whyAt(g.w); return; }
    if (g.t === "pull" || g.t === "bulge" || g.t === "dent") {
      let op: Op | undefined = g.op;
      if (!op && g.t !== "pull") op = clampOp({ t: "bulge", c: g.c, r: this.brushKm / g.place0.scale, k: g.t === "bulge" ? 0.3 : -0.3 });
      if (op && (op.t !== "pull" || Math.hypot(op.d[0], op.d[1]) > 0.5)) this.store.commit((s) => { s.bodies[g.id as IslandId].ops.push(op!); });
      else this.render();
    } else if (g.t === "move" && g.place) this.store.commit((s) => { s.bodies[g.id as IslandId].place = g.place; });
    else if (g.t === "feature" && g.pos) this.store.commit((s) => { s.features[g.which as "biwa" | "fuji"].pos = g.pos; });
    else if ((g.t === "ridge-sw" || g.t === "ridge-ne") && g.pts.length >= 2) this.store.commit((s) => { s.ridges[g.key as "sw" | "ne"] = simplifyLine(g.pts, 4); });
    else if (g.t === "ridge-edit" && g.pts) this.store.commit((s) => { s.ridges[g.key as "sw" | "ne"] = g.pts; });
    else this.render();
  }
  rotateSel(dir: number) {
    if (this.s.step === 3) this.store.commit((s) => { s.features[this.selFeature].rot += dir * ROT_STEP; });
    else { const id = this.bodyForTool(); this.store.commit((s) => { s.bodies[id].place.rot += dir * ROT_STEP; }); }
  }
  scaleSel(dir: number) { const id = this.bodyForTool(); this.store.commit((s) => { s.bodies[id].place.scale = Math.max(0.3, Math.min(3, s.bodies[id].place.scale * (dir > 0 ? 1.05 : 1 / 1.05))); }); }
  suggestRanges() {
    const d = derive(this.s), neRef = rotv([Math.SQRT1_2, Math.SQRT1_2], this.s.bodies.honshu.place.rot), f = axisFrame(d.parts.honshu[0], neRef);
    this.store.commit((s) => { s.ridges.sw = suggestRidge(d.parts.honshu[0], f, "sw"); s.ridges.ne = suggestRidge(d.parts.honshu[0], f, "ne"); });
  }

  // ---------- Stage 2: ceremony, clock, scenery ----------
  private finishDraw(kind: CerKind, pts: Vec[]) {
    const w = this.ensureWorld(); if (!w) return;
    if (pts.length < 2) { this.renderRoads(); return; }
    this.cerDraft[kind] = { pts, prev: previewCeremony(w, kind, pts) };
    if (!this.cerDraft[kind]!.prev.ok) this.toast(this.cerDraft[kind]!.prev.reasons[0]);
    this.renderRoads(); this.buildUI();
  }
  cerReady() { return !!(this.cerDraft.kokudo1?.prev.ok && this.cerDraft.fudo1?.prev.ok); }
  async doCeremony() {
    const w = this.ensureWorld(), k = this.cerDraft.kokudo1?.prev, f = this.cerDraft.fudo1?.prev;
    if (!w || !this.terrain || !k?.ok || !f?.ok || !this.s.finalized || this.sim || this.building) return;
    this.building = 0.01; this.status(); this.buildUI();
    // the 1950 network is generated in slices (a single long task froze phones); the UI shows progress and stays responsive
    const gen = createSimGen(w, mapStateHash(this.s), this.terrain.hash, this.s.seed, this.real ? { era: this.eraChoice, stage3: true } : {}); let sim: SimState | null = null;
    while (!sim) {
      const t0 = performance.now();
      while (performance.now() - t0 < 10) { const r = gen.next(); if (r.done) { sim = r.value; break; } this.building = Math.max(this.building, r.value); }
      this.status(); await new Promise((res) => setTimeout(res, 0));
    }
    this.building = 0;
    if (!performCeremony(sim, w, k, f)) { this.toast("開通の儀を行えませんでした"); this.buildUI(); return; }
    sim.speed = 1; this.sim = sim; this.saveLocked = false; this.runner = new SimRunner(sim, w); this.cerDraft = {}; this.tool = "view"; this.acc = 0; this.lastTick = performance.now();
    this.persist(); this.toast("開通の儀を終えました。時間が動き始めます"); this.onChange();
  }
  /** Look at a past year (read-only, time stopped) or return to now. Never changes the simulation. */
  setViewYear(y: number | null) {
    this.viewYear = y; if (y !== null) this.selEdge = null;
    this.renderRoads(); this.status(); this.buildToolbar(); this.buildSheet(); this.toast(y === null ? "現在に戻りました(時間が再び進みます)" : `${y}年を表示中(読み取り専用・時間は停止)`);
  }
  /** Centre the map on a route (from the ledger) and highlight its longest section. */
  focusRoute(routeId: string) {
    const sim = this.sim, w = this.world, r = sim?.routes[routeId]; if (!sim || !w || !r) return;
    const es = r.edges.map((x) => sim.edges[x.edgeId]).filter(Boolean); if (!es.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const e of es) for (const p of edgePoints(w, sim, e)) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    const { w: sw, h: sh } = this.r.size, zoom = Math.min(2.5, Math.max(0.3, 0.8 * Math.min(sw / (x1 - x0 + 40), (sh * 0.45) / (y1 - y0 + 40))));
    this.selEdge = es.sort((p, q) => q.lengthKm - p.lengthKm)[0].id; this.r.setView({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 - (sh * 0.2) / zoom, zoom }); this.renderRoads();
  }
  afterPolicy() { this.lastTick = performance.now(); this.acc = 0; this.persist(true); this.renderRoads(); this.status(); this.buildSheet(); }
  /** Test/debug hook: advance synchronously (the normal clock is slower than a test can wait). */
  ffYears(n: number) { if (!this.sim || !this.world) return; this.runner?.settle(); advance(this.sim, this.world, 12 * n); this.renderRoads(); this.status(); this.buildUI(); }
  setSpeed(n: 0 | 1 | 5 | 20) { if (!this.sim) return; this.sim.speed = n; this.acc = 0; this.lastTick = performance.now(); this.persist(); this.buildUI(); }
  /** Real-time clock: only while this page is visible. Tab hidden or app closed = no simulation; return = capped catch-up. */
  tickClock(frameTime = performance.now()) {
    const now = frameTime, sim = this.sim, w = this.world, run = this.runner;
    if (sim?.policy?.pending && this.sheet !== "policy") { this.sheet = "policy"; this.buildSheet(); this.toast("10年ごとの政策介入の機会です(時間は止まっています)"); }
    if (!sim || !w || !run || !sim.ceremonyDone || sim.speed === 0 || document.hidden || this.catching || this.s.step < 5 || this.viewYear !== null || sim.policy?.pending) { this.lastTick = now; return; }
    const dt = Math.min(250, Math.max(0, now - this.lastTick)); this.lastTick = now;
    this.acc += dt * sim.speed; const n = Math.floor(this.acc / MS_PER_MONTH_X1);
    if (n > 0) { this.acc -= n * MS_PER_MONTH_X1; run.request(n); }
    // at most ~8 ms of simulation per frame: the page stays smooth and the clock simply falls behind on a slow phone
    const done = run.pump(8); this.behind = run.dropped > 0 && run.pending >= 20; if (run.pending < 3) run.dropped = 0;
    // a device that cannot keep up for a long stretch switches itself to the light drawing (and says so)
    this.slowTicks = this.behind ? this.slowTicks + 1 : Math.max(0, this.slowTicks - 2);
    if (this.real && !this.lite && this.slowTicks > 1800) { this.setLite(true); this.toast("端末の処理が追いつかないため、軽量表示に切り替えました(レイヤーで戻せます)"); }
    if (done > 0) this.afterTick(now);
  }
  private afterTick(now = performance.now()) {
    if (now - this.lastRoads > (this.lite ? 1200 : 450)) { this.lastRoads = now; this.renderRoads(); }   // redrawing the road layer is the costly part: ~2 Hz is plenty
    if (now - this.lastHud > 500) { this.lastHud = now; this.status(); if (this.sheet === "history" || this.sheet === "roads") this.buildSheet(); }
    if (now - this.lastPersist > 10000) this.persist();
  }
  async catchUp(elapsedMs: number) {
    const sim = this.sim, run = this.runner; if (!sim || !run || !sim.ceremonyDone) return;
    const plan = planCatchUp(elapsedMs, sim.speed); if (plan.months <= 0 && plan.skipped <= 0) return;
    this.catching = true; const target = sim.month + plan.months; if (sim.policy) sim.policy.away = true;
    while (sim.month < target) {
      if (sim.policy?.pending) break;
      run.request(Math.min(24, target - sim.month - run.pending)); run.pump(12);
      this.catchInfo = `放置分を計算中 ${Math.floor((plan.months - (target - sim.month)) / 12)}/${Math.floor(plan.months / 12)}年`; this.status();
      await new Promise((r) => setTimeout(r, 0));
    }
    run.settle(); if (sim.policy) sim.policy.away = false; noteSkipped(sim, plan.skipped); this.catching = false; this.catchInfo = ""; this.lastTick = performance.now(); this.acc = 0;
    if (plan.skipped) this.toast(`放置が長いため${Math.floor(plan.skipped / 12)}年分の経過を省略しました`);
    this.renderRoads(); this.status(); this.persist();
  }
  onVisibility() {
    if (document.hidden) { this.hiddenAt = Date.now(); this.persist(true); this.markClean(); return; }
    try { localStorage.setItem("kfm.run", String(Date.now())); } catch { /* ignore */ }
    if (this.sim && this.hiddenAt) { const away = Date.now() - this.hiddenAt; this.hiddenAt = 0; void this.catchUp(away); }
  }
  /** Tap a road: show what it is and why it changed (designation, nickname, standard, demand split, old/new road, history). */
  whyAt(world: Vec) {
    const w = this.ensureWorld(), sim = this.sim; if (!w || !sim) return;
    let best: { id: string; d: number } | null = null;
    for (const e of Object.values(sim.edges)) { const pts = edgePoints(w, sim, e); for (let i = 0; i + 1 < pts.length; i++) { const d = pointSegDist(world, pts[i], pts[i + 1]); if (!best || d < best.d) best = { id: e.id, d }; } }
    if (!best || best.d > 16 / this.r.view.zoom) { this.selEdge = null; this.renderRoads(); this.toast("近くに道路がありません"); return; }
    this.selEdge = best.id; this.renderRoads(); this.sheet = "why"; this.buildSheet();
  }
  pickScenery(world: Vec) {
    const w = this.ensureWorld(); if (!w || !this.sim || !this.terrain) return;
    const g = new GeoMap(this.s, this.terrain).toGeo(world); this.pin = world;
    this.scenery = exportScenery(this.sim, w, world, g); this.renderRoads(); this.sheet = "scenery"; this.buildSheet();
  }

  // ---------- UI ----------
  bindStatic() {
    $("btn-prev").onclick = () => this.go(this.s.step - 1);
    $("btn-next").onclick = () => { if (this.canAdvance()) this.go(this.s.step + 1); else { this.openSheet("issues"); this.toast("不正を直すと次の工程へ進めます"); } };
    $("btn-undo").onclick = () => { if (!this.store.undo()) this.toast("取り消せる操作がありません"); };
    $("btn-redo").onclick = () => this.store.redo();
    $("btn-fit").onclick = () => { this.r.fit(this.s); };
    if (this.real) this.buildRealDock(); else document.querySelectorAll<HTMLButtonElement>("#dock [data-sheet]").forEach((b) => (b.onclick = () => this.openSheet(b.dataset.sheet!)));
    $("sheet-close").onclick = () => this.openSheet(null);
  }
  setLite(on: boolean) { this.lite = on; this.slowTicks = 0; try { localStorage.setItem("kfm.lite", on ? "1" : "0"); } catch { /* ignore */ } this.renderRoads(); this.buildSheet(); }
  saveUi() { try { localStorage.setItem("kfm.ui", JSON.stringify({ hide: [...this.hide], names: this.names, legendOpen: this.legendOpen })); } catch { /* ignore */ } }
  /** Legend filters are display-only: they never touch the simulation. */
  toggleHide(key: string) { if (this.hide.has(key)) this.hide.delete(key); else this.hide.add(key); this.saveUi(); this.renderRoads(); this.buildSheet(); }
  setBg(bg: "terrain" | "roadmap") { this.bg = bg; try { localStorage.setItem("kfm.bg", bg); } catch { /* ignore */ } this.r.setBg(bg); this.buildToolbar(); }
  /** Stage 3 dock: the observation tools get their own buttons (the old dock's 検証/取消/やり直し make no sense on a fixed real map). */
  private buildRealDock() {
    const dock = $("dock"), fit = $("btn-fit");   // the old buttons stay in the DOM (other code reads them) but are hidden
    for (const b of Array.from(dock.children)) if (b !== fit) (b as HTMLElement).hidden = true;
    for (const [id, label] of [["layers", "レイヤー"], ["timeline", "年表"], ["ledger", "台帳"], ["atlas", "地図帳"], ["policy", "介入"], ["menu", "保存"]] as [string, string][]) dock.insertBefore(h("button", { id: "dock-" + id, onclick: () => this.openSheet(id) }, label), fit);
  }
  openSheet(name: string | null) { this.sheet = this.sheet === name ? null : name; this.buildSheet(); }
  buildUI() {
    const i = this.s.step;
    $("step-title").textContent = this.real ? (this.sim ? "酷道・腐道・未成線" : "酷道・腐道・未成線 — 開通の儀") : `${STEP_LABELS[this.stepId]}  (${i + 1}/${STEPS.length})`;
    ($("btn-prev") as HTMLButtonElement).disabled = i === 0;
    ($("btn-next") as HTMLButtonElement).disabled = i >= STEPS.length - 1;
    ($("btn-undo") as HTMLButtonElement).disabled = !this.store.canUndo; ($("btn-redo") as HTMLButtonElement).disabled = !this.store.canRedo;
    this.status(); this.buildToolbar(); this.buildSheet();
  }
  private tbtn(label: string, on: boolean, f: () => void, id?: string) { return h("button", { id, type: "button", class: on ? "mode on" : "mode", "aria-pressed": on ? "true" : "false", onclick: f }, on ? "✓ " + label : label); }
  private setTool(t: Tool) { this.tool = this.tool === t ? "view" : t; this.pending = null; this.buildToolbar(); }
  buildToolbar() {
    const tb = $("toolbar"); tb.replaceChildren(); const st = this.stepId;
    const TOOL_NAMES: Record<Tool, string> = { "cer-kokudo1": "国道1号を描く", "cer-fudo1": "府道1号を描く", pick: "風景JSON: 地点を選ぶ", why: "なぜ変化したか: 道路をタップ", view: "表示(パン・ズームのみ)", pull: "引っ張る", bulge: "膨らます", dent: "凹ます", move: "移動", feature: "琵琶湖/富士山の移動", "ridge-sw": "南西の山脈を描く", "ridge-ne": "北東の山脈を描く", "ridge-edit": "山脈の点を動かす" };
    if (this.store.locked && (st === "honshu" || st === "islands" || st === "features")) {
      tb.append(h("div", { id: "lock-banner", role: "status" }, "🔒 地図は最終確定済みのためロック中(閲覧のみ)"), h("button", { id: "unlock-map", type: "button", onclick: () => this.unlockMap() }, "ロックを解除して編集"));
      return;
    }
    if (st === "roads") { this.buildRoadToolbar(tb, TOOL_NAMES); return; }
    if (st === "honshu" || st === "islands" || st === "features") {
      const tgt = st === "islands" ? `／対象: ${ISLAND_LABEL[this.activeBody]}` : st === "honshu" ? "／対象: 本州" : "";
      tb.append(h("div", { id: "mode-label", role: "status", "aria-live": "polite", "data-tool": this.tool }, `選択中: ${TOOL_NAMES[this.tool]}${tgt}`));
    }
    const tools = (list: [Tool, string][]) => { const g = h("div", { class: "grp" }); for (const [t, l] of list) g.append(this.tbtn(l, this.tool === t, () => this.setTool(t), "tool-" + t)); tb.append(g); };
    const brush = () => tb.append(h("label", {}, "範囲", h("input", { type: "range", min: 40, max: 400, step: 10, value: this.brushKm, id: "brush", oninput: (e: Event) => { this.brushKm = +(e.target as HTMLInputElement).value; } })));
    const xform = () => { const g = h("div", { class: "grp" }); g.append(h("button", { id: "rot-l", onclick: () => this.rotateSel(1) }, "⟲5°"), h("button", { id: "rot-r", onclick: () => this.rotateSel(-1) }, "⟳5°"), h("button", { id: "sc-up", onclick: () => this.scaleSel(1) }, "＋大"), h("button", { id: "sc-dn", onclick: () => this.scaleSel(-1) }, "－小")); tb.append(g); };
    if (st === "honshu") { tools([["pull", "引っ張る"], ["bulge", "膨らます"], ["dent", "凹ます"], ["move", "移動"]]); brush(); xform(); }
    else if (st === "islands") {
      const g = h("div", { class: "grp" });
      for (const id of ["hokkaido", "kyushu", "shikoku"] as IslandId[]) g.append(this.tbtn(ISLAND_LABEL[id], this.activeBody === id, () => { this.activeBody = id; this.buildToolbar(); }, "body-" + id));
      tb.append(g); tools([["move", "移動"], ["pull", "引っ張る"], ["bulge", "膨らます"], ["dent", "凹ます"]]); brush(); xform();
    } else if (st === "features") {
      tools([["feature", "琵琶湖/富士山"], ["ridge-sw", "南西の山脈を描く"], ["ridge-ne", "北東の山脈を描く"], ["ridge-edit", "山脈の点を動かす"]]);
      const g = h("div", { class: "grp" });
      g.append(this.tbtn("琵琶湖を回転対象", this.selFeature === "biwa", () => { this.selFeature = "biwa"; this.buildToolbar(); }), this.tbtn("富士山を回転対象", this.selFeature === "fuji", () => { this.selFeature = "fuji"; this.buildToolbar(); }));
      g.append(h("button", { id: "rot-l", onclick: () => this.rotateSel(1) }, "⟲5°"), h("button", { id: "rot-r", onclick: () => this.rotateSel(-1) }, "⟳5°"), h("button", { id: "suggest", onclick: () => this.suggestRanges() }, "標準の山脈"));
      tb.append(g);
    } else if (st === "terrain") {
      tb.append(h("div", { class: "grp" }, h("button", { id: "reseed", onclick: () => this.store.commit((s) => { s.seed = (s.seed * 1664525 + 1013904223) >>> 0; }) }, "地形の乱数を変える"), h("span", {}, `seed ${this.s.seed}`)));
    }
  }
  unlockMap() {
    if (this.sim && !confirm("地図の編集を再開すると、作成済みの道路とシミュレーションは消えます。よろしいですか?")) return;
    this.sim = null; this.pendingSim = null; this.cerDraft = {}; this.pin = null; this.store.unlock(); this.persist(); this.toast("ロックを解除しました");
  }
  private buildRoadToolbar(tb: HTMLElement, names: Record<Tool, string>) {
    const label = (t: string) => tb.append(h("div", { id: "mode-label", role: "status", "aria-live": "polite", "data-tool": this.tool }, t));
    if (!this.s.finalized || !this.terrain) { label(this.s.finalized ? "地形を生成中…" : "地図を最終確定すると道路を始められます"); return; }
    if (!this.sim) {
      label(`選択中: ${names[this.tool]}`);
      if (this.real) eraPicker(this, tb, this.eraChoice, (k) => { this.eraChoice = k; this.buildToolbar(); });
      else tb.append(h("div", { id: "era-note", class: "note" }, `${eraLabel(1950)}(1950年)開始。${ERA.note}。元号による政策差はごく小さな初期値のみです。`));
      const g = h("div", { class: "grp" });
      for (const k of ["kokudo1", "fudo1"] as CerKind[]) { const t = ("cer-" + k) as Tool, d = this.cerDraft[k]; g.append(this.tbtn(CER_LABEL[k] + (d ? (d.prev.ok ? " 済" : " 要修正") : ""), this.tool === t, () => this.setTool(t), "tool-" + t)); }
      tb.append(g);
      for (const k of ["kokudo1", "fudo1"] as CerKind[]) { const d = this.cerDraft[k]; if (d) tb.append(h("div", { id: "cer-status-" + k, class: "note " + (d.prev.ok ? "okc" : "badc") }, d.prev.ok ? `✓ ${CER_LABEL[k]}: 約${d.prev.lengthKm}km／終点: ${d.prev.endName}${d.prev.passes.length ? "／通過: " + d.prev.passes.slice(0, 4).join("・") : ""}` : `✗ ${d.prev.reasons.join(" / ")}`)); }
      tb.append(h("button", { id: "cer-go", type: "button", disabled: !this.cerReady(), onclick: () => void this.doCeremony() }, "開通の儀を行う"));
      return;
    }
    label(`選択中: ${names[this.tool]}`);
    if (this.real && this.viewYear !== null) tb.append(h("button", { id: "btn-now", type: "button", class: "mode on", onclick: () => this.setViewYear(null) }, `${this.viewYear}年を閲覧中(読み取り専用) → 現在に戻る`));
    const sp = h("div", { class: "grp" });
    for (const [n, l] of [[0, "停止"], [1, "×1"], [5, "×5"], [20, "×20"]] as [0 | 1 | 5 | 20, string][]) sp.append(this.tbtn(l, this.sim.speed === n, () => this.setSpeed(n), "speed-" + n));
    tb.append(sp);
    const g = h("div", { class: "grp" });
    if (this.real) {
      g.append(h("button", { id: "btn-legend", type: "button", onclick: () => this.openSheet("legend") }, "凡例"),
        h("button", { id: "btn-bg", type: "button", "aria-pressed": this.bg === "roadmap" ? "true" : "false", class: this.bg === "roadmap" ? "mode on" : "mode", onclick: () => this.setBg(this.bg === "roadmap" ? "terrain" : "roadmap") }, this.bg === "roadmap" ? "✓ 道路地図" : "背景:地形"));
      tb.append(g); const gw = h("div", { class: "grp" }); gw.append(this.tbtn("なぜ?(線路・道路をタップ)", this.tool === "why", () => this.setTool("why"), "tool-why")); tb.append(gw); return;
    }
    g.append(h("button", { id: "btn-history", type: "button", onclick: () => this.openSheet("history") }, "年表"), h("button", { id: "btn-roads", type: "button", onclick: () => this.openSheet("roads") }, "路線一覧"), h("button", { id: "btn-legend", type: "button", onclick: () => this.openSheet("legend") }, "凡例"), h("button", { id: "btn-compare", type: "button", "aria-pressed": this.compareYear ? "true" : "false", class: this.compareYear ? "mode on" : "mode", onclick: () => this.openSheet("compare") }, this.compareYear ? `✓ 比較:${this.compareYear}年` : "比較"));
    tb.append(g);
    const g2 = h("div", { class: "grp" }); g2.append(this.tbtn("なぜ?(道路をタップ)", this.tool === "why", () => this.setTool("why"), "tool-why"), this.tbtn("風景JSON", this.tool === "pick", () => this.setTool("pick"), "tool-pick")); tb.append(g2);
  }
  buildSheet() {
    const sh = $("sheet"), body = $("sheet-body");
    sh.hidden = this.sheet === null; body.replaceChildren(); if (!this.sheet) return;
    if (this.sheet === "layers") {
      body.append(h("h3", {}, "表示レイヤー"));
      const wrap = h("div", { class: "row" });
      for (const k of this.s.step === 6 ? [...LAYER_KEYS, ...ROAD_LAYER_KEYS] : LAYER_KEYS) wrap.append(h("label", { class: "layer" }, h("input", { type: "checkbox", id: "layer-" + k, checked: this.s.layers[k], onchange: (e: Event) => { const v = (e.target as HTMLInputElement).checked; this.store.set((s) => { s.layers[k] = v; }); } }), LAYER_LABELS[k]));
      body.append(wrap, h("small", {}, "河川・府県境・標高は「1E 地形生成」以降に表示されます。"));
      if (this.real) body.append(h("label", { class: "layer" }, h("input", { type: "checkbox", id: "layer-lite", checked: this.lite, onchange: (e: Event) => this.setLite((e.target as HTMLInputElement).checked) }), "軽量表示(動作が重いとき。点線を実線にし、ラベルと港・空港を減らす)"));
    } else if (this.sheet === "issues") {
      body.append(h("h3", {}, "検証結果"));
      body.append(h("div", { class: "row" }, h("button", { id: "revalidate", onclick: () => { this.terrain = null; this.terrainKey = ""; this.onChange(); this.toast("再検証しました"); } }, "全工程を再検証")));
      if (!this.issues.length) body.append(h("div", { class: "issue" }, "問題はありません"));
      for (const is of this.issues) body.append(h("div", { class: "issue " + is.severity }, `[${STEP_LABELS[is.step]}] ${is.msg}`));
      if (this.terrain?.warnings.length) { body.append(h("h3", {}, "地形生成の記録(簡易近似の限界)")); for (const w of this.terrain.warnings) body.append(h("div", { class: "issue warn" }, w)); }
      if (this.s.step < 3 && this.issues.some((i) => i.step === "features" || i.step === "islands")) body.append(h("small", {}, "後続工程の不整合は、その工程に進んで直してください。"));
    } else if (this.sheet === "history") this.buildHistory(body);
    else if (this.sheet === "roads") this.buildRoadList(body);
    else if (this.sheet === "scenery") this.buildScenery(body);
    else if (this.sheet === "legend") this.buildLegend(body);
    else if (this.sheet === "compare") this.buildCompare(body);
    else if (this.sheet === "why") this.buildWhy(body);
    else if (this.sheet === "menu") this.buildMenu(body);
    else if (this.sheet === "timeline") buildTimeline(this, body);
    else if (this.sheet === "ledger") buildLedger(this, body);
    else if (this.sheet === "atlas") buildAtlas(this, body);
    else if (this.sheet === "policy") buildPolicy(this, body);
  }
  private buildHistory(body: HTMLElement) {
    body.append(h("h3", {}, "年表(新しい順)"));
    if (!this.sim) { body.append(h("small", {}, "開通の儀のあとに記録されます")); return; }
    if (this.sim.skippedMonths) body.append(h("div", { class: "issue warn" }, `放置により合計${Math.floor(this.sim.skippedMonths / 12)}年${this.sim.skippedMonths % 12}か月分の経過を省略しています`));
    for (const e of [...this.sim.events].reverse().slice(0, 80)) body.append(h("div", { class: "issue" }, `${ymLabel(this.sim.startYear, e.month)} ${e.text}`, h("br"), h("small", {}, `原因: ${e.cause}`)));
  }
  private buildRoadList(body: HTMLElement) {
    body.append(h("h3", {}, "路線一覧")); const sim = this.sim; if (!sim) return;
    const km = (r: typeof sim.routes[string]) => Math.round(r.edges.reduce((a, x) => a + (sim.edges[x.edgeId]?.lengthKm ?? 0), 0));
    for (const r of Object.values(sim.routes).filter((x) => x.active).sort((a, b) => (a.grade === b.grade ? a.number - b.number : a.grade === "national" ? -1 : 1))) {
      const es = r.edges.map((x) => sim.edges[x.edgeId]), q = Math.round(es.reduce((a, e) => a + e.quality, 0) / (es.length || 1));
      body.append(h("div", { class: "issue" }, `${routeLabel(r)} ${km(r)}km 品質${q}${r.oldEdges.length ? ` 旧道${r.oldEdges.length}` : ""} ${es.some((e) => e.lost) ? "(廃道あり)" : ""}`, h("br"), h("small", {}, `路線ID ${r.id} / 指定${ymLabel(sim.startYear, r.since)}`)));
    }
    body.append(h("h3", {}, "建設計画・未成線"));
    for (const p of Object.values(sim.projects).filter((x) => x.status !== "open").slice(-30)) body.append(h("div", { class: "issue warn" }, `[${PROJECT_LABEL[p.status]}/${KIND_LABEL[p.kind]}/${prefName(p.region)}] ${sim.nodes[p.from]?.name ?? "地点"}〜${sim.nodes[p.to]?.name ?? "地点"} (${Math.round((p.spentBu / (p.costBu || 1)) * 100)}%)`, h("br"), h("small", {}, p.reason)));
  }
  private buildLegend(body: HTMLElement) {
    if (this.real) {
      const det = h("details", { id: "legend-ops", ...(this.legendOpen ? { open: "" } : {}) }, h("summary", {}, "表示の切替(地図に即反映・保存されます)")) as HTMLDetailsElement;
      det.addEventListener("toggle", () => { this.legendOpen = det.open; this.saveUi(); });
      const chk = (id: string, label: string, on: boolean, fn: (v: boolean) => void) => h("label", { class: "layer" }, h("input", { type: "checkbox", id, checked: on, onchange: (e: Event) => fn((e.target as HTMLInputElement).checked) }), label);
      const grp = (title: string, items: HTMLElement[]) => det.append(h("div", { class: "legend-group" }, h("b", {}, title), ...items));
      grp("種類", [chk("lg-roads", "道路", this.s.layers.roads, (v) => this.store.set((s) => { s.layers.roads = v; })), chk("lg-rail", "鉄道", this.s.layers.rail, (v) => this.store.set((s) => { s.layers.rail = v; })), chk("lg-names", "路線名の文字", this.names, (v) => { this.names = v; this.saveUi(); this.renderRoads(); })]);
      const G: [string, string][] = [["national", "国道"], ["fu", "府県道(府道)"], ["ken", "県道"], ["jnr", "国鉄"], ["priv", "私鉄"], ["none", "指定なし"]];
      grp("規格・行政区分", G.map(([k, l]) => { const key = (k === "jnr" || k === "priv") ? `g:${k}:rail` : `g:${k}:road`; return chk("lg-g-" + k, l, !this.hide.has(key), () => this.toggleHide(key)); }));
      const ST: [string, string][] = [["open", "供用中"], ["building", "工事中"], ["planned", "計画"], ["unbuilt", "未成"], ["closed", "廃止(閉鎖)"], ["lost", "廃道・遺構"], ["dormant", "休止"]];
      grp("状態", ST.map(([k, l]) => chk("lg-s-" + k, l, !this.hide.has("st:" + k), () => this.toggleHide("st:" + k))));
      body.append(det);
    }
    body.append(h("h3", {}, "凡例(色だけに頼らず、線の種類と文字で区別します)"));
    const row = (svg: string, text: string) => { const d = h("div", { class: "legend-row" }); d.innerHTML = `<svg width="64" height="14" viewBox="0 0 64 14" aria-hidden="true">${svg}</svg><span>${text}</span>`; body.append(d); };
    const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");
    body.append(h("h3", {}, "色=現在の状態(品質)"));
    for (const c of COND) row(`<line x1="2" y1="7" x2="62" y2="7" stroke="${hex(c.col)}" stroke-width="5" stroke-linecap="round"/>`, `${c.label}(品質${c.min}以上${c.label === "荒廃" ? "〜" : ""})`);
    body.append(h("h3", {}, "線の種類=供用状態"));
    row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#ffe14a" stroke-width="5" stroke-linecap="round"/>`, "実線: 供用中");
    row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#ffe14a" stroke-width="4" stroke-dasharray="10 6"/>`, "長い破線: 休止(需要がほぼゼロ)");
    row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#9aa4ad" stroke-width="2" stroke-dasharray="5 4"/>`, "灰色の破線: 閉鎖");
    row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#2b2b2b" stroke-width="2" stroke-dasharray="2 5"/>`, "極細の点線: 廃道");
    row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#ffe14a" stroke-width="4" stroke-dasharray="9 3 2 3"/>`, "一点鎖線: 旧道(バイパスができた区間)");
    row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#5bd66b" stroke-width="5"/><line x1="2" y1="7" x2="62" y2="7" stroke="#fff" stroke-width="1"/>`, "白い中心線: バイパス・新道");
    body.append(h("h3", {}, "太さ=規格 / 縁の色=行政指定"));
    row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#bbb" stroke-width="2"/>`, `細い: ${STANDARD_LABEL.rural}`); row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#bbb" stroke-width="4"/>`, `中: ${STANDARD_LABEL.standard}`); row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#bbb" stroke-width="7"/>`, `太い: ${STANDARD_LABEL.highgrade}`);
    row(`<line x1="2" y1="7" x2="62" y2="7" stroke="${hex(CASING.national)}" stroke-width="8"/><line x1="2" y1="7" x2="62" y2="7" stroke="#ffe14a" stroke-width="4"/>`, "赤茶の縁: 国道"); row(`<line x1="2" y1="7" x2="62" y2="7" stroke="${hex(CASING.ken)}" stroke-width="8"/><line x1="2" y1="7" x2="62" y2="7" stroke="#ffe14a" stroke-width="4"/>`, "緑の縁: 県道"); row(`<line x1="2" y1="7" x2="62" y2="7" stroke="${hex(CASING.fu)}" stroke-width="8"/><line x1="2" y1="7" x2="62" y2="7" stroke="#ffe14a" stroke-width="4"/>`, "紫の縁: 府道"); row(`<line x1="2" y1="7" x2="62" y2="7" stroke="${hex(CASING.none)}" stroke-width="6"/><line x1="2" y1="7" x2="62" y2="7" stroke="#ffe14a" stroke-width="3"/>`, "灰の縁・細め: 市町村道(指定なし)");
    body.append(h("h3", {}, "建設計画"));
    row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#39d6c8" stroke-width="3" stroke-dasharray="2 4"/>`, "水色の点線: 計画"); row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#3aa0ff" stroke-width="3" stroke-dasharray="7 4"/>`, "青の破線: 工事中"); row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#ff8f1f" stroke-width="3" stroke-dasharray="7 4"/>`, "橙の破線: 中断"); row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#b04bff" stroke-width="3" stroke-dasharray="7 4"/>`, "紫の破線: 未成線");
    body.append(h("h3", {}, "比較表示の縁取り"));
    row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#ff3b3b" stroke-width="8" stroke-opacity=".6"/>`, "赤: 品質が大きく低下"); row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#111" stroke-width="8" stroke-opacity=".6"/>`, "黒: 休止・閉鎖・廃道に悪化"); row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#39a0ff" stroke-width="8" stroke-opacity=".6"/>`, "青: 基準年にはなかった道路"); row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#39e08a" stroke-width="8" stroke-opacity=".6"/>`, "緑: 改善・復旧");
    if (this.real) {
      body.append(h("h3", {}, "鉄道(紺の線＋白い点線)"));
      row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#fff" stroke-width="6"/><line x1="2" y1="7" x2="62" y2="7" stroke="#12284d" stroke-width="3.5"/><line x1="2" y1="7" x2="62" y2="7" stroke="#fff" stroke-width="2.5" stroke-dasharray="4 5"/>`, "紺: 供用中(状態が悪いほど灰色に近づく)");
      row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#12284d" stroke-width="6"/><line x1="2" y1="7" x2="62" y2="7" stroke="#ffd23a" stroke-width="1.5"/>`, "太い紺＋黄の中心線: 高速新線・高規格化");
      row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#3a4f78" stroke-width="3.5" stroke-dasharray="10 6"/>`, "紺の長い破線: 運休(利用がほぼゼロ)");
      row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#9aa4ad" stroke-width="2" stroke-dasharray="5 4"/>`, "灰色の破線: 廃止 ／ 極細の点線: 廃線跡");
      body.append(h("small", {}, "鉄道の標識: 紺の四角=国鉄「鉄N」、白地に枠=私鉄(事業者名の頭文字＋番号)。通称「酷鉄」(国鉄)・「死鉄」(私鉄)は、利用が少なく保守が行き届かない線に後から付く呼び名で、正式名称ではありません。"));
      body.append(h("small", {}, "青い四角=港(沿岸の都市)、白い十字=空港(開港後)。港と空港は補助的な役割で、貨物と長距離旅客の一部を引き受けます。"));
    }
    body.append(h("small", {}, "標識: 国=丸(赤)・県=角丸(緑)・府=五角形(紫)。通称(酷・険・腐)は荒れた細い道に後から付く呼び名で、行政指定ではありません。"));
  }
  private buildCompare(body: HTMLElement) {
    body.append(h("h3", {}, "時系列比較(基準年と今の差を縁取り)")); const sim = this.sim; if (!sim) return;
    const row = h("div", { class: "row" }); row.append(h("button", { id: "cmp-none", "aria-pressed": this.compareYear ? "false" : "true", class: this.compareYear ? "mode" : "mode on", onclick: () => { this.compareYear = null; this.renderRoads(); this.buildUI(); } }, this.compareYear ? "比較しない" : "✓ 比較しない"));
    for (const sn of sim.snaps) row.append(h("button", { id: `cmp-${sn.year}`, "aria-pressed": this.compareYear === sn.year ? "true" : "false", class: this.compareYear === sn.year ? "mode on" : "mode", onclick: () => { this.compareYear = sn.year; this.renderRoads(); this.buildUI(); } }, `${this.compareYear === sn.year ? "✓ " : ""}${sn.year}年と比べる`));
    body.append(row, h("small", {}, "基準年は10年ごとに自動保存されます。色の意味は「凡例」を見てください。"));
  }
  private buildWhy(body: HTMLElement) {
    const sim = this.sim, w = this.world; body.append(h("h3", {}, "この道路は、なぜ今こうなのか")); if (!sim || !w || !this.selEdge || !sim.edges[this.selEdge]) { body.append(h("small", {}, "「なぜ?」を選び、道路をタップしてください")); return; }
    const e = sim.edges[this.selEdge], nm = (id: string) => sim.nodes[id]?.name ?? "地点", routes = Object.values(sim.routes).filter((r) => r.active && (r.edges.some((x) => x.edgeId === e.id) || r.oldEdges.includes(e.id)));
    const line = (t: string, id?: string) => body.append(h("div", { class: "issue", id }, t));
    line(`${nm(e.a)}〜${nm(e.b)}(${Math.round(e.lengthKm)}km・${prefName(e.region)})`, "why-title");
    line(`行政指定: ${routes.length ? routes.map((r) => routeOfficial(r) + (r.oldEdges.includes(e.id) ? "の旧道" : "")).join("・") : "市町村道(指定なし)"}${e.nick && routes[0] ? ` ／ 通称: ${NICK_LABEL[routes[0].grade]}(細く荒れた道に後から付いた呼び名)` : ""}`, "why-designation");
    const rail = e.mode === "rail", unit = rail ? "人/日" : "台/日";
    if (rail) line(`事業者: ${sim.operators[e.op ?? "jnr"]?.name ?? "国鉄"}${e.nick ? " ／ 通称: " + (e.op === "jnr" ? "酷鉄" : "死鉄") + "(利用が少なく保守が行き届かない線に後から付く呼び名)" : ""}`, "why-operator");
    line(`規格: ${rail ? STANDARD_LABEL_RAIL[e.standard] : STANDARD_LABEL[e.standard]}${rail ? "" : ` ／ 路面: ${SURFACE_LABEL[e.surface]}`} ／ 品質${Math.round(e.quality)}・${rail ? "荒廃" : "風化"}${Math.round(e.weathering)}・最大勾配${e.maxGradePct}%${e.curv ? `・曲がり${e.curv}rad/km` : ""}${e.facility ? ` ／ 施設: ${e.facilityName ? displayName(e) : ""}(${e.facility === "tunnel" ? "トンネル" : "橋"})` : ""}`);
    line(`状態: ${e.built < 1 ? `工事中(${Math.round(e.built * 100)}%)` : STATE_LABEL[e.state]}${e.builtMonth !== null ? ` ／ 供用${monthToYM(sim.startYear, e.builtMonth).year}年〜` : ""}`, "why-state");
    line(`需要(${unit}): 旅客の通過${Math.round(e.through)}・沿線${Math.round(e.local)}${sim.stage3 ? ` ／ 貨物${Math.round(e.freight)}` : ""} ／ 通過のピーク${Math.round(e.peakThrough)} ／ 需要ゼロ${e.zeroYears}年`, "why-demand");
    if (e.bypassedBy.length) line(`旧道: ${e.bypassedBy.map((id) => `${nm(sim.edges[id]?.a)}〜${nm(sim.edges[id]?.b)}`).join("、")}のバイパス開通で通過交通が移った。沿線需要${Math.round(e.local)}台/日${e.local >= 40 ? "が残るため管理継続" : "は小さい"}`, "why-old");
    if (e.bypassOf.length) line("バイパス・新道: 旧道の通過交通を引き受けている", "why-new");
    body.append(h("h3", {}, "この道路の履歴(永続記録)"));
    for (const hh of [...e.hist].reverse()) body.append(h("div", { class: "issue" }, `${ymLabel(sim.startYear, hh.m)} ${hh.t}`));
    const evs = sim.events.filter((x) => x.refs.edge === e.id).slice(-6).reverse(); if (evs.length) { body.append(h("h3", {}, "関連する年表の出来事")); for (const x of evs) body.append(h("div", { class: "issue" }, `${ymLabel(sim.startYear, x.month)} ${x.text}`, h("br"), h("small", {}, `原因: ${x.cause}`))); }
  }
  private buildScenery(body: HTMLElement) {
    body.append(h("h3", {}, "風景用JSON")); if (!this.scenery) { body.append(h("small", {}, "「風景JSON」を選び、地図上の地点をタップしてください")); return; }
    const txt = JSON.stringify(this.scenery, null, 1);
    body.append(h("pre", { id: "scenery-json", style: "white-space:pre-wrap;font-size:11px;max-height:34dvh;overflow:auto" }, txt),
      h("div", { class: "row" }, h("button", { onclick: async () => { try { await navigator.clipboard.writeText(txt); this.toast("コピーしました"); } catch { this.toast("コピーできません"); } } }, "コピー"),
        h("button", { onclick: () => this.download(txt, "kfm-scenery.json") }, "保存")));
  }
  private download(text: string, name: string) { const a = h("a", { href: URL.createObjectURL(new Blob([text], { type: "application/json" })), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
  async buildMenu(body: HTMLElement) {
    if (this.real) {
      body.append(h("h3", {}, "このゲームについて(史実と架空の区別)"));
      body.append(h("div", { class: "issue", id: "about-data" }, h("b", {}, "実在: "), "海岸線・標高・河川・府県・都市の位置(東京府、北海道は3県の設定)。鉄道・道路の通り道(Natural Earth)は初期網の参考。", h("br"),
        h("b", {}, "再構成: "), "1950年の道路網・鉄道網。実在の路線台帳ではありません。", h("br"),
        h("b", {}, "史実: "), "平成の世界線の国内の出来事(2026年まで)と、全世界線共通の国際事件。年表に【史実】と付きます。", h("br"),
        h("b", {}, "架空: "), "修文・正化の国内の出来事、人口・需要・予算・事業者名・路線番号。【架空】と付きます。2027年以降は【予測モデル】です。"));
    }
    body.append(h("h3", {}, "セーブ / ロード / 出力"));
    const pfx = this.real ? "s3:" : "", slots = [1, 2, 3, 4, 5].map((i) => `${pfx}slot${i}`), have = new Set(await listSlots());
    for (const n of slots) body.append(h("div", { class: "row" }, `${n.replace(/^s3:/, "").replace("slot", "スロット")}${have.has(n) ? " (使用中)" : ""}`,
      h("button", { onclick: async () => this.toast((await saveGame(n, makeSave(this.s, this.sim ?? this.pendingSim))) ? "セーブしました" : "セーブできません(ブラウザの保存が無効)") }, "セーブ"),
      h("button", { disabled: !have.has(n), onclick: async () => { const l = await loadGame(n); if (l) this.adopt(l); else this.toast("ロードできません"); } }, "ロード")));
    body.append(h("div", { class: "row" },
      h("button", { id: "export", onclick: () => this.exportFile() }, "JSONエクスポート"),
      h("label", {}, "JSON読込 ", h("input", { type: "file", accept: ".json,application/json", id: "import", onchange: async (e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return; const p = parseSave(await f.text()); if (!p.ok) { this.toast("読み込めません: " + p.problems[0]); return; } this.adopt(p); } }))));
    if (this.s.finalized) body.append(h("div", { class: "row" }, this.real ? "" : h("button", { id: "unlock-menu", onclick: () => this.unlockMap() }, "地図のロックを解除して編集"), this.sim ? h("button", { id: "restart-roads", onclick: () => { if (confirm("道路を消して開通の儀からやり直します(地図は維持)。よろしいですか?")) { this.sim = null; this.cerDraft = {}; this.persist(); this.viewYear = null; this.go(6); this.onChange(); } } }, "道路だけやり直す") : h("small", {}, "")));
    if (this.stepId === "confirm") {
      const errs = this.issues.filter((i) => i.severity === "error").length, ready = errs === 0 && !!this.terrain;
      body.append(h("h3", {}, "最終確定"));
      body.append(h("div", { class: "row" }, h("button", { id: "finalize", disabled: !ready, onclick: () => this.finalize() }, this.s.finalized ? "確定済み(再確定)" : "この地図を最終確定"), h("small", {}, ready ? "確定すると地理IDと座標変換APIが固定されます" : errs ? "不正を直してください" : "地形生成の完了を待ってください")));
      if (this.terrain) { const t = this.terrain.stats; body.append(h("small", {}, `陸地${t.landCells}セル / 河川${t.riverCount}本 / 府県${t.prefCount} / 都市補正${t.citiesMoved} / hash ${this.terrain.hash}`)); }
    }
    body.append(h("div", { class: "row" }, h("button", { id: "reset", onclick: () => { if (confirm("初期状態に戻します。よろしいですか?")) { this.sim = null; this.pendingSim = null; this.cerDraft = {}; this.store.replace(this.real ? realState(this.s.seed) : defaultState(this.s.seed)); this.r.fit(this.s); } } }, "最初からやり直す")));
  }
  /** Load a parsed save (slot or file): map first, then roads only if they verify against the regenerated terrain. */
  private adopt(l: { map: any; sim: SimState | null; quarantine: unknown; problems: string[] }) {
    // the two games keep separate data: a file from the other one is refused rather than half-loaded
    if (this.real !== !!l.map?.real) { this.toast(this.real ? "旧版(架空の日本列島)のデータです。URLの末尾に ?legacy=1 を付けた旧版で開いてください" : "実在の日本版のデータです。?legacy=1 を付けない通常のURLで開いてください"); return; }
    this.sim = null; this.cerDraft = {}; this.pin = null; this.store.replace(l.map); this.pendingSim = l.sim; this.r.fit(l.map);
    if (l.quarantine) putRaw(this.saveKey + ":quarantine", { savedAt: Date.now(), quarantine: l.quarantine });
    this.toast("読み込みました" + (l.problems.length ? `(${l.problems[0]})` : "")); this.onChange();
  }
  finalize() {
    if (!this.terrain || this.issues.some((i) => i.severity === "error")) return;
    this.store.set((s) => { s.finalized = true; }); this.persist(); this.toast("最終確定しました。JSONエクスポートで書き出せます");
  }
  exportFile() {
    const geo = this.s.finalized && this.terrain ? new GeoMap(this.s, this.terrain).summary() : undefined;
    const blob = new Blob([exportGame(makeSave(this.s, this.sim), { geo })], { type: "application/json" });
    const a = h("a", { href: URL.createObjectURL(blob), download: this.s.finalized ? "kfm-map-final.json" : "kfm-map-draft.json" });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
}
export { tOf };
