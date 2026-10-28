import { buildIndex } from "../sim/network";
import { adoptWorld, apply2200, close2200, waiting2200, type Choice2200 } from "../sim/event2200";
import { buildE2200, e22Draft } from "./e2200";
import { nearestPlace } from "../core/gazetteer";
import { movesOfSettings, type SeatMove } from "../sim/seatmove20";
import { realToWorld, worldToPostOps, worldParts } from "../core/body";
import { axisFrame, tOf } from "../core/constraints";
import { ISLAND_LABEL, JAPAN, lonLatToReal, realToLonLat } from "../core/data";
import { FEATURE_LIMITS } from "../core/save";
import { PREF_IDS, prefOfSeat, palaceWorld, prefName as seatPrefName, prefPoint, seatsOf } from "../core/seat";
import { dist, pointInPolygon, pointSegDist, rot as rotv, simplifyLine } from "../core/geom";
import { exportGame, getRaw, idbCpStore, listSlots, slotMeta, loadGame, makeSave, mapStateHash, parseSave, putRaw, saveGame, validateSimAgainstWorld } from "../core/save2";
import { checkpointDue, listCheckpoints, markCheckpoint, readCheckpoint, writeCheckpoint, type CpEntry } from "../sim/checkpoint";
import { Store, featureWorldPos, LAYER_KEYS, LAYER_LABELS, ROAD_LAYER_KEYS, defaultState, realState } from "../core/state";
import { suggestRidge } from "../core/suggest";
import type { TerrainResult } from "../core/terrain";
import { TerrainClient } from "../core/terrainClient";
import { GeoMap } from "../core/geoid";
import { STEPS, STEP_LABELS, type IslandId, type Issue, type Op, type Place, type StepId, type Vec } from "../core/types";
import { clampOp } from "../core/warp";
import { derive, errorsFor, featureScales, featureWorld, fujiHeightFactor, validate } from "../core/validate";
import { Renderer, type Pending } from "../render/renderer";
import { attachGestures } from "./gestures";
import { CER_LABEL, cerLabel, homeCity, performCeremony, performNational, previewCeremony, previewNational, performRoad0, snapKmFor, seatCity, subCity, tokyoCity, type NatPreview, type CerKind, type CerPreview } from "../sim/ceremony";
import { MS_PER_MONTH_X1, advance, createSimGen, noteSkipped, settleKaigen, planCatchUp, prefName, routeLabel, routeOfficial, summary } from "../sim/engine";
import { exportScenery } from "../sim/scenery";
import { displayName } from "../sim/straits";
import { finishMigration } from "../sim/migrate";
import { SimRunner } from "../sim/runner";
import { ERA, GRADE_LABEL, KIND_LABEL, NICK_LABEL, PROJECT_LABEL, STANDARD_LABEL, STANDARD_LABEL_RAIL, STATE_LABEL, SURFACE_LABEL, eraLabel, monthToYM, setActiveEra, setActiveTimeline, ymLabel, type SimState } from "../sim/types";
import { COND, CASING } from "../render/roads";
import { edgePoints } from "../sim/network";
import { buildWorld, townsForSeats, type World } from "../sim/world";
import { eraKeyOf, type EraKey } from "../sim/eras";
import { buildAtlas, buildKaigen, buildLedger, buildPolicy, buildTimeline, eraDescText, eraRadioGroups } from "./stage3";
import { prefSelect } from "./prefSelect";
import { ui3 } from "./stage3";
import { buildLegendStrip } from "./legend24";
import { fitView, hlBounds, type HlTarget } from "./lines23";
import { closeRadio, showRadio } from "./radioWin";
import { CAND_1945 } from "../sim/kaigen";

type Tool = "view" | "seatpick" | "pull" | "bulge" | "dent" | "move" | "feature" | "ridge-sw" | "ridge-ne" | "ridge-edit" | "ridge-pick" | "cer-kokudo1" | "cer-fudo1" | "cer-kokudo0" | "pick" | "why";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const pathLen = (p: Vec[]) => { let s = 0; for (let i = 1; i < p.length; i++) s += dist(p[i - 1], p[i]); return s; };
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k.startsWith("on") && typeof v === "function") (e as any)[k] = v; else if (k === "class") e.className = v; else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : String(v)); }
  for (const k of kids) e.append(k);
  return e;
}
const ROT_STEP = Math.PI / 36; // 5 degrees
/** A 国道1号 being drawn: its strokes (each simplified to control points), and the history of edits as whole snapshots (Undo/Redo). */
interface CerDraft { pts: Vec[]; prev: CerPreview; strokes: Vec[][]; past: Vec[][][]; redo: Vec[][][] }
/** Stage 9: a drawn stroke is kept as control points at most this far apart (km of world), so each can be grabbed and moved. */
const CER_SIMPLIFY_KM = 6, CER_MAX_GAP_KM = 30;
function toControlPoints(pts: Vec[]): Vec[] {
  const out = simplifyLine(pts, CER_SIMPLIFY_KM), dense: Vec[] = [out[0]];
  for (let i = 1; i < out.length; i++) { const a = out[i - 1], b = out[i], n = Math.max(1, Math.ceil(dist(a, b) / CER_MAX_GAP_KM)); for (let k = 1; k <= n; k++) dense.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]); }
  return dense;
}
/** Stage 11: set a feature's two sizes (x along its own axis, y along the other); equal sizes are stored as the single `scale`, and 1 x 1 as nothing at all, exactly as older saves. */
export function setFeatureSize(f: { scale?: number; scaleY?: number }, kx: number, ky: number) { if (kx === 1 && ky === 1) { delete f.scale; delete f.scaleY; return; } f.scale = kx; if (ky === kx) delete f.scaleY; else f.scaleY = ky; }
const stateKey = (s: Store["state"]) => JSON.stringify([s.seed, s.bodies, s.features, s.ridges, s.ridgeExtra ?? null, s.islands ? 1 : 0, ...(s.alpsRemoved ? [s.alpsRemoved] : [])]);
/** Stage 11: the four range tools: draw north / south, move points, select a stroke (区間). */
const isRidgeTool = (t: string) => t === "ridge-ne" || t === "ridge-sw" || t === "ridge-edit" || t === "ridge-pick";
/** Stage 11: remove one stroke of a range (0 = the first: the next one takes its place). */
function removeRidgeStroke(s: Store["state"], key: "sw" | "ne", si: number) {
  if (si === 0) { const ex = s.ridgeExtra?.[key] ?? []; s.ridges[key] = ex.length ? ex.shift()! : null; } else if (s.ridgeExtra) s.ridgeExtra[key].splice(si - 1, 1);
  if (s.ridgeExtra && !s.ridgeExtra.sw.length && !s.ridgeExtra.ne.length) delete s.ridgeExtra;
}
/** Stage 9: how close (screen px) a finger must come to a range's end to continue it, or to a point to grab it -- a fingertip, not a mouse pointer. */
const RIDGE_TOUCH_PX = 40;
/** Stage 9: write one stroke of a range: 0 = the first, -1 = a new one appended, n = the n-th added. */
function setRidgeStroke(s: Store["state"], key: "sw" | "ne", si: number, line: Vec[]) {
  if (si === 0 || (si < 0 && !s.ridges[key])) { s.ridges[key] = line; return; }
  const ex = (s.ridgeExtra ??= { sw: [], ne: [] }); if (si < 0) ex[key].push(line); else ex[key][si - 1] = line;
}

export class App {
  store = new Store(); r!: Renderer;
  terrain: TerrainResult | null = null; terrainKey = ""; generating = false; genProgress = 0; private genTok = 0;
  issues: Issue[] = []; tool: Tool = "view"; activeBody: IslandId = "honshu"; selFeature: "biwa" | "fuji" = "biwa";
  brushKm = 160; pending: Pending | null = null; sheet: string | null = null;
  client = new TerrainClient(new URL(import.meta.env.BASE_URL + "japan-dem.bin", document.baseURI).href, () => new Worker(new URL("../core/terrain.worker.ts", import.meta.url), { type: "module" }));
  private genTimer: any = 0; private saveTimer: any = 0; private grab: any = null;
  // ---- Stage 2 ----
  sim: SimState | null = null; world: World | null = null; private worldRef: TerrainResult | null = null; private worldKey = ""; pendingSim: SimState | null = null;
  cerDraft: Partial<Record<CerKind, CerDraft>> = {};
  /** Stage 9: how the 国道1号 tool acts -- draw a stroke, move a control point, or pick a stroke (then delete or redraw it). */
  axesOpen = false; ridgeSel: { key: "sw" | "ne"; si: number } | null = null; ridgeRedraw: { key: "sw" | "ne"; si: number } | null = null; bgBeforeRidge: "terrain" | "roadmap" | null = null;
  cerMode: "draw" | "move" | "pick" = "draw"; cerSel: number | null = null; cerRedraw: number | null = null; private cerLive: Vec[] | null = null; pin: Vec | null = null; scenery: any = null;
  selEdge: string | null = null;
  /** Stage 3: the era chosen before the ceremony, the year being looked at (null = now, time running), and the background map. */
  lite = false; private slowTicks = 0;
  eraChoice: EraKey = "heisei"; firstEra = 0; editOpen = false; editMore = false; bg: "terrain" | "roadmap" = "terrain"; hide = new Set<string>(); names = false; legendOpen = true;
  runner: SimRunner | null = null; building = 0; safeMode = false; behind = false; private lastRoads = 0;
  private lastBackup = 0; private lastSaved = 0; private persistRetry = 0; catching = false; catchInfo = ""; private acc = 0; private lastTick = 0; private hiddenAt = 0; private lastPersist = 0; private lastHud = 0;

  /** Stage 3 plays on the real Japan; the old hand-edited-map flow stays reachable with ?legacy=1 and keeps its own save key. */
  /** Set when a stored save existed but its road data could not be attached: autosave must not overwrite it with an empty state. */
  private saveLocked = false; private prevCopied = false;
  real = false; get saveKey() { return this.real ? "s3:auto" : "auto"; }
  static async start(host: HTMLElement, real = false) {
    const a = new App(); a.real = real; a.r = await Renderer.create(host);
    if (real) { a.store.replace(realState()); document.body.classList.add("real"); try { if (localStorage.getItem("kfm.bg") !== "terrain") { a.bg = "roadmap"; a.r.setBg("roadmap"); }   /* default: road map */
      try { const u = JSON.parse(localStorage.getItem("kfm.ui") || "{}"); if (Array.isArray(u.hide)) a.hide = new Set(u.hide.filter((x: unknown) => typeof x === "string")); a.names = u.names === true; a.legendOpen = u.legendOpen !== false; a.legendShown = u.legendShown === true; a.legendSide = u.legendSide === "left" ? "left" : "right"; } catch { /* ignore */ } a.lite = localStorage.getItem("kfm.lite") === "1"; } catch { /* ignore */ } }
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
    if (this.real && !this.sim && !this.pendingSim && this.repairFeatures()) return;   // a map saved in an invalid state (Issue #20) is put right before anything else
    const key = stateKey(this.s);
    if (key !== this.terrainKey) { this.terrain = null; this.terrainKey = ""; if (this.generating) { this.client.cancel(); this.generating = false; } }
    if ((this.s.step >= 4 || this.pendingSim) && !this.terrain && !this.generating) { clearTimeout(this.genTimer); this.genTimer = setTimeout(() => this.generate(), initial ? 0 : 250); }
    this.render(); this.buildUI();
    clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.persist(), 400);
  }
  /**
   * Issue #20: a save written while a lake or a mountain stood where it cannot (before the edit guard existed) would wait for its terrain for ever. Only the offending
   * feature is put back where it really is (its position, rotation and size); everything else in the save stays as it was. Returns true when it changed something.
   */
  repairFeatures(): boolean {
    const errs = this.issues.filter((i) => i.severity === "error" && i.step === "features" && /^(biwa|fuji|features)\./.test(i.code)); if (!errs.length) return false;
    const which = new Set<"biwa" | "fuji">(); for (const e of errs) { if (e.code.startsWith("biwa")) which.add("biwa"); else if (e.code.startsWith("fuji")) which.add("fuji"); else { which.add("biwa"); which.add("fuji"); } }
    const fix = (s: Store["state"], set: Set<"biwa" | "fuji">) => { for (const f of set) s.features[f] = { pos: null, rot: 0 }; };
    const cand = JSON.parse(JSON.stringify(this.s)) as Store["state"]; fix(cand, which);
    if (validate(cand).some((i) => i.severity === "error" && i.step === "features" && /^(biwa|fuji|features)\./.test(i.code))) which.add("biwa").add("fuji");
    this.store.set((s) => fix(s, which)); this.toast(`置けない位置にあった${[...which].map((f) => (f === "biwa" ? "琵琶湖" : "富士山")).join("・")}を元の位置に戻しました`); return true;
  }
  render() { if (!isRidgeTool(this.tool) && this.bgBeforeRidge) { const b0 = this.bgBeforeRidge; this.bgBeforeRidge = null; this.bg = b0; this.r.setBg(b0); }   // leaving the range tools by any route puts the map back
    if (this.real && this.s.bg && this.s.bg !== this.bg && !this.bgBeforeRidge) { this.bg = this.s.bg; this.r.setBg(this.bg); }   // a loaded game brings its own map choice
    this.r.featureSel = this.tool === "feature" && this.editable() ? this.selFeature : null; this.r.ridgeHandles = isRidgeTool(this.tool); this.r.ridgeSel = this.tool === "ridge-pick" ? this.ridgeSel : null; { const wi = this.real && this.terrain ? this.ensureWorld()?.islets : undefined; { const w0 = this.real && this.terrain ? this.world : null, st0 = this.activeSeats(), seat = new Set([st0.capital, st0.sub, st0.palace]); this.r.seatOverride = this.sim?.e2200 && w0 ? this.seatPoints(w0) : null; this.r.baseNames = w0 ? w0.cities.filter((c) => c.kind === "capital").sort((a, b) => (seat.has(b.pref ?? "") ? 1 : 0) - (seat.has(a.pref ?? "") ? 1 : 0) || b.pop0 - a.pop0).map((c) => ({ name: c.name, p: c.pos })) : null; } this.r.islets = wi && this.isletsWanted() ? wi.filter((x) => !x.existing).map((x) => ({ pos: x.pos, len: x.islet.len, wid: x.islet.wid, bear: x.islet.bear, name: x.islet.name, claim: !!x.islet.claim, shaped: !!x.islet.shape, tiny: (x.islet.shapeAreaKm2 ?? x.islet.area) < 1 })) : null; } this.r.update(this.s, this.terrain, this.issues, this.pending); this.renderRoads(); }
  markClean() { try { localStorage.removeItem("kfm.run"); } catch { /* ignore */ } }
  /** Saves only between simulated months (never a half-finished one). `force` finishes the month first (the page is going away). */
  persist(force = false): Promise<boolean> {
    // Saves only between months. While the clock is busy, wait for a gap (one retry timer at a time, never a growing pile of them);
    // if none comes for 30 s (×20 never goes idle), finish the month in progress and save anyway so progress is never lost.
    if (this.runner && !this.runner.idle) {
      if (!force) { if (performance.now() - this.lastSaved >= 30000) this.runner.hold = true; if (!this.persistRetry) this.persistRetry = window.setTimeout(() => { this.persistRetry = 0; void this.persist(); }, 120); return Promise.resolve(false); }   // Stage 22: past 30 s the clock finishes its month in its own slices and waits (finishing it here in one go held the screen for seconds when that month was a January)
      this.runner.settle();
    }
    if (this.runner) this.runner.hold = false;
    this.lastSaved = performance.now();
    if (!this.prevCopied) { this.prevCopied = true; void getRaw(this.saveKey).then((raw) => { if (raw) { try { return putRaw(this.saveKey + ":prev", JSON.parse(raw)); } catch { return putRaw(this.saveKey + ":prev", { raw }); } } }).catch(() => { /* ignore */ }); }
    if (this.saveLocked && !this.sim && !this.pendingSim) return Promise.resolve(false);
    if (this.sim) this.sim.lastWallMs = Date.now(); this.lastPersist = performance.now();
    if (this.real && this.sim && performance.now() - this.lastBackup > 120000) { this.lastBackup = performance.now(); void saveGame(this.saveKey + ":backup", makeSave(this.s, this.sim)); }   /* a second copy every two minutes; a sim still waiting for its terrain is kept in the save, never dropped */ return saveGame(this.saveKey, makeSave(this.s, this.sim ?? this.pendingSim)); }
  /** The towns a world carries: a running or loaded game keeps the ones it was started with (none for an older game); a game not yet started takes the towns around its two seats. */
  private townIdsWanted(): string[] | false {
    const sim = this.sim ?? this.pendingSim; if (sim) return sim.towns16 ?? false;
    if (!this.real || !this.terrain) return false; const st = seatsOf(this.s); const ids = townsForSeats(this.terrain, [st.capital, st.sub]); return ids.length ? ids : false;
  }
  /** Stage 20: a running or loaded game keeps the grid it was started with (an older game has no islets); a game not yet started takes the islands. */
  /** Stage 20: the seat points that make a new 県庁所在地 (a game under way keeps the ones it started with; an older game has none). */
  private movesWanted(): SeatMove[] { const sim = this.sim ?? this.pendingSim; if (sim) return (sim.isl20 ? sim.moves20 : undefined) ?? []; return this.real ? movesOfSettings(seatsOf(this.s), this.s) : []; }
  private isletsWanted(): 0 | 1 | 2 { const sim = this.sim ?? this.pendingSim; return sim ? (sim.isl22 ? 2 : sim.isl20 ? 1 : 0) : this.real ? 2 : 0; }   // Stage 22: a new game gets the real outlines; a Stage 20 game keeps its ellipses
  ensureWorld(): World | null {
    if (!this.terrain) return null; const ids = this.townIdsWanted(), isl = this.isletsWanted(), mv = this.movesWanted(), key = (ids ? ids.join(",") : "") + (isl ? "+isl" + isl : "") + (mv.length ? "+" + JSON.stringify(mv) : "");
    if (this.worldRef !== this.terrain || this.worldKey !== key) { this.world = buildWorld(this.terrain, this.s.seed, ids, isl || false, mv); this.world.barrier = !!this.real; this.worldRef = this.terrain; this.worldKey = key; }
    return this.world;
  }
  renderRoads() {
    { const co = !this.sim || !!this.sim.pot17; if (this.r.capitalsOnly !== co) { this.r.capitalsOnly = co; this.render(); } }   // Stage 18: the base map names only the capitals in a Stage 17 game
    const w0 = this.world, cerTool = this.tool === "cer-kokudo1" || this.tool === "cer-fudo1" || this.tool === "cer-kokudo0", cer = (["kokudo1", "fudo1", "kokudo0"] as CerKind[]).map((k) => this.cerDraft[k]).filter(Boolean).map((d) => ({ strokes: d!.strokes, handles: cerTool && this.cerMode !== "draw", sel: cerTool ? this.cerSel : null, pts: d!.pts, path: d!.prev.path, ok: d!.prev.ok, segs: (d!.prev as NatPreview).segments && w0 ? (d!.prev as NatPreview).segments.map((sg) => ({ pts: sg.cells.map((c) => w0.cellPos(c)), ferry: sg.ferry })) : undefined }));
    if (this.cerLive) cer.push({ strokes: [this.cerLive], handles: false, sel: null, pts: this.cerLive, path: undefined as any, ok: true, segs: undefined });
    const L = this.s.layers, onRoads = (this.s.step >= 5 && !!this.sim) || this.s.step === 6;
    if (onRoads) this.ensureWorld();
    this.r.setRoads({ sim: this.sim, w: onRoads ? this.world : null, layers: { roads: L.roads, rail: L.rail, plans: L.plans, signs: L.signs, abandoned: L.abandoned, ports: L.ports, airports: L.airports, lanes: L.lanes, econ: L.econ }, cer: this.s.step === 6 ? cer : [], pin: this.s.step === 6 ? this.pin : null, lite: this.lite, hl: this.hl ? { edges: this.hl.edges, ...(this.hl.air ? { air: this.hl.air } : {}) } : null, sel: this.selEdge, hide: [...this.hide], names: this.names });
  }
  /** After terrain exists: attach a loaded sim only if it matches this map and terrain exactly; otherwise quarantine it. */
  private attachPendingSim() {
    if (!this.pendingSim) return; const w = this.ensureWorld(), sim = this.pendingSim; if (!w || !this.terrain) return; this.pendingSim = null;
    const err = mapStateHash(this.s) !== sim.mapHash ? "地図が道路データと一致しません" : validateSimAgainstWorld(sim, w, this.terrain.hash);
    if (err) { putRaw(this.saveKey + ":quarantine", { savedAt: Date.now(), reason: err, sim }); this.saveLocked = true; this.toast(`道路データは読み込まず退避しました(保存データは上書きしません): ${err}`); return; }
    finishMigration(sim, w); this.sim = sim; setActiveEra(eraKeyOf(sim.era)); setActiveTimeline(sim.kaigen?.eras ?? null); this.runner = new SimRunner(sim, w);
    if (this.safeMode) { sim.speed = 0; this.status(); return; }
    const away = sim.lastWallMs > 0 ? Date.now() - sim.lastWallMs : 0; void this.catchUp(away);
  }
  async generate() {
    if (errorsFor(this.issues, "honshu").length || errorsFor(this.issues, "islands").length || errorsFor(this.issues, "features").length) { this.status(); return; }
    const key = stateKey(this.s), tok = ++this.genTok; this.generating = true; this.genProgress = 0; this.status();
    try {
      const res = await this.client.generate(JSON.parse(JSON.stringify(this.s)), (p) => { this.genProgress = p; this.status(); });
      if (stateKey(this.s) !== key) return;
      this.terrain = res; this.terrainKey = key; this.ensureWorld(); this.attachPendingSim(); for (const k of ["kokudo1", "fudo1"] as CerKind[]) if (this.cerDraft[k]) this.replanCer(k); this.restoreCer();
    } catch (e: any) { if (String(e?.message) !== "cancelled") this.toast("地形生成に失敗: " + e?.message); }
    finally { if (this.genTok === tok) { this.generating = false; this.render(); this.buildUI(); } }   // the busy state is always cleared, whatever happened
  }
  status() {
    const el = $("status"); el.replaceChildren();
    const add = (t: string, c = "") => el.append(h("span", { class: c }, t));
    const errs = this.issues.filter((i) => i.severity === "error" && STEPS.indexOf(i.step) <= Math.min(this.s.step, 3));
    if (this.building > 0) add(`1950年の道路網を生成中 ${Math.round(this.building * 100)}%`, "bad");
    if (this.s.step === 6 && this.sim) {
      const m = summary(this.sim), sp = this.sim.speed;
      add(`${m.ym}`, "ok"); add(sp ? `速度 ×${sp}` : "停止中"); add(this.sim.stage3 ? `路線${m.routes}本 道路${m.roadKm.toLocaleString()}km・鉄道${m.railKm.toLocaleString()}km` : `路線${m.routes}本 総延長${m.km.toLocaleString()}km`); if (this.sim.policy?.pending) add("政策介入の待機中", "bad"); add(`建設中${m.building} 未成${m.unbuilt}`);
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
  // Stage 9 (Pixel 7a report): drawing a range starts a terrain rebuild that takes seconds on a phone; the range tools must keep working meanwhile (each new
  // edit simply restarts the rebuild), or the next stroke turns into a pan of the map and seems to do nothing
  private editable() { const ridgeTool = isRidgeTool(this.tool); return this.tool !== "view" && (!this.generating || ridgeTool) && !this.catching && (this.s.step === 6 || !this.store.locked); }
  handler() {
    return {
      active: () => this.editable(),
      begin: (w: Vec, sc: Vec) => this.toolBegin(w, sc),
      move: (w: Vec, sc: Vec) => this.toolMove(w, sc),
      end: () => this.toolEnd(),
      cancel: () => { this.grab = null; this.pending = null; this.render(); },
      multiBegin: (a: Vec, b: Vec) => this.featureMultiBegin(a, b),
      multiMove: (a: Vec, b: Vec) => this.featureMultiMove(a, b),
      multiEnd: (c: boolean) => this.featureMultiEnd(c),
    };
  }
  // ---- Issue #18: Lake Biwa / Mt. Fuji by touch -- one finger moves, two fingers scale and twist ----
  private fpose: { which: "biwa" | "fuji"; a0: Vec; b0: Vec; pos0: Vec; rot0: number; k0: number; ky0: number; cur: { pos: Vec; rot: number; scale: number; sy: number } | null } | null = null;
  /** Would this pose be a valid map (anchor on land, whole outline on the same landmass, off the coast and off the other feature)? */
  featureOk(which: "biwa" | "fuji", pose: { pos: Vec; rot: number; scale: number; sy?: number }): boolean {
    const cand = JSON.parse(JSON.stringify(this.s)) as Store["state"]; Object.assign(cand.features[which], { pos: pose.pos, rot: pose.rot }); setFeatureSize(cand.features[which], pose.scale, pose.sy ?? pose.scale);
    return !validate(cand).some((i) => i.severity === "error" && i.step === "features");
  }
  private featureMultiBegin(a: Vec, b: Vec): boolean {
    if (this.tool !== "feature" || !this.editable()) return false;
    const which = this.selFeature, f = this.s.features[which]; this.grab = null; this.pending = null;
    const [kx0, ky0] = featureScales(f); this.fpose = { which, a0: a, b0: b, pos0: featureWorldPos(this.s, which), rot0: f.rot, k0: kx0, ky0, cur: null }; return true;
  }
  private featureMultiMove(a: Vec, b: Vec) {
    const g = this.fpose; if (!g) return;
    const d0 = Math.hypot(g.b0[0] - g.a0[0], g.b0[1] - g.a0[1]) || 1, d1 = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const th = Math.atan2(b[1] - a[1], b[0] - a[0]) - Math.atan2(g.b0[1] - g.a0[1], g.b0[0] - g.a0[0]);
    const m0: Vec = [(g.a0[0] + g.b0[0]) / 2, (g.a0[1] + g.b0[1]) / 2], m1: Vec = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const lim = FEATURE_LIMITS.scale, clampK = (v: number) => Math.round(Math.max(lim[0], Math.min(lim[1], v)) * 100) / 100, k = clampK(g.k0 * d1 / d0), ky = clampK(g.ky0 * d1 / d0);   // a pinch scales both axes together; the two sizes keep their ratio
    const pose = { pos: [g.pos0[0] + m1[0] - m0[0], g.pos0[1] + m1[1] - m0[1]] as Vec, rot: g.rot0 + th, scale: k, sy: ky };
    g.cur = pose; this.pending = { feature: { which: g.which, pos: pose.pos, rot: pose.rot, scale: pose.scale, scaleY: pose.sy, bad: !this.featureOk(g.which, pose) } }; this.render();
  }
  private featureMultiEnd(cancelled: boolean) {
    const g = this.fpose; this.fpose = null; this.pending = null; if (!g || !g.cur || cancelled) { this.render(); return; }
    this.applyFeaturePose(g.which, g.cur);
  }
  /** Commit a pose (one Undo step) if it is a valid map; otherwise say why and change nothing. Fuji's summit follows its size (half the proportion) unless a height was set by hand. */
  applyFeaturePose(which: "biwa" | "fuji", pose: { pos: Vec; rot: number; scale: number; sy?: number }): boolean {
    if (!this.featureOk(which, pose)) { this.toast(`${which === "biwa" ? "琵琶湖" : "富士山"}をそこには置けません(海・他の陸地・海岸に近すぎます)`); this.render(); return false; }
    const ok = this.commitEdit((s) => { const f = s.features[which]; f.pos = pose.pos; f.rot = pose.rot; setFeatureSize(f, pose.scale, pose.sy ?? pose.scale); if (which === "fuji" && f.height === undefined) { if (f.scale === undefined) delete f.auto; else f.auto = true; } });
    this.buildUI(); return ok;
  }
  toolBegin(w: Vec, sc: Vec): boolean {
    const t = this.tool, s = this.s;
    if (t === "cer-kokudo1" || t === "cer-fudo1" || t === "cer-kokudo0") {
      const kind = t.slice(4) as CerKind, d = this.cerDraft[kind], tol = 26 / this.r.view.zoom;
      if (this.cerMode === "move" && d) {   // grab the nearest control point of any stroke
        let best: { si: number; i: number } | null = null, bd = tol; d.strokes.forEach((st, si) => st.forEach((q, i) => { const dd = dist(q, w); if (dd < bd) { bd = dd; best = { si, i }; } }));
        if (!best) return false; const b = best as { si: number; i: number };
        this.grab = { t: "cer-move", kind, si: b.si, i: b.i, before: d.strokes.map((x) => x.slice()), strokes: d.strokes.map((x) => x.slice()), moved: false }; this.cerSel = b.si; return true;
      }
      if (this.cerMode === "pick") {   // a tap selects the nearest stroke
        let best = -1, bd = tol; (d?.strokes ?? []).forEach((st, si) => { for (let i = 0; i + 1 < st.length; i++) { const dd = pointSegDist(w, st[i], st[i + 1]); if (dd < bd) { bd = dd; best = si; } } });
        this.cerSel = best >= 0 ? best : null; this.renderRoads(); this.buildUI(); return true;
      }
      this.grab = { t, kind, pts: [w] }; this.cerLive = [w]; this.renderRoads(); return true;
    }
    if (t === "seatpick") { this.grab = { t, w }; return true; }
    if (t === "pick" || t === "why") { this.grab = { t, w }; return true; }
    if (t === "pull" || t === "bulge" || t === "dent" || t === "move") {
      const id = this.bodyForTool(), bs = s.bodies[id];
      const c = worldToPostOps(bs.place, w);
      this.grab = { t, id, w0: w, sc0: sc, c, place0: { ...bs.place, pos: [...bs.place.pos] as Vec } };
      return true;
    }
    if (t === "feature") {
      let best: "biwa" | "fuji" | null = null, bd = 34 / this.r.view.zoom;
      for (const f of ["biwa", "fuji"] as const) { const d = pointInPolygon(w, featureWorld(s, f)) ? 0 : dist(featureWorldPos(s, f), w); if (d < bd) { bd = d; best = f; } }
      if (!best) return false;
      this.selFeature = best; this.grab = { t, which: best, off: [featureWorldPos(s, best)[0] - w[0], featureWorldPos(s, best)[1] - w[1]] as Vec };
      this.buildUI(); this.render(); return true;
    }
    if (t === "ridge-sw" || t === "ridge-ne") {   // Stage 9: a new stroke -- the first of the range, or one more (continuing a stroke when started at its end)
      if (!this.onHonshu(w)) return false; const key = t === "ridge-sw" ? "sw" : "ne", lines = [s.ridges[key], ...(s.ridgeExtra?.[key] ?? [])], tol = RIDGE_TOUCH_PX / this.r.view.zoom;
      let si = s.ridges[key] ? -1 : 0, join: "end" | "start" | null = null; const rd = this.ridgeRedraw && this.ridgeRedraw.key === key ? this.ridgeRedraw : null;
      if (rd) { this.grab = { t, key, pts: [w], si: rd.si, join: null, redraw: true }; this.pending = { ridge: { key, pts: [w], si: rd.si } }; this.render(); return true; }   // redrawing a picked stroke: it replaces that stroke, it does not continue another
      lines.forEach((l, i) => { if (!l || l.length < 2 || join) return; if (dist(l[l.length - 1], w) <= tol) { si = i; join = "end"; } else if (dist(l[0], w) <= tol) { si = i; join = "start"; } });
      this.grab = { t, key, pts: [w], si, join }; this.pending = { ridge: { key, pts: [w], si: si >= 0 && join ? si : si } }; this.render(); return true;
    }
    if (t === "ridge-pick") {   // Stage 11: a tap selects the nearest stroke of either range (the same 区間 selection as for the 国道1号)
      let best: { key: "sw" | "ne"; si: number } | null = null, bd = RIDGE_TOUCH_PX / this.r.view.zoom;
      for (const key of ["sw", "ne"] as const) [s.ridges[key], ...(s.ridgeExtra?.[key] ?? [])].forEach((l, si) => { for (let i = 0; l && i + 1 < l.length; i++) { const d = pointSegDist(w, l[i], l[i + 1]); if (d < bd) { bd = d; best = { key, si }; } } });
      this.ridgeSel = best; this.render(); this.buildToolbar(); return true;
    }
    if (t === "ridge-edit") {   // any point of any stroke
      let best: { key: "sw" | "ne"; si: number; i: number } | null = null, bd = RIDGE_TOUCH_PX / this.r.view.zoom;
      for (const key of ["sw", "ne"] as const) [s.ridges[key], ...(s.ridgeExtra?.[key] ?? [])].forEach((l, si) => (l ?? []).forEach((q, i) => { const d = dist(q, w); if (d < bd) { bd = d; best = { key, si, i }; } }));
      if (!best) return false;
      this.grab = { t, ...(best as { key: "sw" | "ne"; si: number; i: number }) }; return true;
    }
    return false;
  }

  private onHonshu(w: Vec) { return pointInPolygon(w, worldParts("honshu", this.s.bodies.honshu)[0]); }
  toolMove(w: Vec, sc: Vec) {
    const g = this.grab; if (!g) return;
    if (g.t === "cer-kokudo1" || g.t === "cer-fudo1" || g.t === "cer-kokudo0") { if (dist(g.pts[g.pts.length - 1], w) >= 8 / this.r.view.zoom) { g.pts.push(w); this.cerLive = g.pts; this.renderRoads(); } return; }
    if (g.t === "cer-move") { g.strokes[g.si][g.i] = w; g.moved = true; const d = this.cerDraft[g.kind as CerKind]; if (d) { d.strokes = g.strokes; d.pts = d.strokes.flat(); } this.renderRoads(); return; }
    if (g.t === "pick" || g.t === "why" || g.t === "seatpick") { g.w = w; return; }
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
      g.pos = [w[0] + g.off[0], w[1] + g.off[1]]; const f = this.s.features[g.which as "biwa" | "fuji"]; this.pending = { feature: { which: g.which, pos: g.pos, bad: !this.featureOk(g.which, { pos: g.pos, rot: f.rot, scale: featureScales(f)[0], sy: featureScales(f)[1] }) } }; this.render();
    } else if (g.t === "ridge-sw" || g.t === "ridge-ne") {
      if (dist(g.pts[g.pts.length - 1], w) >= 10 / this.r.view.zoom && this.onHonshu(w)) { g.pts.push(w); this.pending = { ridge: { key: g.key, pts: this.ridgeJoined(g), si: g.si } }; this.render(); }
    } else if (g.t === "ridge-edit") {
      const pts = [...(this.ridgeStroke(g.key, g.si) ?? [])]; pts[g.i] = w; g.pts = pts; this.pending = { ridge: { key: g.key, pts, si: g.si } }; this.render();
    }
  }
  toolEnd() {
    const g = this.grab; this.grab = null; if (!g) return;
    this.pending = null; this.cerLive = null;
    if (g.t === "cer-kokudo1" || g.t === "cer-fudo1" || g.t === "cer-kokudo0") { this.finishDraw(g.kind, g.pts); return; }
    if (g.t === "cer-move") { if (g.moved) this.cerCommit(g.kind, g.strokes, g.before); else this.renderRoads(); return; }
    if (g.t === "seatpick") { this.tapSeat(g.w); return; }
    if (g.t === "pick") { this.pickScenery(g.w); return; }
    if (g.t === "why") { this.whyAt(g.w); return; }
    if (g.t === "pull" || g.t === "bulge" || g.t === "dent") {
      let op: Op | undefined = g.op;
      if (!op && g.t !== "pull") op = clampOp({ t: "bulge", c: g.c, r: this.brushKm / g.place0.scale, k: g.t === "bulge" ? 0.3 : -0.3 });
      if (op && (op.t !== "pull" || Math.hypot(op.d[0], op.d[1]) > 0.5)) this.store.commit((s) => { s.bodies[g.id as IslandId].ops.push(op!); });
      else this.render();
    } else if (g.t === "move" && g.place) this.store.commit((s) => { s.bodies[g.id as IslandId].place = g.place; });
    else if (g.t === "feature" && g.pos) { const f = this.s.features[g.which as "biwa" | "fuji"]; this.applyFeaturePose(g.which, { pos: g.pos, rot: f.rot, scale: featureScales(f)[0], sy: featureScales(f)[1] }); }
    else if ((g.t === "ridge-sw" || g.t === "ridge-ne") && g.pts.length >= 2) {
      let line = simplifyLine(this.ridgeJoined(g), 4);
      if (g.redraw) {   // Stage 11: the redrawn stroke takes the place of the picked one; a loose end close to an old end joins it again
        const old = this.ridgeStroke(g.key, g.si) ?? [], tol = RIDGE_TOUCH_PX / this.r.view.zoom, snap = (p: Vec) => (old.length ? [old[0], old[old.length - 1]].find((q) => dist(q, p) <= tol) ?? p : p);
        line = [snap(line[0]), ...line.slice(1, -1), snap(line[line.length - 1])]; this.ridgeRedraw = null;
      }
      this.commitEdit((s) => setRidgeStroke(s, g.key, g.si, line)); if (g.redraw) { this.buildToolbar(); this.render(); }
    }
    else if (g.t === "ridge-edit" && g.pts) this.commitEdit((s) => setRidgeStroke(s, g.key, g.si, g.pts));
    else this.render();
  }
  rotateSel(dir: number) {
    if (this.s.step === 3 || this.real) this.commitEdit((s) => { s.features[this.selFeature].rot += dir * ROT_STEP; });
    else { const id = this.bodyForTool(); this.store.commit((s) => { s.bodies[id].place.rot += dir * ROT_STEP; }); }
  }
  /** The few edits the real-Japan game allows before its first road; everything else stays locked. Refused once a simulation exists. */
  commitEdit(mut: (s: Store["state"]) => void): boolean {
    if (!this.real) return this.store.commit(mut);
    if (this.sim || this.pendingSim) { this.toast("道路づくりが始まったあとは、地形は変えられません"); return false; }
    // Issue #20: an edit that would make the map invalid (a lake or a mountain that does not fit) is never committed: the map stays exactly as it was before the
    // operation, no Undo step is added, nothing invalid reaches the save, and terrain generation is never left waiting on a map it will refuse to generate.
    const bad = (s: Store["state"]) => validate(s).filter((i) => i.severity === "error").map((i) => i.code).sort().join(",");
    const cand = JSON.parse(JSON.stringify(this.s)) as Store["state"]; mut(cand);
    const before = bad(this.s), after = bad(cand);
    if (after && after !== before && after.split(",").some((c) => !before.split(",").includes(c))) { this.pending = null; this.toast("置けない配置のため、操作の前の状態に戻しました"); this.render(); this.buildUI(); return false; }
    return this.store.commitLimited(mut);
  }
  undoEdit() { if (this.real && !this.sim) this.store.undoLimited(); else this.store.undo(); }
  redoEdit() { if (this.real && !this.sim) this.store.redoLimited(); else this.store.redo(); }
  /** Put the two Alps ranges where they really are (飛騨山脈=北, 赤石山脈=南). Points are rough ridge lines, not survey data. */
  realAlps() {
    const to = (lon: number, lat: number): Vec => realToWorld("honshu", this.s.bodies.honshu, lonLatToReal(lon, lat));
    const north = [[137.76, 36.76], [137.62, 36.58], [137.65, 36.34], [137.65, 36.29], [137.55, 36.11]].map(([a, b]) => to(a, b)), south = [[138.23, 35.78], [138.24, 35.67], [138.10, 35.60], [138.14, 35.45], [138.10, 35.33]].map(([a, b]) => to(a, b));
    this.commitEdit((s) => { s.ridges.ne = north; s.ridges.sw = south; delete s.ridgeExtra; s.alpsRemoved = { ne: true, sw: true }; });
  }
  /** Resize Lake Biwa (outline) or Mt. Fuji (body / summit height) by a factor, within the allowed range and only if the result is still a valid map (no lake touching the coast). */
  scaleFeature(which: "biwa" | "fuji", what: "scale" | "height", factor: number, axis: "both" | "x" | "y" = "both") {
    const lim = FEATURE_LIMITS[what], clampR = (v: number) => Math.round(Math.max(lim[0], Math.min(lim[1], v)) * 100) / 100;
    if (what === "height") {
      const cur = fujiHeightFactor(this.s.features.fuji), next = clampR(cur * factor); if (next === cur) { this.toast("これ以上は変えられません"); return false; }
      const cand = JSON.parse(JSON.stringify(this.s)) as Store["state"]; cand.features.fuji.height = next;
      if (validate(cand).some((i) => i.severity === "error" && i.step === "features")) { this.toast("富士山が海岸に近づきすぎるため、これ以上大きくできません"); return false; }
      return this.commitEdit((s) => { if (next === 1 && !s.features.fuji.auto) delete s.features.fuji.height; else s.features.fuji.height = next; });
    }
    // Stage 11: the two axes of the feature (its own x, then its y) are sized separately, each up to 5x; the stretch is axis-aligned in the feature's own frame, so the outline is never sheared
    const [kx, ky] = featureScales(this.s.features[which]), nx = axis === "y" ? kx : clampR(kx * factor), ny = axis === "x" ? ky : clampR(ky * factor);
    if (nx === kx && ny === ky) { this.toast("これ以上は変えられません"); return false; }
    const cand = JSON.parse(JSON.stringify(this.s)) as Store["state"]; setFeatureSize(cand.features[which], nx, ny);
    if (validate(cand).some((i) => i.severity === "error" && i.step === "features")) { this.toast(which === "biwa" ? "琵琶湖が海岸に近づきすぎるため、これ以上大きくできません" : "富士山が海岸に近づきすぎるため、これ以上大きくできません"); return false; }
    return this.commitEdit((s) => { setFeatureSize(s.features[which], nx, ny); if (which === "fuji" && s.features.fuji.height === undefined) { if (s.features.fuji.scale === undefined) delete s.features.fuji.auto; else s.features.fuji.auto = true; } });
  }
  clearRanges() { this.commitEdit((s) => { s.ridges.ne = null; s.ridges.sw = null; delete s.ridgeExtra; }); }
  /** Stage 9: one stroke of a range (0 = the first). */
  private ridgeStroke(key: "sw" | "ne", si: number): Vec[] | null { return si === 0 ? this.s.ridges[key] : this.s.ridgeExtra?.[key]?.[si - 1] ?? null; }
  /** The stroke being drawn, joined to the stroke it continues (at its end or its start). */
  private ridgeJoined(g: { key: "sw" | "ne"; si: number; join: "end" | "start" | null; pts: Vec[] }): Vec[] { if (!g.join || g.si < 0) return g.pts; const base = this.ridgeStroke(g.key, g.si) ?? []; return g.join === "end" ? [...base, ...g.pts.slice(1)] : [...[...g.pts].reverse(), ...base.slice(1)]; }
  /**
   * Set one of the three seats (the capital, the sub-capital, the Imperial Palace) to a prefecture. They are independent, except that the capital and the
   * sub-capital must be different prefectures (refused with a message); the palace may share a prefecture with either. Choosing a palace prefecture
   * forgets a hand-placed palace point (it goes back to that prefecture's 県庁所在地).
   */
  setSeat(which: "capital" | "sub" | "palace", pref: string, keepOpen = false): boolean {
    if (!PREF_IDS.includes(pref)) return false; const cur = seatsOf(this.s);
    if ((which === "capital" && pref === cur.sub) || (which === "sub" && pref === cur.capital)) { this.toast("首都と副首都は別の府県にしてください"); this.buildToolbar(); return false; }
    const ok = this.commitEdit((s) => { if (which === "capital") s.capital = pref; else if (which === "sub") s.subCapital = pref; else { s.palace = pref; delete s.palacePos; } if (which === "capital") delete s.capitalPos; else if (which === "sub") delete s.subPos; });
    if (!keepOpen) this.seatMode = null; for (const k of ["kokudo1", "fudo1"] as CerKind[]) if (this.cerDraft[k]) this.replanCer(k); this.renderRoads(); this.buildUI(); return ok;
  }
  // ---- Stage 19: the setup tabs (元号 / 首都 / 副首都 / 皇居) and the choice of a seat on the map ----
  setupTab: "era" | "capital" | "sub" | "palace" | null = null; seatMode: "list" | "map" | null = null; seatPick: { w: Vec; pref: string; name?: string; near?: string; km?: number; islet?: string; claim?: string } | null = null;
  openSetupTab(tab: "era" | "capital" | "sub" | "palace" | null) {
    this.setupTab = this.setupTab === tab ? null : tab; this.seatMode = this.setupTab && this.setupTab !== "era" ? "list" : null; this.seatPick = null; this.r.seatPending = null; if (this.tool === "seatpick") this.tool = "view";   // Stage 21: a seat tab opens its prefecture list at once
    this.eraOpen = this.setupTab === "era";   // Stage 22: so does the era tab
    this.buildToolbar(); this.render();
  }
  chooseSeatMode(m: "list" | "map") {
    this.seatMode = m; this.seatPick = null; this.r.seatPending = null; this.tool = m === "map" ? "seatpick" : this.tool === "seatpick" ? "view" : this.tool; this.buildToolbar(); this.render();
  }
  /** A tap in the map-choice mode: only land, only inside a prefecture; the point is shown and waits for 決定 (a stray tap changes nothing). */
  tapSeat(w: Vec): boolean {
    const world = this.ensureWorld(), which = this.e22Pick ?? this.setupTab; if (!world || !which || which === "era") return false;
    // Stage 20: the hit area is a finger wide (about 24 px) whatever the zoom; the nearest island within it is the one chosen, so a speck of an island can be hit and two close ones are told apart
    let k = world.cellOf(w); const zoom = Math.max(0.02, this.r.view.zoom), hitKm = 24 / zoom, onLand = k >= 0 && world.t.land[k] === 1; let pt: Vec = [w[0], w[1]], isl: { name: string; claim?: string } | undefined, bd = Infinity, offIsl = false;
    for (const s of world.islets ?? []) {
      const d = Math.max(0, Math.hypot(s.pos[0] - w[0], s.pos[1] - w[1]) - Math.max(s.islet.len, s.islet.wid) / 2), own = onLand && s.cells.includes(k);
      if ((own || d <= (onLand ? 8 : 24) / zoom) && (own ? -1 : d) < bd) { bd = own ? -1 : d; isl = { name: s.islet.name, claim: s.islet.claim }; offIsl = !!s.offGrid; if (!own) { pt = [s.pos[0], s.pos[1]]; k = world.cellOf(pt); } }
    }
    if (isl && offIsl) { this.toast(`${isl.name}には定住する人がいないため、県庁所在地には選べません`); return false; }   // Stage 22 (drawn on the map, not part of the simulated land)
    if (!isl && (k < 0 || world.t.land[k] !== 1)) { let best = -1, bk = Infinity; const i0 = k % world.nx, j0 = (k / world.nx) | 0, r = Math.min(6, Math.ceil(hitKm / world.cell)); if (k >= 0) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const a = i0 + di, b = j0 + dj; if (a < 0 || b < 0 || a >= world.nx || b >= world.ny) continue; const q = b * world.nx + a; if (world.t.land[q] !== 1 || !world.prefOf(q)) continue; const c = world.cellPos(q), d = Math.hypot(c[0] - w[0], c[1] - w[1]); if (d <= hitKm && d < bk) { bk = d; best = q; } } if (best >= 0) { k = best; pt = world.cellPos(best); } }
    if (k < 0 || world.t.land[k] !== 1 || !world.prefOf(k)) { this.toast("陸地の点をタップしてください(海や対象外の場所は選べません)"); return false; }
    const pref = world.prefOf(k)!, cur = this.e22Pick && this.e22 ? { capital: this.e22.capital!, sub: this.e22.sub!, palace: this.e22.palace! } : seatsOf(this.s);
    if ((which === "capital" && pref === cur.sub) || (which === "sub" && pref === cur.capital)) { this.toast("首都と副首都は別の府県にしてください"); return false; }
    const inCity = world.cities.filter((c) => c.island === world.t.island[k] && Math.hypot(c.pos[0] - pt[0], c.pos[1] - pt[1]) <= 25).sort((p, q) => Math.hypot(p.pos[0] - pt[0], p.pos[1] - pt[1]) - Math.hypot(q.pos[0] - pt[0], q.pos[1] - pt[1]))[0];   // (a city of the game within 25 km is the place: the 県庁所在地 becomes that city)
    const np = inCity ? { name: inCity.name, place: inCity.name, km: Math.round(Math.hypot(inCity.pos[0] - pt[0], inCity.pos[1] - pt[1]) * 10) / 10 } : nearestPlace(pt, new Set(world.cities.map((c) => c.name)));
    this.seatPick = { w: [pt[0], pt[1]], pref, ...(np ? { name: np.name, near: np.place, km: np.km } : {}), ...(isl ? { islet: isl.name, ...(isl.claim ? { claim: isl.claim } : {}) } : {}) }; this.r.seatPending = this.seatPick.w; this.buildToolbar(); this.render(); return true;
  }
  confirmSeatPick(): boolean {
    if (this.e22Pick && this.e22 && this.seatPick) {   // Stage 22: a seat of the 2200 event, kept in the event's draft until 決める
      const p = this.seatPick, r = this.e22Pick, d = this.e22; if (r === "capital") { d.capital = p.pref; d.capitalPos = p.w; } else if (r === "sub") { d.sub = p.pref; d.subPos = p.w; } else { d.palace = p.pref; d.palacePos = p.w; }
      this.endE22Map(); return true;
    }
    const p = this.seatPick, which = this.setupTab; if (!p || !which || which === "era") return false;
    const ok = this.commitEdit((s) => { if (which === "capital") { s.capital = p.pref; s.capitalPos = p.w; } else if (which === "sub") { s.subCapital = p.pref; s.subPos = p.w; } else { s.palace = p.pref; s.palacePos = p.w; } });
    this.seatPick = null; this.r.seatPending = null; if (this.tool === "seatpick") this.tool = "view"; this.seatMode = null;
    for (const k of ["kokudo1", "fudo1"] as CerKind[]) if (this.cerDraft[k]) this.replanCer(k); this.renderRoads(); this.buildUI(); return ok;
  }
  // ---- Stage 22: the 2200 event ----
  /** Stage 24: the seats of the game being played: after 2200 they are the ones the player chose then (sim), before that those of the map state. */
  activeSeats(): { capital: string; sub: string; palace: string } {
    const st = seatsOf(this.s), sim = this.sim; if (!sim?.e2200) return st;
    return { capital: sim.capital ?? st.capital, sub: sim.subCapital ?? st.sub, palace: prefOfSeat(sim.palace?.pref) ?? st.palace };
  }
  /** Where the three seats stand in the world (the 県庁所在地 city of each, or the palace's own point). */
  seatPoints(w: World): { capital: Vec | null; sub: Vec | null; palace: Vec | null } {
    const sim = this.sim!, a = this.activeSeats(), pos = (p: string) => w.cities.find((c) => c.pref === p && c.kind === "capital")?.pos ?? null;
    return { capital: homeCity(w, a.capital)?.pos ?? pos(a.capital), sub: subCity(w, a.sub)?.pos ?? pos(a.sub), palace: sim.palace?.pos ?? pos(a.palace) };
  }
  road0Told = false; e22: Choice2200 | null = null; e22Pick: "capital" | "sub" | "palace" | null = null;
  startE22Map(role: "capital" | "sub" | "palace") { this.e22Pick = role; this.seatPick = null; this.r.seatPending = null; this.tool = "seatpick"; this.sheet = null; this.buildSheet(); this.buildToolbar(); this.render(); }
  endE22Map() { this.e22Pick = null; this.seatPick = null; this.r.seatPending = null; if (this.tool === "seatpick") this.tool = "view"; this.sheet = "e2200"; this.buildSheet(); this.buildToolbar(); this.render(); }
  /** 決める / 今のまま: applied to the game; a seat put on the map rebuilds the world with the new 県庁所在地 (people come from the old one, a little) and the runner goes on with it. */
  decideE2200(keep: boolean) {
    const sim = this.sim; if (!sim || sim.e2200?.state !== "pending") return; this.runner?.settle();
    const moved = apply2200(sim, keep ? null : this.e22 ?? null); this.e22 = null; closeRadio();
    if (moved) { const w = this.ensureWorld(); if (w) { adoptWorld(sim, w); if (this.runner) this.runner.w = w; } }
    this.sheet = null; this.buildSheet(); if ((sim.e2200?.state as string) === "road0") this.toast("国道0号を描けます(新首都と新副首都を結ぶ。既存の道・旧道・廃道を優先して使います)");
    this.renderRoads(); this.render(); this.buildUI(); void this.persist(true);
  }
  /** Stage 22: 開通の儀 of 国道0号 (or none). */
  openRoad0(skip = false) {
    const sim = this.sim, w = this.world; if (!sim || !w || sim.e2200?.state !== "road0") return;
    if (skip) { close2200(sim); delete this.cerDraft.kokudo0; this.tool = "view"; this.buildUI(); this.renderRoads(); return; }
    const d = this.cerDraft.kokudo0; if (!d?.prev.ok) return; this.runner?.settle();
    const info = performRoad0(sim, w, d.prev as NatPreview); if (!info) { this.toast("国道0号を開通できませんでした"); return; }
    close2200(sim, info); delete this.cerDraft.kokudo0; this.tool = "view"; this.toast(`国道0号が開通(転用${info.reusedKm}km・復旧${info.restoredKm}km・新設${info.newKm}km)`); this.renderRoads(); this.buildUI(); void this.persist(true);
  }
  /** Stage 21: 戻る in the map choice: back to the prefecture list, nothing changed. */
  backToSeatList() { if (this.e22Pick) { this.endE22Map(); return; } this.seatPick = null; this.r.seatPending = null; this.seatMode = "list"; if (this.tool === "seatpick") this.tool = "view"; this.buildToolbar(); this.render(); }
  cancelSeatPick() { this.seatPick = null; this.r.seatPending = null; this.buildToolbar(); this.render(); }
  /** Back to the prefecture's 県庁所在地 for one seat. */
  resetSeatPos(which: "capital" | "sub" | "palace") { this.commitEdit((s) => { if (which === "capital") delete s.capitalPos; else if (which === "sub") delete s.subPos; else delete s.palacePos; }); this.buildToolbar(); this.render(); }
  scaleSel(dir: number) { const id = this.bodyForTool(); this.store.commit((s) => { s.bodies[id].place.scale = Math.max(0.3, Math.min(3, s.bodies[id].place.scale * (dir > 0 ? 1.05 : 1 / 1.05))); }); }
  suggestRanges() {
    const d = derive(this.s), neRef = rotv([Math.SQRT1_2, Math.SQRT1_2], this.s.bodies.honshu.place.rot), f = axisFrame(d.parts.honshu[0], neRef);
    this.store.commit((s) => { s.ridges.sw = suggestRidge(d.parts.honshu[0], f, "sw"); s.ridges.ne = suggestRidge(d.parts.honshu[0], f, "ne"); });
  }

  // ---------- Stage 2: ceremony, clock, scenery ----------
  /** Strokes accumulate: each new one is appended (its start snapped to the previous end if close), and the whole is re-planned and previewed. */
  private finishDraw(kind: CerKind, pts: Vec[]) {
    const w = this.ensureWorld(); if (!w) return;
    if (pts.length < 2 || pathLen(pts) < 6 / this.r.view.zoom) { this.renderRoads(); return; }   // a tap or a twitch is not a stroke
    const d = this.cerDraft[kind], strokes = (d?.strokes ?? []).map((x) => x.slice()), ri = this.cerRedraw, tol = 40 / this.r.view.zoom;
    let stroke = toControlPoints(pts);
    if (ri !== null && ri < strokes.length) {
      // Stage 9: a redrawn stroke takes the old one's place and is joined to its neighbours' ends, so the rest of the line (and any strait or lake crossing in it) is kept
      const prevS = strokes[ri - 1], nextS = strokes[ri + 1];
      if (prevS) stroke = [prevS[prevS.length - 1], ...stroke]; if (nextS) stroke = [...stroke, nextS[0]];
      strokes[ri] = stroke; this.cerRedraw = null; this.cerSel = ri;
    } else {
      const last = strokes[strokes.length - 1]; if (last && dist(last[last.length - 1], stroke[0]) < tol) stroke[0] = last[last.length - 1];
      strokes.push(stroke);
    }
    this.cerCommit(kind, strokes);
    const nd = this.cerDraft[kind]; if (nd && !nd.prev.ok) this.toast(nd.prev.reasons[0]);
  }
  /** One edit of the drawn 国道1号 (a stroke added, moved, deleted or redrawn): one Undo step. */
  cerCommit(kind: CerKind, strokes: Vec[][], before?: Vec[][]) {
    const d = this.cerDraft[kind] ?? { pts: [] as Vec[], prev: null as any, strokes: [] as Vec[][], past: [] as Vec[][][], redo: [] as Vec[][][] };
    d.past.push((before ?? d.strokes).map((x) => x.slice())); if (d.past.length > 60) d.past.shift(); d.redo = []; d.strokes = strokes; this.cerDraft[kind] = d; this.replanCer(kind); this.renderRoads(); this.buildUI();
  }
  cerDeleteSel(kind: CerKind) { const d = this.cerDraft[kind], i = this.cerSel; if (!d || i === null || i >= d.strokes.length) return; const next = d.strokes.filter((_, k) => k !== i).map((x) => x.slice()); this.cerSel = null; this.cerCommit(kind, next); }
  cerRedrawSel() { if (this.cerSel === null) return; this.cerRedraw = this.cerSel; this.cerMode = "draw"; this.toast("選んだ区間を描き直してください。両端は前後の区間に自動でつながります"); this.buildUI(); this.renderRoads(); }
  private replanCer(kind: CerKind) {
    const w = this.ensureWorld(), d = this.cerDraft[kind]; if (!w || !d) return;
    if (!d.strokes.length && !d.past.length && !d.redo.length) { delete this.cerDraft[kind]; this.saveCer(); return; }
    if (!d.strokes.length) { d.pts = []; d.prev = { ok: false, reasons: ["線がありません。描いてください"], cells: [], path: [], lengthKm: 0, passes: [], maxGradePct: 0, endName: "" }; this.saveCer(); return; }
    d.pts = d.strokes.flat(); const st = seatsOf(this.s);
    if (kind === "kokudo0" && this.sim) { d.prev = previewNational(w, d.pts, this.sim.capital, this.sim.subCapital, { snapKm: snapKmFor(this.r.view.zoom), roadside: true, roadCells: buildIndex(this.sim, "road").roadCells }); return; }   // Stage 22: along the roads that are there
    d.prev = this.real ? previewNational(w, d.pts, st.capital, st.sub, { snapKm: snapKmFor(this.r.view.zoom), roadside: true }) : previewCeremony(w, kind, d.pts, this.s.capital); this.saveCer();
  }
  cerUndo(kind: CerKind) { const d = this.cerDraft[kind]; if (!d || !d.past.length) return; d.redo.push(d.strokes); d.strokes = d.past.pop()!; this.cerSel = null; this.replanCer(kind); this.renderRoads(); this.buildUI(); }
  cerRedo(kind: CerKind) { const d = this.cerDraft[kind]; if (!d || !d.redo.length) return; d.past.push(d.strokes); d.strokes = d.redo.pop()!; this.cerSel = null; this.replanCer(kind); this.renderRoads(); this.buildUI(); }
  cerRestart(kind: CerKind) { delete this.cerDraft[kind]; this.cerSel = null; this.cerRedraw = null; this.saveCer(); this.renderRoads(); this.buildUI(); }
  /** A ceremony in progress survives a reload (strokes only; the preview is recomputed from them). */
  saveCer() { try { const o: Record<string, { strokes: Vec[][]; past: Vec[][][]; future: Vec[][][] }> = {}; for (const k of ["kokudo1", "fudo1"] as CerKind[]) { const d = this.cerDraft[k]; if (d) o[k] = { strokes: d.strokes, past: d.past.slice(-30), future: d.redo.slice(-30) }; } if (Object.keys(o).length) localStorage.setItem("kfm.cer", JSON.stringify(o)); else localStorage.removeItem("kfm.cer"); } catch { /* ignore */ } }
  private restoreCer() {
    if (this.sim || Object.keys(this.cerDraft).length) return; const w = this.ensureWorld(); if (!w) return;
    try {
      const o = JSON.parse(localStorage.getItem("kfm.cer") || "{}"), okPt = (p: unknown) => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === "number" && Number.isFinite(x)), okS = (s: unknown): s is Vec[] => Array.isArray(s) && s.length >= 2 && s.length < 5000 && s.every(okPt);
      for (const k of (this.real ? ["kokudo1"] : ["kokudo1", "fudo1"]) as CerKind[]) { const e = o[k]; if (!e || !Array.isArray(e.strokes)) continue; const strokes = e.strokes.filter(okS), snaps = (x: unknown) => (Array.isArray(x) ? x : []).filter((sn: unknown) => Array.isArray(sn) && sn.every(okS)) as Vec[][][];
        // older drafts kept a redo list of single strokes; each becomes one future snapshot (the strokes plus it)
        const legacy: Vec[][] = Array.isArray(e.redo) ? e.redo.filter(okS) : [], redo = Array.isArray(e.future) ? snaps(e.future) : legacy.map((_: Vec[], i: number) => [...strokes, ...legacy.slice(i).reverse()]), past = snaps(e.past);
        if (!strokes.length) continue; this.cerDraft[k] = { pts: [], prev: null as any, strokes, past: past.length ? past : strokes.map((_: Vec[], i: number) => strokes.slice(0, i)), redo }; this.replanCer(k); }
    } catch { /* ignore */ }
  }
  cerReady() { return this.real ? !!this.cerDraft.kokudo1?.prev.ok : !!(this.cerDraft.kokudo1?.prev.ok && this.cerDraft.fudo1?.prev.ok); }
  async doCeremony() {
    const w = this.ensureWorld(), k = this.cerDraft.kokudo1?.prev, f = this.cerDraft.fudo1?.prev;
    if (!w || !this.terrain || !k?.ok || (!this.real && !f?.ok) || !this.s.finalized || this.sim || this.building) return;
    const seats = seatsOf(this.s), palacePos = palaceWorld(this.s);
    this.building = 0.01; this.status(); this.buildUI();
    // the 1950 network is generated in slices (a single long task froze phones); the UI shows progress and stays responsive
    const gen = createSimGen(w, mapStateHash(this.s), this.terrain.hash, this.s.seed, this.real ? { stage3: true, firstEra: this.firstEra, capital: seats.capital, subCapital: seats.sub, palace: { pref: seats.palace, pos: palacePos ?? [0, 0] }, ...(this.s.capitalPos ? { capitalPos: this.s.capitalPos } : {}), ...(this.s.subPos ? { subPos: this.s.subPos } : {}), ...(w.moveSpec ? { moves: w.moveSpec } : {}) } : {}); let sim: SimState | null = null;
    while (!sim) {
      const t0 = performance.now();
      while (performance.now() - t0 < 10) { const r = gen.next(); if (r.done) { sim = r.value; break; } this.building = Math.max(this.building, r.value); }
      this.status(); await new Promise((res) => setTimeout(res, 0));
    }
    this.building = 0;
    if (!(this.real ? performNational(sim, w, k as NatPreview) : performCeremony(sim, w, k, f!))) { this.toast("開通の儀を行えませんでした"); this.buildUI(); return; }
    // Stage 10: route-number signs start OFF once the roads exist, unless the player has already chosen (a stored OFF in an older save is kept as it is)
    if (!this.s.layersSet?.includes("signs") && this.s.layers.signs) this.store.set((s) => { s.layers.signs = false; });
    sim.speed = 1; this.sim = sim; this.saveLocked = false; this.runner = new SimRunner(sim, w); this.cerDraft = {}; this.saveCer(); this.tool = "view"; this.acc = 0; this.lastTick = performance.now();
    this.persist(); this.toast("開通の儀を終えました。時間が動き始めます"); this.onChange();
  }
  /** Stage 11: delete the selected stroke of a range (one Undo step), as 区間を消す does for the 国道1号. */
  ridgeDeleteSel() { const sel = this.ridgeSel; if (!sel) return; this.ridgeSel = null; this.commitEdit((s) => removeRidgeStroke(s, sel.key, sel.si)); this.buildToolbar(); this.render(); }
  /** Stage 11: redraw the selected stroke: the next stroke drawn replaces it, its ends snapped to the old ends when they are close (so it joins what it joined before). */
  ridgeRedrawSel() { const sel = this.ridgeSel; if (!sel) return; this.ridgeRedraw = { ...sel }; this.ridgeSel = null; this.tool = sel.key === "ne" ? "ridge-ne" : "ridge-sw"; this.pending = null; this.toast("選んだ区間を描き直してください。両端は元の線の端につながります"); this.buildToolbar(); this.render(); }
  /** Centre the map on a route (from the ledger) and highlight its longest section. */
  focusRoute(routeId: string) {
    const sim = this.sim, w = this.world, r = sim?.routes[routeId]; if (!sim || !w || !r) return;
    const es = r.edges.map((x) => sim.edges[x.edgeId]).filter(Boolean); if (!es.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const e of es) for (const p of edgePoints(w, sim, e)) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    const { w: sw, h: sh } = this.r.size, zoom = Math.min(2.5, Math.max(0.3, 0.8 * Math.min(sw / (x1 - x0 + 40), (sh * 0.45) / (y1 - y0 + 40))));
    this.selEdge = es.sort((p, q) => q.lengthKm - p.lengthKm)[0].id; this.r.setView({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 - (sh * 0.2) / zoom, zoom }); this.renderRoads();
  }
  /** The player chose an era name at a kaigen. */
  chooseKaigen(idx: number) { const sim = this.sim; if (!sim?.kaigen?.pending) return; const e = settleKaigen(sim, idx, false); this.sheet = null; this.afterPolicy(); if (e) this.toast(`${e.name}元年になりました`); this.buildUI(); }
  afterPolicy() { this.lastTick = performance.now(); this.acc = 0; this.persist(true); this.renderRoads(); this.status(); this.buildSheet(); }
  /** Test/debug hook: advance synchronously (the normal clock is slower than a test can wait). */
  ffYears(n: number) { if (!this.sim || !this.world) return; this.runner?.settle(); advance(this.sim, this.world, 12 * n); this.renderRoads(); this.status(); this.buildUI(); }
  setSpeed(n: 0 | 1 | 5 | 20) { if (!this.sim) return; this.sim.speed = n; this.acc = 0; this.lastTick = performance.now(); this.persist(); this.buildUI(); }
  /** Real-time clock: only while this page is visible. Tab hidden or app closed = no simulation; return = capped catch-up. */
  tickClock(frameTime = performance.now()) {
    const now = frameTime, sim = this.sim, w = this.world, run = this.runner;
    if (run && !run.gate) run.gate = (sm) => checkpointDue(sm) !== null;   // Stage 26: the clock stops at a year boundary that owes a checkpoint
    if (sim?.e2200?.state === "pending" && this.sheet !== "e2200" && !this.e22Pick && !document.getElementById("rw-root")) { this.sheet = "e2200"; this.buildSheet(); this.toast(`${sim.e2200.year}年: 遷都と復興の時です(時間は止まっています)`); this.road0Told = false; }
    else if (sim?.e2200?.state === "road0" && !this.road0Told) { this.road0Told = true; this.toast("国道0号を描いて開通させるか、見送るかを選んでください(時間は止まっています)"); }   // Stage 24: choosing the era and seats is not the end of the event
    else if (sim?.kaigen?.pending && this.sheet !== "kaigen") { this.sheet = "kaigen"; this.buildSheet(); this.toast("改元の時です。元号を選んでください(時間は止まっています)"); }
    else if (sim?.policy?.pending && this.sheet !== "policy") { this.sheet = "policy"; this.buildSheet(); this.toast("10年ごとの政策介入の機会です(時間は止まっています)"); }
    if (!sim || !w || !run || !sim.ceremonyDone || sim.speed === 0 || document.hidden || this.catching || this.s.step < 5 || sim.policy?.pending || sim.kaigen?.pending || waiting2200(sim)) { this.lastTick = now; return; }
    if (run.waiting) { this.lastTick = now; if (!this.cpBusy) void this.takeCheckpoint(); return; }
    const dt = Math.min(250, Math.max(0, now - this.lastTick)); this.lastTick = now;
    this.acc += dt * sim.speed; const n = Math.floor(this.acc / MS_PER_MONTH_X1);
    if (n > 0) { this.acc -= n * MS_PER_MONTH_X1; run.request(n); }
    // at most ~8 ms of simulation per frame: the page stays smooth and the clock simply falls behind on a slow phone
    const done = run.pump(8); if (run.waiting && !this.cpBusy) void this.takeCheckpoint(); this.behind = run.dropped > 0 && run.pending >= 20; if (run.pending < 3) run.dropped = 0;
    // a device that cannot keep up for a long stretch switches itself to the light drawing (and says so)
    this.slowTicks = this.behind ? this.slowTicks + 1 : Math.max(0, this.slowTicks - 2);
    if (this.real && !this.lite && this.slowTicks > 1800) { this.setLite(true); this.toast("端末の処理が追いつかないため、軽量表示に切り替えました(レイヤーで戻せます)"); }
    if (done > 0) this.afterTick(now);
  }
  cpBusy = false; private costRoads = 0; private costHud = 0;
  /** Stage 26: the clock has stopped at a year boundary that owes a checkpoint: write it (a failure is announced and the game goes on; the previous checkpoints are never touched by a failed write). */
  async takeCheckpoint() {
    const sim = this.sim, run = this.runner; if (!sim || !run) return; const due = checkpointDue(sim);
    if (!due || this.cpBusy) { run.waiting = false; return; }
    this.cpBusy = true;
    try {
      markCheckpoint(sim, due); sim.lastWallMs = Date.now(); const json = JSON.stringify(makeSave(this.s, sim)), st = seatsOf(this.s);   // (serialised in the same breath as the marking)
      const r = await writeCheckpoint(idbCpStore, json, due, { capital: seatPrefName(sim.capital ?? st.capital), sub: seatPrefName(sim.subCapital ?? st.sub) });
      this.toast(r.ok ? `${due.year}年の自動セーブポイントを作りました${due.kind === "reloc" ? "(遷都の直前)" : ""}` : `自動セーブポイントを作れませんでした(${r.error})。ゲームはこのまま続けられます`);
      if (this.sheet === "menu") this.buildSheet();
    } catch (e) { this.toast(`自動セーブポイントを作れませんでした(${e instanceof Error ? e.message : "不明"})。ゲームはこのまま続けられます`); }
    finally { this.cpBusy = false; run.waiting = false; this.lastTick = performance.now(); this.acc = 0; }
  }
  private afterTick(now = performance.now()) {
    // Stage 26: the redraw and the status line wait longer the more they cost (the network grows with the years: ~1500 edges in 1960, ~2700 by 2250), so each stays about a tenth of the time whatever the era
    if (now - this.lastRoads > (this.lite ? 1200 : Math.min(1500, Math.max(450, this.costRoads * 8)))) { this.lastRoads = now; const t0 = performance.now(); this.renderRoads(); this.costRoads = performance.now() - t0; }   // redrawing the road layer is the costly part: ~2 Hz is plenty
    if (now - this.lastHud > Math.min(1500, Math.max(500, this.costHud * 20))) { this.lastHud = now; const t0 = performance.now(); this.status(); if (this.sheet === "history" || this.sheet === "roads") this.buildSheet(); this.costHud = performance.now() - t0; }
    if (now - this.lastPersist > 10000) this.persist();
  }
  async catchUp(elapsedMs: number) {
    const sim = this.sim, run = this.runner; if (!sim || !run || !sim.ceremonyDone) return;
    const plan = planCatchUp(elapsedMs, sim.speed); if (plan.months <= 0 && plan.skipped <= 0) return;
    this.catching = true; const target = sim.month + plan.months; if (sim.policy) sim.policy.away = true;
    while (sim.month < target) {
      if (sim.policy?.pending || sim.kaigen?.pending || waiting2200(sim)) break;
      run.request(Math.min(24, target - sim.month - run.pending)); run.pump(12); if (run.waiting) await this.takeCheckpoint();
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
  saveUi() { try { localStorage.setItem("kfm.ui", JSON.stringify({ hide: [...this.hide], names: this.names, legendOpen: this.legendOpen, legendShown: this.legendShown, legendSide: this.legendSide })); } catch { /* ignore */ } }
  /** Legend filters are display-only: they never touch the simulation. */
  toggleHide(key: string) { if (this.hide.has(key)) this.hide.delete(key); else this.hide.add(key); this.saveUi(); this.renderRoads(); this.buildSheet(); }
  /** Stage 11: which map is shown -- the road map or the terrain map -- is chosen in the settings, kept with the game (`bg`), and restored on load. `keep` = false for the temporary switch while a range is edited. */
  setBg(bg: "terrain" | "roadmap", keep = true) { this.bg = bg; if (keep) { try { localStorage.setItem("kfm.bg", bg); } catch { /* ignore */ } if (this.s.bg !== bg) this.store.set((s) => { s.bg = bg; }); } this.r.setBg(bg); this.buildToolbar(); }
  /** Stage 3 dock: the observation tools get their own buttons (the old dock's 検証/取消/やり直し make no sense on a fixed real map). */
  private buildRealDock() {
    const dock = $("dock"), fit = $("btn-fit");   // the old buttons stay in the DOM (other code reads them) but are hidden
    for (const b of Array.from(dock.children)) if (b !== fit) (b as HTMLElement).hidden = true;
    for (const [id, label] of [["layers", "レイヤー"], ["timeline", "年表"], ["ledger", "台帳"], ["atlas", "地図帳"], ["policy", "介入"], ["menu", "保存"]] as [string, string][]) dock.insertBefore(h("button", { id: "dock-" + id, onclick: () => this.openSheet(id) }, label), fit);
  }
  // ---- Stage 23: the line chosen in the ledger / number list, drawn in its own colour ----
  sheetKey = ""; hl: HlTarget | null = null; hlList: HlTarget[] = []; ledgerMini = false;
  /** Choose a line (or let go of it when it is the one already chosen). The ledger shrinks to a bar while one is chosen. Nothing in the game changes. */
  toggleHl(t: HlTarget, list?: HlTarget[]) { if (list) this.hlList = list; if (this.hl?.id === t.id) { this.clearHl(); return; } this.hl = t; this.ledgerMini = true; this.buildSheet(); this.fitHl(); this.renderRoads(); }
  /** Move and zoom the map to the chosen line: its east-west width about 80% of the free width (all of it if it is taller than that allows), in the part of the screen the small window and the legend leave free. */
  fitHl() {
    const sim = this.sim, w = this.world, t = this.hl; if (!sim || !w || !t) return; const b = hlBounds(sim, w, t); if (!b) return;
    const { w: sw, h: sh } = this.r.size, st = document.getElementById("status")?.getBoundingClientRect(), sheet = document.getElementById("sheet"), sb = sheet && !sheet.hidden ? sheet.getBoundingClientRect() : null, lg = this.legendInset();
    const top = Math.max(0, Math.min(sh * 0.35, (st?.bottom ?? 0) + 6)), bottom = sb ? Math.max(top + 120, sb.top - 6) : sh - 70, x = lg.left, wd = sw - lg.left - lg.right;
    this.r.setView(fitView(b, { x, y: top, w: Math.max(80, wd), h: bottom - top }, { w: sw, h: sh }));
  }
  /** The width the vertical legend takes from the left / right edge of the map (0 when it is not shown). */
  legendInset(): { left: number; right: number } { const el = document.getElementById("legend-side"); if (!el || el.hidden) return { left: 0, right: 0 }; const r = el.getBoundingClientRect(), left = this.legendSide === "left"; return { left: left ? r.width : 0, right: left ? 0 : r.width }; }
  legendSide: "left" | "right" = "right"; legendShown = false; private legendEl: HTMLElement | null = null;
  /** Stage 24: the vertical legend strip on the map's left or right edge (display only; the choice of side and whether it is shown are kept with the other display settings). */
  setLegendShown(v: boolean) { this.legendShown = v; this.saveUi(); this.drawLegendStrip(); this.buildToolbar(); }
  drawLegendStrip() {
    this.legendEl?.remove(); this.legendEl = null; if (!this.legendShown || !this.real || this.s.step < 5) return;
    const el = buildLegendStrip({ side: this.legendSide, swap: () => { this.legendSide = this.legendSide === "left" ? "right" : "left"; this.saveUi(); this.drawLegendStrip(); if (this.hl) this.fitHl(); }, close: () => this.setLegendShown(false), filters: () => this.openSheet("legend") });
    document.body.append(el); this.legendEl = el; this.placeLegend();
  }
  /** Between the status pills and the control panel at the bottom (measured: both change height). */
  placeLegend() { const el = this.legendEl; if (!el) return; const st = document.getElementById("status")?.getBoundingClientRect(), tw = document.getElementById("tools-wrap")?.getBoundingClientRect(); el.style.top = Math.round((st?.bottom ?? 120) + 4) + "px"; el.style.bottom = Math.round(window.innerHeight - (tw?.top ?? window.innerHeight - 200) + 4) + "px"; }
  clearHl(redraw = true) { if (!this.hl && !this.ledgerMini) return; this.hl = null; this.ledgerMini = false; if (redraw) { this.renderRoads(); this.buildSheet(); } }
  stepHl(dir: 1 | -1) { const l = this.hlList; if (!this.hl || !l.length) return; const i = l.findIndex((x) => x.id === this.hl!.id), n = l[i < 0 ? (dir > 0 ? 0 : l.length - 1) : (i + dir + l.length) % l.length]; this.hl = n; this.renderRoads(); this.buildSheet(); }
  openSheet(name: string | null) { if (this.hl && name !== "ledger") this.clearHl(false); this.sheet = this.sheet === name ? null : name; this.buildSheet(); this.renderRoads(); }
  buildUI() {
    const i = this.s.step;
    $("step-title").textContent = this.real ? (this.sim ? "酷道・腐道・未成線" : "酷道・腐道・未成線 — 開通の儀") : `${STEP_LABELS[this.stepId]}  (${i + 1}/${STEPS.length})`;
    ($("btn-prev") as HTMLButtonElement).disabled = i === 0;
    ($("btn-next") as HTMLButtonElement).disabled = i >= STEPS.length - 1;
    ($("btn-undo") as HTMLButtonElement).disabled = !this.store.canUndo; ($("btn-redo") as HTMLButtonElement).disabled = !this.store.canRedo;
    this.status(); this.buildToolbar(); this.buildSheet();
  }
  private tbtn(label: string, on: boolean, f: () => void, id?: string, mark = true) { return h("button", { id, type: "button", class: on ? "mode on" : "mode", "aria-pressed": on ? "true" : "false", onclick: f }, on && mark ? "✓ " + label : label); }
  private setTool(t: Tool) {
    if (this.setupTab && t !== "seatpick") { this.setupTab = null; this.seatMode = null; this.seatPick = null; this.r.seatPending = null; }   // choosing another tool folds the setup panel away
    this.tool = this.tool === t ? "view" : t; this.pending = null;
    if (this.tool !== "ridge-pick") this.ridgeSel = null; if (this.ridgeRedraw && !(this.tool === (this.ridgeRedraw.key === "ne" ? "ridge-ne" : "ridge-sw"))) this.ridgeRedraw = null;
    // Stage 11: the drawn ranges are shown on the terrain map only; editing them from the road map switches to the terrain map for the duration and switches back afterwards
    if (isRidgeTool(this.tool) && this.bg === "roadmap") { this.bgBeforeRidge = "roadmap"; this.setBg("terrain", false); this.toast("山脈の編集は地形図で行います(終わると道路図に戻ります)"); }
    else if (!isRidgeTool(this.tool) && this.bgBeforeRidge) { const b = this.bgBeforeRidge; this.bgBeforeRidge = null; this.setBg(b, false); }
    // Stage 10: choosing 北 / 南 for the first time takes the real Alps of that side out of the DEM (one Undo step brings them back; the other side is left alone)
    if ((this.tool === "ridge-ne" || this.tool === "ridge-sw") && !this.sim && !this.pendingSim) { const key = this.tool === "ridge-ne" ? "ne" : "sw"; if (!this.s.alpsRemoved?.[key] && this.commitEdit((s) => { s.alpsRemoved = { ...s.alpsRemoved, [key]: true }; })) this.toast(`${key === "ne" ? "北アルプス(飛騨山脈)" : "南アルプス(赤石山脈)"}の元の山体を地形から取り除きました。描いた山脈だけが障壁になります(元に戻すで復元)`); }
    this.buildToolbar(); this.render();
  }
  /** Stage 22: the list window lives on <body>; it stays only while the toolbar that owns it asks for it. */
  eraOpen = false; private radioShown = false;
  buildToolbar() { this.radioShown = false; this.buildToolbarInner(); if (!this.radioShown) closeRadio(); requestAnimationFrame(() => (this.legendEl ? this.placeLegend() : this.legendShown ? this.drawLegendStrip() : undefined)); }
  private buildToolbarInner() {
    if (this.sim && this.e22Pick) {   // Stage 22: choosing a 2200 seat on the map (the same tap, hint and 決定 / 取り消し / 戻る as at the start)
      const tb0 = $("toolbar"); tb0.replaceChildren(); const p = this.seatPick, label = { capital: "首都", sub: "副首都", palace: "皇居" }[this.e22Pick];
      tb0.append(h("div", { class: "note", id: "seat-map-hint" }, p ? `候補: ${seatPrefName(p.pref)} ${p.name ? `「${p.name}」` : ""}${p.claim ? `／${p.claim}` : ""}(まだ決まっていません)` : `2200年の${label}にしたい場所を地図の陸地でタップしてください`),
        h("div", { class: "grp" }, h("button", { id: "seat-confirm", type: "button", disabled: p ? null : "", onclick: () => this.confirmSeatPick() }, "決定"), h("button", { id: "seat-cancel", type: "button", onclick: () => this.cancelSeatPick() }, "取り消し"), h("button", { id: "seat-back", type: "button", onclick: () => this.endE22Map() }, "戻る")));
      return;
    }
    const tb = $("toolbar"); tb.replaceChildren(); tb.classList.remove("compact"); const st = this.stepId;
    const TOOL_NAMES: Record<Tool, string> = { seatpick: "首都・副首都・皇居の位置: 地図をタップ", "cer-kokudo1": "国道1号を描く", "cer-fudo1": "府道1号を描く", "cer-kokudo0": "国道0号を描く", pick: "風景JSON: 地点を選ぶ", why: "なぜ変化したか: 道路をタップ", view: "表示(パン・ズームのみ)", pull: "引っ張る", bulge: "膨らます", dent: "凹ます", move: "移動", feature: "琵琶湖/富士山の移動", "ridge-sw": "南西の山脈を描く", "ridge-ne": "北東の山脈を描く", "ridge-edit": "山脈の点を動かす", "ridge-pick": "山脈の区間を選ぶ" };
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
      g.append(this.tbtn("琵琶湖を回転対象", this.selFeature === "biwa", () => { this.selFeature = "biwa"; this.buildToolbar(); this.render(); }), this.tbtn("富士山を回転対象", this.selFeature === "fuji", () => { this.selFeature = "fuji"; this.buildToolbar(); this.render(); }));
      g.append(h("button", { id: "rot-l", onclick: () => this.rotateSel(1) }, "⟲5°"), h("button", { id: "rot-r", onclick: () => this.rotateSel(-1) }, "⟳5°"), h("button", { id: "suggest", onclick: () => this.suggestRanges() }, "標準の山脈"));
      tb.append(g);
    } else if (st === "terrain") {
      tb.append(h("div", { class: "grp" }, h("button", { id: "reseed", onclick: () => this.store.commit((s) => { s.seed = (s.seed * 1664525 + 1013904223) >>> 0; }) }, "地形の乱数を変える"), h("span", {}, `seed ${this.s.seed}`)));
    }
  }
  /** 限定の地形編集: the coastline stays the real one; only the capital, Fuji, Lake Biwa and the two Alps ranges can be set, until the first road. */
  private buildTerrainEdit(tb: HTMLElement) {
    const open = this.editOpen;
    const toggle = h("button", { id: "terrain-edit-toggle", type: "button", title: "海岸線は固定。最初の道を引くまで、富士山・琵琶湖・南北アルプスを変えられます", class: open ? "mode on" : "mode", "aria-pressed": open ? "true" : "false", onclick: () => { this.editOpen = !this.editOpen; this.editMore = false; if (!this.editOpen && this.tool !== "view" && !String(this.tool).startsWith("cer-")) this.tool = "view"; this.buildToolbar(); this.render(); } }, open ? "✕ 地形" : "地形編集");
    if (!open) { tb.append(toggle); return; }
    // Issue #20 (round 2): while editing, the whole toolbar is ONE short row -- [close] [targets] [undo/redo] [more]; the target's own controls appear only while it is
    // selected, and the rarely used ones (real Alps, clear, the note) sit behind "⋯". Nothing else (era, seats, ceremony) is shown until the editor is closed.
    const featOn = (f: "biwa" | "fuji") => this.tool === "feature" && this.selFeature === f;
    const featBtn = (f: "biwa" | "fuji", label: string) => this.tbtn(label, featOn(f), () => { if (featOn(f)) this.setTool("feature"); else { this.selFeature = f; this.tool = "feature"; this.pending = null; this.buildToolbar(); this.render(); } }, "sel-" + f, false);
    const tool = (t: Tool, l: string) => this.tbtn(l, this.tool === t, () => this.setTool(t), "tool-" + t, false);
    const ridgeOn = isRidgeTool(this.tool), ridges = this.editMore || ridgeOn;
    tb.append(h("div", { class: "grp", id: "edit-tools" }, toggle, featBtn("biwa", "琵琶湖"), featBtn("fuji", "富士山"),
      h("button", { id: "edit-more", type: "button", "aria-pressed": ridges ? "true" : "false", class: ridges ? "mode on" : "mode", onclick: () => { if (ridges) { this.editMore = false; if (ridgeOn) this.tool = "view"; } else this.editMore = true; this.buildToolbar(); this.render(); } }, "山脈"),
      h("button", { id: "edit-undo", type: "button", "aria-label": "元に戻す", disabled: !this.store.canUndo, onclick: () => this.undoEdit() }, "↶"), h("button", { id: "edit-redo", type: "button", "aria-label": "やり直す", disabled: !this.store.canRedo, onclick: () => this.redoEdit() }, "↷")));
    if (this.tool === "feature") {
      const f = this.selFeature, row = h("div", { class: "grp", id: "feature-size" }, h("button", { id: "rot-l", type: "button", "aria-label": "左に回転", onclick: () => this.rotateSel(1) }, "⟲"), h("button", { id: "rot-r", type: "button", "aria-label": "右に回転", onclick: () => this.rotateSel(-1) }, "⟳"));
      // Stage 11: [−][size][＋] sizes both axes together; [横−][横＋][縦−][縦＋] size the feature's own x / y axis alone (each up to 5x; the stretch turns with the feature, never shears it)
      const [fx, fy] = featureScales(this.s.features[f]), sizeTxt = fx === fy ? `×${fx}` : `横×${fx} 縦×${fy}`, fh = Math.round(fujiHeightFactor(this.s.features.fuji) * 100) / 100;
      const nm = f === "biwa" ? "琵琶湖" : "山体";
      const idLess = f === "biwa" ? "biwa-smaller" : "fuji-narrower", idMore = f === "biwa" ? "biwa-bigger" : "fuji-wider";   // the ids the buttons have always had
      row.append(h("button", { id: idLess, type: "button", "aria-label": `${nm}を小さく`, onclick: () => this.scaleFeature(f, "scale", 1 / 1.15) }, "−"), h("button", { class: this.axesOpen ? "tag mode on" : "tag", id: `${f}-size`, type: "button", title: "タップで縦横を別々に変える行を開く", "aria-pressed": this.axesOpen ? "true" : "false", onclick: () => { this.axesOpen = !this.axesOpen; this.buildToolbar(); } }, f === "biwa" ? sizeTxt : `${sizeTxt} 高さ×${fh}(${Math.round(JAPAN.fuji.summitM * fh)}m)`), h("button", { id: idMore, type: "button", "aria-label": `${nm}を大きく`, onclick: () => this.scaleFeature(f, "scale", 1.15) }, "＋"));
      if (f === "fuji") row.append(h("button", { id: "fuji-lower", type: "button", onclick: () => this.scaleFeature("fuji", "height", 1 / 1.1) }, "高−"), h("button", { id: "fuji-higher", type: "button", onclick: () => this.scaleFeature("fuji", "height", 1.1) }, "高＋"));
      tb.append(row, ...(!this.axesOpen ? [] : [h("div", { class: "grp", id: "feature-axes" }, h("button", { id: `${f}-x-less`, type: "button", "aria-label": "横を縮める", onclick: () => this.scaleFeature(f, "scale", 1 / 1.15, "x") }, "横−"), h("button", { id: `${f}-x-more`, type: "button", "aria-label": "横を伸ばす", onclick: () => this.scaleFeature(f, "scale", 1.15, "x") }, "横＋"), h("button", { id: `${f}-y-less`, type: "button", "aria-label": "縦を縮める", onclick: () => this.scaleFeature(f, "scale", 1 / 1.15, "y") }, "縦−"), h("button", { id: `${f}-y-more`, type: "button", "aria-label": "縦を伸ばす", onclick: () => this.scaleFeature(f, "scale", 1.15, "y") }, "縦＋"), h("small", { class: "tag" }, "縦横は別々に最大5倍(回転に従う)"))]));
    }
    if (ridges) tb.append(h("div", { class: "grp", id: "edit-more-row" }, tool("ridge-ne", "北"), tool("ridge-sw", "南"), tool("ridge-edit", "点"), tool("ridge-pick", "区間"), h("button", { id: "alps-real", type: "button", onclick: () => this.realAlps() }, "実アルプス"), h("button", { id: "alps-clear", type: "button", onclick: () => this.clearRanges() }, "消去"), h("small", { class: "tag", id: "terrain-edit-note" }, "海岸線は固定")));
    if (ridgeOn) {
      // Stage 11: the same three operations as for the 国道1号 -- 描く (北・南) / 点を動かす (点) / 区間を選ぶ (区間: 消す・描き直す); ↶ ↷ above undo every one of them
      const sel = this.ridgeSel, selTxt = sel ? `${sel.key === "ne" ? "北" : "南"}の山脈 区間${sel.si + 1}` : "";
      tb.append(h("div", { class: "note", id: "ridge-hint" }, this.tool === "ridge-edit" ? "点をつかんで動かします(線の上の白丸)" : this.tool === "ridge-pick" ? (sel ? `${selTxt}を選択中` : "線をタップして区間を選びます") : this.ridgeRedraw ? "選んだ区間を描き直してください。端が前の線につながります" : "大きい丸(線の端)から描くと続き、ほかの場所から描くと新しい線を足します。地形の作り直し中でも続けて描けます"));
      if (this.tool === "ridge-pick" && sel) tb.append(h("div", { class: "grp", id: "ridge-sel-row" }, h("button", { id: "ridge-del", type: "button", onclick: () => this.ridgeDeleteSel() }, `区間${sel.si + 1}を消す`), h("button", { id: "ridge-redraw", type: "button", onclick: () => this.ridgeRedrawSel() }, "描き直す")));
    }
    const errs = this.issues.filter((i) => i.severity === "error" && (i.step === "features")); if (errs.length) tb.append(h("div", { class: "note badc", id: "edit-errors" }, errs.slice(0, 2).map((e) => e.msg).join(" / ")));
  }
  /** Stage 26: the map switch (道路図 / 地形図) that stays at the end of the setup tab row whatever is being chosen -- it changes only the background; nothing chosen is touched. */
  private bgSwitch(): HTMLElement { const to = this.bg === "roadmap" ? "terrain" : "roadmap"; return h("button", { id: "setup-bg", type: "button", class: "setup-tab setup-bg", title: "地図の表示を切り替え", onclick: () => { this.setBg(to); this.buildToolbar(); } }, this.bg === "roadmap" ? "道路図" : "地形図"); }
  /** Stage 19: the four setup tabs in one row (元号 首都 副首都 皇居); only the pressed tab's panel is open, and pressing it again (or 閉じる) closes it. */
  private buildSetupTabs(tb: HTMLElement) {
    const st = seatsOf(this.s), tabs: ["era" | "capital" | "sub" | "palace", string][] = [["era", "元号"], ["capital", "首都"], ["sub", "副首都"], ["palace", "皇居"]];
    tb.append(h("div", { class: "setup-tabs", id: "setup-tabs", role: "tablist" }, ...tabs.map(([k, l]) => h("button", { id: "setup-tab-" + k, type: "button", role: "tab", class: "setup-tab" + (this.setupTab === k ? " on" : ""), "aria-selected": this.setupTab === k ? "true" : "false", onclick: () => this.openSetupTab(k) }, l)), this.bgSwitch()));
    const w = this.ensureWorld(), ll = (p: Vec) => { const [lo, la] = realToLonLat(p); return `東経${lo.toFixed(2)}° 北緯${la.toFixed(2)}°`; };
    const where = (which: "capital" | "sub" | "palace") => { const pos = which === "capital" ? this.s.capitalPos : which === "sub" ? this.s.subPos : this.s.palacePos; return `${seatPrefName(st[which])}${pos ? `(地図で指定 ${ll(pos)})` : "(県庁所在地)"}`; };
    if (!this.setupTab) return;   // closed: only the four tabs (each tab's own panel shows what is chosen)
    const panel = h("div", { id: "setup-panel" }), tab = this.setupTab;
    if (tab === "era") {
      panel.append(h("div", { class: "note", id: "era-now" }, `最初の元号: ${CAND_1945[this.firstEra]?.name ?? ""}`), h("button", { id: "era-open", type: "button", onclick: () => { this.eraOpen = true; this.buildToolbar(); } }, "元号を選ぶ"), h("div", { id: "era-desc", class: "note" }, eraDescText(this.firstEra)));
      if (this.eraOpen) { this.radioShown = true; showRadio({ id: "era-list", title: "最初の元号(1926年の候補)", groups: eraRadioGroups(this.firstEra, (i) => { this.firstEra = i; this.buildToolbar(); }), foot: [{ id: "rw-bg", label: this.bg === "roadmap" ? "地形図にする" : "道路図にする", act: () => { this.setBg(this.bg === "roadmap" ? "terrain" : "roadmap"); this.buildToolbar(); } }], close: () => { this.eraOpen = false; this.buildToolbar(); } }); }
      panel.append(h("div", { class: "grp", id: "bg-choice" }, h("span", {}, "地図の表示"), ...(["roadmap", "terrain"] as const).map((m) => h("button", { id: "bg-" + m, type: "button", class: this.bg === m ? "mode on" : "mode", "aria-pressed": this.bg === m ? "true" : "false", onclick: () => { this.setBg(m); this.buildToolbar(); } }, m === "roadmap" ? "道路図" : "地形図"))));
    } else {
      const which = tab, label = { capital: "首都", sub: "副首都", palace: "皇居" }[which];
      if (this.seatMode !== "map") {   // Stage 23: the early picker -- one <select> grouped by regional block -- and the way onto the map
        const other = which === "capital" ? st.sub : which === "sub" ? st.capital : null;
        panel.append(h("div", { class: "note", id: "seat-now" }, `${label}: ${where(which)}`), h("div", { class: "grp seat-pick" }, prefSelect("seat-sel-" + which, label, st[which], other, (pid) => (w ? seatCity(w, pid)?.name ?? "" : ""), (pid) => { this.setSeat(which, pid, true); }), h("button", { id: "pref-map", type: "button", onclick: () => this.chooseSeatMode("map") }, "地図で選ぶ")));
      }
      if (this.seatMode === "map") {
        const p = this.seatPick;
        panel.append(h("div", { class: "note", id: "seat-map-hint" }, p ? `候補: ${seatPrefName(p.pref)} ${p.name ? `「${p.name}」(最寄りの地名: ${p.near}${p.km ? ` ${p.km}km` : ""})` : ""} ${ll(p.w)}${p.claim ? `／${p.claim}(ゲーム内の府県は仮の設定)` : ""}(まだ決まっていません。地図をタップし直すと動かせます)` : `${label}にしたい場所を、地図の陸地でタップしてください(府県内ならどこでも。海は選べません)`));
        panel.append(h("div", { class: "row2" }, h("button", { id: "seat-confirm", type: "button", disabled: p ? null : "", onclick: () => this.confirmSeatPick() }, "決定"), h("button", { id: "seat-cancel", type: "button", onclick: () => { this.cancelSeatPick(); } }, "取り消し"), h("button", { id: "seat-back", type: "button", onclick: () => this.backToSeatList() }, "戻る")));
      }
      if ((which === "capital" && this.s.capitalPos) || (which === "sub" && this.s.subPos) || (which === "palace" && this.s.palacePos)) panel.append(h("div", { class: "note", id: "seat-current" }, `地図で指定: ${where(which)}`), h("button", { id: "seat-reset", type: "button", onclick: () => this.resetSeatPos(which) }, "県庁所在地に戻す"));
    }
    panel.append(h("button", { id: "setup-close", type: "button", onclick: () => this.openSetupTab(null) }, "✕ 設定欄を閉じる"));
    tb.append(panel);
  }
  private posOf(which: "capital" | "sub" | "palace") { return which === "capital" ? this.s.capitalPos : which === "sub" ? this.s.subPos : this.s.palacePos; }
  unlockMap() {
    if (this.sim && !confirm("地図の編集を再開すると、作成済みの道路とシミュレーションは消えます。よろしいですか?")) return;
    this.sim = null; this.pendingSim = null; this.cerDraft = {}; this.pin = null; this.store.unlock(); this.persist(); this.toast("ロックを解除しました");
  }
  private buildRoadToolbar(tb: HTMLElement, names: Record<Tool, string>) {
    const label = (t: string) => tb.append(h("div", { id: "mode-label", role: "status", "aria-live": "polite", "data-tool": this.tool }, t));
    if (!this.s.finalized || !this.terrain) { const bad = this.issues.some((i) => i.severity === "error"); label(!this.s.finalized ? "地図を最終確定すると道路を始められます" : bad ? "地図に不正があるため地形を作れません(元に戻すで直せます)" : "地形を生成中…"); if (bad && this.real && !this.sim) this.buildTerrainEdit(tb); return; }
    if (!this.sim) {
      if (this.real && this.editOpen) { tb.classList.add("compact"); this.buildTerrainEdit(tb); return; }   // the editor alone: nothing else competes with the map
      label(`選択中: ${names[this.tool]}`);
      if (this.real) this.buildSetupTabs(tb);
      else tb.append(h("div", { id: "era-note", class: "note" }, `${eraLabel(1950)}(1950年)開始。${ERA.note}。元号による政策差はごく小さな初期値のみです。`));
      if (this.real) this.buildTerrainEdit(tb);
      const g = h("div", { class: "grp" });
      for (const k of (this.real ? ["kokudo1"] : ["kokudo1", "fudo1"]) as CerKind[]) { const t = ("cer-" + k) as Tool, d = this.cerDraft[k], w2 = this.world; g.append(this.tbtn(this.real ? cerLabel(k, w2 ? homeCity(w2, seatsOf(this.s).capital) : null, w2 ? subCity(w2, seatsOf(this.s).sub) : null) + (d ? (d.prev.ok ? " 済" : " 要修正") : "") : CER_LABEL[k] + (d ? (d.prev.ok ? " 済" : " 要修正") : ""), this.tool === t, () => this.setTool(t), "tool-" + t)); }
      tb.append(g);
      for (const k of (this.real ? ["kokudo1"] : ["kokudo1", "fudo1"]) as CerKind[]) { const d = this.cerDraft[k], nat = d?.prev as NatPreview | undefined; if (d) tb.append(h("div", { id: "cer-status-" + k, class: "note " + (d.prev.ok ? "okc" : "badc") }, d.prev.ok ? `✓ ${this.real ? "国道1号" : CER_LABEL[k]}: 約${d.prev.lengthKm}km／終点: ${d.prev.endName}${nat?.ferries?.length ? `／フェリー${nat.ferries.length}本` : ""}${nat?.lakes?.length ? `／湖は${nat.lakes.map((l) => (l.kind === "bridge" ? "橋" : "湖上フェリー")).join("・")}で横断` : ""}${nat?.through?.length ? `／経由: ${nat.through.map((n) => n.replace(/市$/, "")).join("・")}` : ""}${nat?.spurs?.length ? `／取付路${nat.spurs.length}本` : ""}${nat?.reversed ? "／副首都側から描いた線を向き直しました" : ""}` : `✗ ${d.prev.reasons[0] ?? "経路を作れません"}`)); }
      const ak = this.tool === "cer-kokudo1" ? "kokudo1" : this.tool === "cer-fudo1" ? "fudo1" : null;
      // one compact row: [stroke count] undo / redo / restart / go -- the panel must stay short, or it covers the map being drawn on
      const dd = ak ? this.cerDraft[ak] : undefined, row = h("div", { class: "grp", id: "cer-controls" });
      if (ak) {   // Stage 9: draw / move control points / pick a stroke (then delete or redraw it)
        const mode = (m: "draw" | "move" | "pick", label: string) => h("button", { id: "cer-mode-" + m, type: "button", class: this.cerMode === m ? "mode on" : "mode", "aria-pressed": this.cerMode === m ? "true" : "false", onclick: () => { this.cerMode = m; if (m === "draw") this.cerSel = null; this.cerRedraw = null; this.buildUI(); this.renderRoads(); } }, label);
        const mrow = h("div", { class: "grp", id: "cer-modes" }, mode("draw", "描く"), mode("move", "点を動かす"), mode("pick", "区間を選ぶ"));
        if (this.cerMode === "pick" && this.cerSel !== null && dd) mrow.append(h("button", { id: "cer-del", type: "button", onclick: () => this.cerDeleteSel(ak) }, `区間${this.cerSel + 1}を消す`), h("button", { id: "cer-redraw", type: "button", onclick: () => this.cerRedrawSel() }, `区間${this.cerSel + 1}を描き直す`));
        if (this.cerRedraw !== null) mrow.append(h("span", { class: "note", id: "cer-redraw-note" }, `区間${this.cerRedraw + 1}を描き直し中`));
        tb.append(mrow);
      }
      if (ak) row.append(h("span", { class: "note", id: "cer-count" }, `線${dd?.strokes.length ?? 0}本`), h("button", { id: "cer-undo", type: "button", disabled: !dd?.past.length, onclick: () => this.cerUndo(ak) }, "↶ 戻す"), h("button", { id: "cer-redo", type: "button", disabled: !dd?.redo.length, onclick: () => this.cerRedo(ak) }, "↷ やり直す"), h("button", { id: "cer-restart", type: "button", disabled: !dd, onclick: () => this.cerRestart(ak) }, "最初から"));
      row.append(h("button", { id: "cer-go", type: "button", disabled: !this.cerReady(), onclick: () => void this.doCeremony() }, "開通の儀を行う")); tb.append(row);
      return;
    }
    label(`選択中: ${names[this.tool]}`);
    const sp = h("div", { class: "grp" });
    for (const [n, l] of [[0, "停止"], [1, "×1"], [5, "×5"], [20, "×20"]] as [0 | 1 | 5 | 20, string][]) sp.append(this.tbtn(l, this.sim.speed === n, () => this.setSpeed(n), "speed-" + n));
    tb.append(sp);
    if (this.sim.e2200?.state === "road0") {   // Stage 22: 国道0号 -- drawn like 国道1号, either way round; opened by its own ceremony
      const d0 = this.cerDraft.kokudo0, nat0 = d0?.prev as NatPreview | undefined, g0 = h("div", { class: "grp", id: "road0-row" });
      g0.append(this.tbtn("国道0号を描く" + (d0 ? (d0.prev.ok ? " 済" : " 要修正") : ""), this.tool === "cer-kokudo0", () => this.setTool("cer-kokudo0"), "tool-cer-kokudo0"), h("button", { id: "road0-go", type: "button", disabled: d0?.prev.ok ? null : "", onclick: () => this.openRoad0(false) }, "開通の儀(国道0号)"), h("button", { id: "road0-skip", type: "button", onclick: () => this.openRoad0(true) }, "国道0号はつくらない"));
      if (d0) g0.append(h("button", { id: "road0-undo", type: "button", disabled: !d0.past.length, onclick: () => this.cerUndo("kokudo0") }, "↶"), h("button", { id: "road0-restart", type: "button", onclick: () => this.cerRestart("kokudo0") }, "描き直す"));
      tb.append(g0); if (d0) tb.append(h("div", { id: "cer-status-kokudo0", class: "note " + (d0.prev.ok ? "okc" : "badc") }, d0.prev.ok ? `✓ 国道0号: 約${d0.prev.lengthKm}km${nat0?.ferries?.length ? `／フェリー${nat0.ferries.length}本` : ""}${nat0?.through?.length ? `／経由: ${nat0.through.map((n) => n.replace(/市$/, "")).join("・")}` : ""}(既存の道・旧道・廃道を優先して転用)` : `✗ ${d0.prev.reasons[0] ?? "経路を作れません"}`));
    }
    const g = h("div", { class: "grp" });
    if (this.real) {
      g.append(h("button", { id: "btn-legend", type: "button", "aria-pressed": this.legendShown ? "true" : "false", class: this.legendShown ? "mode on" : "mode", onclick: () => this.setLegendShown(!this.legendShown) }, "凡例"),
        h("button", { id: "btn-bg", type: "button", "aria-pressed": this.bg === "roadmap" ? "true" : "false", class: this.bg === "roadmap" ? "mode on" : "mode", onclick: () => this.setBg(this.bg === "roadmap" ? "terrain" : "roadmap") }, this.bg === "roadmap" ? "✓ 道路地図" : "背景:地形"));
      tb.append(g); const gw = h("div", { class: "grp" }); gw.append(this.tbtn("なぜ?(線路・道路をタップ)", this.tool === "why", () => this.setTool("why"), "tool-why")); tb.append(gw); return;
    }
    g.append(h("button", { id: "btn-history", type: "button", onclick: () => this.openSheet("history") }, "年表"), h("button", { id: "btn-roads", type: "button", onclick: () => this.openSheet("roads") }, "路線一覧"), h("button", { id: "btn-legend", type: "button", onclick: () => this.openSheet("legend") }, "凡例"));
    tb.append(g);
    const g2 = h("div", { class: "grp" }); g2.append(this.tbtn("なぜ?(道路をタップ)", this.tool === "why", () => this.setTool("why"), "tool-why"), this.tbtn("風景JSON", this.tool === "pick", () => this.setTool("pick"), "tool-pick")); tb.append(g2);
  }
  buildSheet() {
    const sh = $("sheet"), body = $("sheet-body");
    const mini = this.sheet === "ledger" && !!this.hl && this.ledgerMini, key = this.sheet + ":" + mini + ":" + ui3.ledgerMode + ":" + ui3.numClass, keep = this.sheetKey === key ? sh.scrollTop : 0; this.sheetKey = key;   // (Stage 24: the same list is rebuilt after a tap: it stays where the finger left it)
    sh.hidden = this.sheet === null; sh.classList.toggle("mini", mini); sh.classList.toggle("mini-num", mini && ui3.ledgerMode === "numbers"); body.replaceChildren(); if (!this.sheet) return;
    queueMicrotask(() => { if (keep) sh.scrollTop = keep; });
    if (this.sheet === "layers") {
      body.append(h("h3", {}, "表示レイヤー"));
      const wrap = h("div", { class: "row" });
      for (const k of this.s.step === 6 ? [...LAYER_KEYS, ...ROAD_LAYER_KEYS] : LAYER_KEYS) wrap.append(h("label", { class: "layer" }, h("input", { type: "checkbox", id: "layer-" + k, checked: this.s.layers[k], onchange: (e: Event) => { const v = (e.target as HTMLInputElement).checked; this.store.set((s) => { s.layers[k] = v; if (!s.layersSet?.includes(k)) s.layersSet = [...(s.layersSet ?? []), k]; }); } }), LAYER_LABELS[k]));
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
    else if (this.sheet === "why") this.buildWhy(body);
    else if (this.sheet === "menu") this.buildMenu(body);
    else if (this.sheet === "timeline") buildTimeline(this, body);
    else if (this.sheet === "ledger") buildLedger(this, body);
    else if (this.sheet === "atlas") buildAtlas(this, body);
    else if (this.sheet === "policy") buildPolicy(this, body);
    else if (this.sheet === "kaigen") buildKaigen(this, body);
    else if (this.sheet === "e2200") buildE2200(this, body);
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
    if (this.real) { this.buildLegend23(body); return; }   // Stage 23: three axes (kind, tier, state); the classic legend below stays for the map-making game
    if (this.real) {
      const det = h("details", { id: "legend-ops", ...(this.legendOpen ? { open: "" } : {}) }, h("summary", {}, "表示の切替(地図に即反映・保存されます)")) as HTMLDetailsElement;
      det.addEventListener("toggle", () => { this.legendOpen = det.open; this.saveUi(); });
      const chk = (id: string, label: string, on: boolean, fn: (v: boolean) => void) => h("label", { class: "layer" }, h("input", { type: "checkbox", id, checked: on, onchange: (e: Event) => fn((e.target as HTMLInputElement).checked) }), label);
      const grp = (title: string, items: HTMLElement[]) => det.append(h("div", { class: "legend-group" }, h("b", {}, title), ...items));
      grp("種類", [chk("lg-roads", "道路", this.s.layers.roads, (v) => this.store.set((s) => { s.layers.roads = v; })), chk("lg-rail", "鉄道", this.s.layers.rail, (v) => this.store.set((s) => { s.layers.rail = v; })), chk("lg-ferry", "フェリー航路", !this.hide.has("fac:ferry"), () => this.toggleHide("fac:ferry")), chk("lg-names", "路線名の文字(全路線)", this.names, (v) => { this.names = v; this.saveUi(); this.renderRoads(); })]);
      grp("港湾・空港・航路・都市", [chk("lg-econ", "都市の丸(金の輪=首都)と都市圏", this.s.layers.econ ?? true, (v) => this.store.set((s) => { s.layers.econ = v; })), chk("lg-ports", "港湾", this.s.layers.ports, (v) => this.store.set((s) => { s.layers.ports = v; })), chk("lg-airports", "空港", this.s.layers.airports, (v) => this.store.set((s) => { s.layers.airports = v; })), chk("lg-lanes", "国内空路", this.s.layers.lanes, (v) => this.store.set((s) => { s.layers.lanes = v; })), chk("lg-lake", "湖上フェリー", !this.hide.has("fac:lake"), () => this.toggleHide("fac:lake"))]);
      // Stage 9: the map shows kinds; the administrative grades stay in the ledger, the route details and the history
      const K: [string, string][] = [["road", "道路"], ["hwy", "高速道路"], ["rail", "鉄道"], ["hsr", "新幹線"], ["maglev", "リニア"]];
      grp("道路・鉄道の種類", K.map(([k, l]) => chk("lg-k-" + k, l, !this.hide.has("k:" + k), () => this.toggleHide("k:" + k))));
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
    row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#2f8fd8" stroke-width="3" stroke-dasharray="7 5"/>`, "青の破線: フェリー航路(海の上。道路ではありません)"); row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#1b3f8f" stroke-width="2.4" stroke-dasharray="7 5"/>`, "紺の破線: 鉄道連絡船");
    body.append(h("h3", {}, "道路・鉄道の種類"));
    row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#3d3d3d" stroke-width="6"/><line x1="2" y1="7" x2="62" y2="7" stroke="#5bd66b" stroke-width="3.5"/>`, "道路(国道・府県道などの区分は台帳と路線の詳細に記録)");
    row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#0b7a3e" stroke-width="8"/><line x1="2" y1="7" x2="62" y2="7" stroke="#5bd66b" stroke-width="4.5"/><line x1="2" y1="7" x2="62" y2="7" stroke="#fff" stroke-width="1"/>`, "高速道路(緑の縁取り＋白い中心線)");
    row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#fff" stroke-width="6"/><line x1="2" y1="7" x2="62" y2="7" stroke="#12284d" stroke-width="3.5"/><line x1="2" y1="7" x2="62" y2="7" stroke="#fff" stroke-width="2.5" stroke-dasharray="4 5"/>`, "鉄道(国鉄・私鉄の区別は台帳と路線の詳細に記録)");
    row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#fff" stroke-width="7"/><line x1="2" y1="7" x2="62" y2="7" stroke="#1e6fd9" stroke-width="5"/><line x1="2" y1="7" x2="62" y2="7" stroke="#fff" stroke-width="1.2"/>`, "新幹線(青＋白い中心線)");
    row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#fff" stroke-width="7"/><line x1="2" y1="7" x2="62" y2="7" stroke="#a52fd0" stroke-width="5"/><line x1="2" y1="7" x2="62" y2="7" stroke="#fff" stroke-width="1.6" stroke-dasharray="6 4"/>`, "リニア(紫＋白い破線。2000年以降、技術が追いつけば)");
    body.append(h("h3", {}, "港湾・空港・航路"));
    row(`<rect x="6" y="4" width="6" height="6" fill="#4f95d6" stroke="#fff"/><rect x="26" y="1" width="11" height="11" fill="#0f3f8c" stroke="#fff"/>`, "四角: 港(小=地方・重要港湾、大=国際拠点港湾以上)");
    row(`<text x="6" y="12" font-size="11" fill="#fff" stroke="#222" stroke-width="0.5">✈</text><text x="30" y="13" font-size="16" fill="#ffc83a" stroke="#222" stroke-width="0.5">✈</text>`, "飛行機: 空港(小=地方空港、大＝金色=国際ハブ空港)");
    row(`<path d="M2 10 Q20 2 34 8 T62 6" fill="none" stroke="#2f8fd8" stroke-width="3" stroke-dasharray="7 5"/>`, "青の破線: 国内のフェリー航路(海岸から離れた海の上を通る)。国際航路は計算だけで、地図には描きません");
    body.append(h("h3", {}, "建設計画"));
    row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#39d6c8" stroke-width="3" stroke-dasharray="2 4"/>`, "水色の点線: 計画"); row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#3aa0ff" stroke-width="3" stroke-dasharray="7 4"/>`, "青の破線: 工事中"); row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#ff8f1f" stroke-width="3" stroke-dasharray="7 4"/>`, "橙の破線: 中断"); row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#b04bff" stroke-width="3" stroke-dasharray="7 4"/>`, "紫の破線: 未成線");
    body.append(h("h3", {}, "比較表示の縁取り"));
    row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#ff3b3b" stroke-width="8" stroke-opacity=".6"/>`, "赤: 品質が大きく低下"); row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#111" stroke-width="8" stroke-opacity=".6"/>`, "黒: 休止・閉鎖・廃道に悪化"); row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#39a0ff" stroke-width="8" stroke-opacity=".6"/>`, "青: 基準年にはなかった道路"); row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#39e08a" stroke-width="8" stroke-opacity=".6"/>`, "緑: 改善・復旧");
    if (this.real) {
      body.append(h("h3", {}, "鉄道(紺の線＋白い点線)"));
      row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#fff" stroke-width="6"/><line x1="2" y1="7" x2="62" y2="7" stroke="#12284d" stroke-width="3.5"/><line x1="2" y1="7" x2="62" y2="7" stroke="#fff" stroke-width="2.5" stroke-dasharray="4 5"/>`, "紺: 供用中(状態が悪いほど灰色に近づく)");
      row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#3a4f78" stroke-width="3.5" stroke-dasharray="10 6"/>`, "紺の長い破線: 運休(利用がほぼゼロ)");
      row(`<line x1="2" y1="7" x2="62" y2="7" stroke="#9aa4ad" stroke-width="2" stroke-dasharray="5 4"/>`, "灰色の破線: 廃止 ／ 極細の点線: 廃線跡");
      body.append(h("small", {}, "鉄道の標識: 紺の四角=国鉄「鉄N」、白地に枠=私鉄(事業者名の頭文字＋番号)。通称「酷鉄」(国鉄)・「死鉄」(私鉄)は、利用が少なく保守が行き届かない線に後から付く呼び名で、正式名称ではありません。"));
    }
    body.append(h("small", {}, "標識: 国=丸(赤)・県=角丸(緑)・府=五角形(紫)。通称(酷・険・腐)は荒れた細い道に後から付く呼び名で、行政指定ではありません。"));
  }
  /** Stage 23: the legend of the real game on three axes -- kind (6) × tier (メイン/サブ/ローカル = thick/medium/thin) × state (供用中/計画/廃線/未成 = the line style) -- with one sample per value, not one per combination.
   *  What the game keeps inside (休止, 旧道, 工事中, 中断, 廃道 ...) is drawn as before and named under the four states; the switches act on exactly those keys. */
  private buildLegend23(body: HTMLElement) {
    const det = h("details", { id: "legend-ops", ...(this.legendOpen ? { open: "" } : {}) }, h("summary", {}, "表示の切替(地図に即反映・保存されます)")) as HTMLDetailsElement;
    det.addEventListener("toggle", () => { this.legendOpen = det.open; this.saveUi(); });
    const chk = (id: string, label: string, on: boolean, fn: (v: boolean) => void) => h("label", { class: "layer" }, h("input", { type: "checkbox", id, checked: on, onchange: (e: Event) => fn((e.target as HTMLInputElement).checked) }), label);
    const multi = (id: string, label: string, keys: string[]) => chk(id, label, !keys.every((k) => this.hide.has(k)), () => { const allHidden = keys.every((k) => this.hide.has(k)); for (const k of keys) { if (allHidden) this.hide.delete(k); else this.hide.add(k); } this.saveUi(); this.renderRoads(); this.buildSheet(); });
    const grp = (title: string, items: HTMLElement[]) => det.append(h("div", { class: "legend-group" }, h("b", {}, title), ...items));
    grp("交通種別", [multi("lg-k-road", "道路", ["k:road"]), multi("lg-k-hwy", "高速道路", ["k:hwy"]), multi("lg-k-rail", "鉄道", ["k:rail"]), multi("lg-k-hsr", "新幹線(リニア含む)", ["k:hsr", "k:maglev"]), multi("lg-ferry", "海路(国内)", ["fac:ferry", "fac:lake"]), chk("lg-lanes", "空路(国内)", this.s.layers.lanes, (v) => this.store.set((s) => { s.layers.lanes = v; }))]);
    grp("状態", [multi("lg-s-open", "供用中(休止を含む)", ["st:open", "st:dormant"]), multi("lg-s-planned", "計画(構想・計画・工事中・中断)", ["st:concept", "st:planned", "st:building", "st:suspended"]), multi("lg-s-lost", "廃線(閉鎖・廃道・遺構)", ["st:closed", "st:lost"]), multi("lg-s-unbuilt", "未成", ["st:unbuilt"])]);
    grp("そのほか", [chk("lg-econ", "都市の丸(金の輪=首都、紫の輪=政令特区・政令指定都市)と都市圏", this.s.layers.econ ?? true, (v) => this.store.set((s) => { s.layers.econ = v; })), chk("lg-ports", "港湾", this.s.layers.ports, (v) => this.store.set((s) => { s.layers.ports = v; })), chk("lg-airports", "空港", this.s.layers.airports, (v) => this.store.set((s) => { s.layers.airports = v; })), chk("lg-names", "路線名の文字(全路線)", this.names, (v) => { this.names = v; this.saveUi(); this.renderRoads(); })]);
    body.append(det);
    body.append(h("small", { id: "legend-note" }, "凡例(線のサンプル)は、地図の端の縦長の帯に出ます。メニューの「凡例」ボタンで出し入れし、帯の ◀▶ で左右を切り替えます。ここは、地図に出す種類と状態を切り替える画面です。休止・旧道・工事中・中断・廃道などの細かな状態は、ゲームの内部では区別したまま記録され、線の描き方も従来どおりです(凡例が4状態にまとめているだけです)。"));
    body.append(h("div", { class: "row" }, h("button", { id: "legend-open-strip", type: "button", onclick: () => { this.setLegendShown(true); this.openSheet(null); } }, "縦長の凡例を出す")));
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
    const pfx = this.real ? "s3:" : "", slots = [1, 2, 3, 4, 5].map((i) => `${pfx}slot${i}`), have = new Set(await listSlots()), metas = await Promise.all(slots.map((n) => (have.has(n) ? slotMeta(n) : Promise.resolve(null))));
    const NUM = ["①", "②", "③", "④", "⑤"];   // Stage 23: one line a slot -- number, the capital and sub-capital OF THAT SAVE, the year it was saved, 保存 / 読込
    slots.forEach((n, i) => {
      const m = metas[i], used = have.has(n), text = m ? `${m.capital} / ${m.sub} / ${m.year === null ? "開始前" : m.year + "年"}` : used ? "(読めないデータ)" : "(空)";
      body.append(h("div", { class: "slot-row", id: "slot-" + (i + 1) }, h("span", { class: "slot-no" }, NUM[i]), h("span", { class: "slot-text" + (used ? "" : " empty"), title: text }, text),
        h("button", { class: "slot-save", onclick: async () => { if (used && !confirm(`${NUM[i]}は使用中です(${text})。上書きしますか?`)) return; this.toast((await saveGame(n, makeSave(this.s, this.sim ?? this.pendingSim))) ? "セーブしました" : "セーブできません(ブラウザの保存が無効)"); this.buildSheet(); } }, "保存"),
        h("button", { class: "slot-load", disabled: !used, onclick: async () => { const l = await loadGame(n); if (l) this.adopt(l); else this.toast("ロードできません"); } }, "読込")));
    });
    if (this.real) await this.buildCheckpoints(body);
    body.append(h("div", { class: "row" },
      h("button", { id: "export", onclick: () => this.exportFile() }, "JSONエクスポート"),
      h("label", {}, "JSON読込 ", h("input", { type: "file", accept: ".json,application/json", id: "import", onchange: async (e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return; const p = parseSave(await f.text()); if (!p.ok) { this.toast("読み込めません: " + p.problems[0]); return; } this.adopt(p); } }))));
    if (this.s.finalized) body.append(h("div", { class: "row" }, this.real ? "" : h("button", { id: "unlock-menu", onclick: () => this.unlockMap() }, "地図のロックを解除して編集"), this.sim ? h("button", { id: "restart-roads", onclick: () => { if (confirm("道路を消して開通の儀からやり直します(地図は維持)。よろしいですか?")) { this.sim = null; this.cerDraft = {}; this.persist(); this.go(6); this.onChange(); } } }, "道路だけやり直す") : h("small", {}, "")));
    if (this.stepId === "confirm") {
      const errs = this.issues.filter((i) => i.severity === "error").length, ready = errs === 0 && !!this.terrain;
      body.append(h("h3", {}, "最終確定"));
      body.append(h("div", { class: "row" }, h("button", { id: "finalize", disabled: !ready, onclick: () => this.finalize() }, this.s.finalized ? "確定済み(再確定)" : "この地図を最終確定"), h("small", {}, ready ? "確定すると地理IDと座標変換APIが固定されます" : errs ? "不正を直してください" : "地形生成の完了を待ってください")));
      if (this.terrain) { const t = this.terrain.stats; body.append(h("small", {}, `陸地${t.landCells}セル / 河川${t.riverCount}本 / 府県${t.prefCount} / 都市補正${t.citiesMoved} / hash ${this.terrain.hash}`)); }
    }
    body.append(h("div", { class: "row" }, h("button", { id: "reset", onclick: () => { if (confirm("初期状態に戻します。よろしいですか?")) { this.sim = null; this.pendingSim = null; this.cerDraft = {}; this.store.replace(this.real ? realState(this.s.seed) : defaultState(this.s.seed)); this.r.fit(this.s); } } }, "最初からやり直す")));
  }
  /** Stage 26: the 自動セーブポイント list -- year, 50-year or just-before-relocation, the seats it was saved with; 読込 continues the game from there. Kept apart from the numbered slots. */
  private async buildCheckpoints(body: HTMLElement) {
    const list = await listCheckpoints(idbCpStore); body.append(h("h3", { id: "cp-title" }, "自動セーブポイント"));
    body.append(h("small", { id: "cp-note" }, "50年ごと(2000年〜)と、150年ごとの遷都イベントの直前に自動で作られます。①〜⑤とは別です。最大8件で、古いものから自動で消えます。"));
    if (!list.length) { body.append(h("div", { class: "slot-row", id: "cp-empty" }, h("span", { class: "slot-text empty" }, "(まだありません)"))); return; }
    const mb = (e: CpEntry) => `${(e.bytes / 1048576).toFixed(1)}MB`;
    for (const e of list) {
      const label = e.kind === "reloc" ? `${e.year}年 遷都の直前(第${e.n ?? "?"}回)` : `${e.year}年 50年ごと`, text = `${label} / ${e.capital} / ${e.sub} / ${mb(e)}`;
      body.append(h("div", { class: "slot-row cp-row", id: `cp-${e.year}-${e.kind}` }, h("span", { class: "slot-text", title: text }, text),
        h("button", { class: "slot-load cp-load", onclick: async () => { if (!confirm(`${label}から再開します。今のゲームは、保存していなければ失われます。よろしいですか?`)) return; const j = await readCheckpoint(idbCpStore, e); if (!j) { this.toast("読み込めません(データが見つかりません)"); return; } const p = parseSave(j); if (p.ok && p.sim) this.adopt(p); else this.toast("読み込めません: " + (p.problems[0] ?? "壊れたデータ")); } }, "読込")));
    }
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
