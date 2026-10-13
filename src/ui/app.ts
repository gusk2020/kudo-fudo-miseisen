import { worldToPostOps, worldParts } from "../core/body";
import { axisFrame, tOf } from "../core/constraints";
import { ISLAND_LABEL } from "../core/data";
import { dist, pointInPolygon, rot as rotv, simplifyLine } from "../core/geom";
import { exportJson, listSlots, loadSlot, parseState, saveSlot } from "../core/save";
import { Store, featureWorldPos, LAYER_KEYS, LAYER_LABELS, defaultState } from "../core/state";
import { suggestRidge } from "../core/suggest";
import type { TerrainResult } from "../core/terrain";
import { TerrainClient } from "../core/terrainClient";
import { GeoMap } from "../core/geoid";
import { STEPS, STEP_LABELS, type IslandId, type Issue, type Op, type Place, type StepId, type Vec } from "../core/types";
import { clampOp } from "../core/warp";
import { derive, errorsFor, validate } from "../core/validate";
import { Renderer, type Pending } from "../render/renderer";
import { attachGestures } from "./gestures";

type Tool = "view" | "pull" | "bulge" | "dent" | "move" | "feature" | "ridge-sw" | "ridge-ne" | "ridge-edit";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
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

  static async start(host: HTMLElement) {
    const a = new App(); a.r = await Renderer.create(host);
    const saved = await loadSlot("auto");
    if (saved) { a.store.replace(saved.state); if (saved.problems.length) a.toast("一部の保存データを修復しました: " + saved.problems.slice(0, 2).join(" / ")); }
    attachGestures(a.r.app.canvas, a.r, a.handler());
    a.store.subscribe(() => a.onChange());
    a.bindStatic(); a.r.fit(a.store.state); a.onChange(true);
    (window as any).__kfm = a;
    window.addEventListener("resize", () => a.r.setView({}, true));
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
    if (this.s.step >= 4 && !this.terrain && !this.generating) { clearTimeout(this.genTimer); this.genTimer = setTimeout(() => this.generate(), initial ? 0 : 250); }
    this.render(); this.buildUI();
    clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => saveSlot("auto", this.s), 400);
  }
  render() { this.r.update(this.s, this.terrain, this.issues, this.pending); }
  async generate() {
    if (errorsFor(this.issues, "honshu").length || errorsFor(this.issues, "islands").length || errorsFor(this.issues, "features").length) { this.status(); return; }
    const key = stateKey(this.s); this.generating = true; this.genProgress = 0; this.status();
    try {
      const res = await this.client.generate(JSON.parse(JSON.stringify(this.s)), (p) => { this.genProgress = p; this.status(); });
      if (stateKey(this.s) !== key) return;
      this.terrain = res; this.terrainKey = key;
    } catch (e: any) { if (String(e?.message) !== "cancelled") this.toast("地形生成に失敗: " + e?.message); }
    this.generating = false; this.render(); this.buildUI();
  }
  status() {
    const el = $("status"); el.replaceChildren();
    const add = (t: string, c = "") => el.append(h("span", { class: c }, t));
    const errs = this.issues.filter((i) => i.severity === "error" && STEPS.indexOf(i.step) <= Math.min(this.s.step, 3));
    if (this.generating) add(`地形生成中 ${Math.round(this.genProgress * 100)}%`);
    if (errs.length) add(`⚠ 不正 ${errs.length}件`, "bad");
    else if (this.s.step > 0) add("✓ 検証OK", "ok");
    if (this.s.finalized) add("確定済み", "ok");
    $("dock-issues").classList.toggle("warn", errs.length > 0);
    $("dock-issues").textContent = errs.length ? `検証(${errs.length})` : "検証";
  }

  // ---------- navigation ----------
  canAdvance(): boolean {
    const i = this.s.step; if (i >= STEPS.length - 1) return false;
    for (let k = 1; k <= Math.min(i, 3); k++) if (errorsFor(this.issues, STEPS[k]).length) return false;
    return true;
  }
  go(n: number) { n = Math.max(0, Math.min(STEPS.length - 1, n)); this.tool = "view"; this.store.set((s) => { s.step = n; }); if (n === 2 && this.activeBody === "honshu") this.activeBody = "hokkaido"; if (n === 1) this.activeBody = "honshu"; }

  // ---------- editing tools ----------
  private bodyForTool(): IslandId { return this.s.step === 1 ? "honshu" : this.activeBody; }
  private editable() { return this.tool !== "view" && !this.generating; }
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
    this.pending = null;
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

  // ---------- UI ----------
  bindStatic() {
    $("btn-prev").onclick = () => this.go(this.s.step - 1);
    $("btn-next").onclick = () => { if (this.canAdvance()) this.go(this.s.step + 1); else { this.openSheet("issues"); this.toast("不正を直すと次の工程へ進めます"); } };
    $("btn-undo").onclick = () => { if (!this.store.undo()) this.toast("取り消せる操作がありません"); };
    $("btn-redo").onclick = () => this.store.redo();
    $("btn-fit").onclick = () => { this.r.fit(this.s); };
    document.querySelectorAll<HTMLButtonElement>("#dock [data-sheet]").forEach((b) => (b.onclick = () => this.openSheet(b.dataset.sheet!)));
    $("sheet-close").onclick = () => this.openSheet(null);
  }
  openSheet(name: string | null) { this.sheet = this.sheet === name ? null : name; this.buildSheet(); }
  buildUI() {
    const i = this.s.step;
    $("step-title").textContent = `${STEP_LABELS[this.stepId]}  (${i + 1}/${STEPS.length})`;
    ($("btn-prev") as HTMLButtonElement).disabled = i === 0;
    ($("btn-next") as HTMLButtonElement).disabled = i >= STEPS.length - 1;
    ($("btn-undo") as HTMLButtonElement).disabled = !this.store.canUndo; ($("btn-redo") as HTMLButtonElement).disabled = !this.store.canRedo;
    this.status(); this.buildToolbar(); this.buildSheet();
  }
  private tbtn(label: string, on: boolean, f: () => void, id?: string) { return h("button", { id, "aria-pressed": on, onclick: f }, label); }
  private setTool(t: Tool) { this.tool = this.tool === t ? "view" : t; this.pending = null; this.buildToolbar(); }
  buildToolbar() {
    const tb = $("toolbar"); tb.replaceChildren(); const st = this.stepId;
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
  buildSheet() {
    const sh = $("sheet"), body = $("sheet-body");
    sh.hidden = this.sheet === null; body.replaceChildren(); if (!this.sheet) return;
    if (this.sheet === "layers") {
      body.append(h("h3", {}, "表示レイヤー"));
      const wrap = h("div", { class: "row" });
      for (const k of LAYER_KEYS) wrap.append(h("label", { class: "layer" }, h("input", { type: "checkbox", id: "layer-" + k, checked: this.s.layers[k], onchange: (e: Event) => { const v = (e.target as HTMLInputElement).checked; this.store.set((s) => { s.layers[k] = v; }); } }), LAYER_LABELS[k]));
      body.append(wrap, h("small", {}, "河川・府県境・標高は「1E 地形生成」以降に表示されます。"));
    } else if (this.sheet === "issues") {
      body.append(h("h3", {}, "検証結果"));
      body.append(h("div", { class: "row" }, h("button", { id: "revalidate", onclick: () => { this.terrain = null; this.terrainKey = ""; this.onChange(); this.toast("再検証しました"); } }, "全工程を再検証")));
      if (!this.issues.length) body.append(h("div", { class: "issue" }, "問題はありません"));
      for (const is of this.issues) body.append(h("div", { class: "issue " + is.severity }, `[${STEP_LABELS[is.step]}] ${is.msg}`));
      if (this.terrain?.warnings.length) { body.append(h("h3", {}, "地形生成の記録(簡易近似の限界)")); for (const w of this.terrain.warnings) body.append(h("div", { class: "issue warn" }, w)); }
      if (this.s.step < 3 && this.issues.some((i) => i.step === "features" || i.step === "islands")) body.append(h("small", {}, "後続工程の不整合は、その工程に進んで直してください。"));
    } else if (this.sheet === "menu") this.buildMenu(body);
  }
  async buildMenu(body: HTMLElement) {
    body.append(h("h3", {}, "セーブ / ロード / 出力"));
    const slots = ["slot1", "slot2", "slot3"], have = new Set(await listSlots());
    for (const n of slots) body.append(h("div", { class: "row" }, `${n.replace("slot", "スロット")}${have.has(n) ? " (使用中)" : ""}`,
      h("button", { onclick: async () => this.toast((await saveSlot(n, this.s)) ? "セーブしました" : "セーブできません(ブラウザの保存が無効)") }, "セーブ"),
      h("button", { disabled: !have.has(n), onclick: async () => { const l = await loadSlot(n); if (l) { this.store.replace(l.state); this.r.fit(l.state); this.toast("ロードしました" + (l.problems.length ? "(一部修復)" : "")); } else this.toast("ロードできません"); } }, "ロード")));
    body.append(h("div", { class: "row" },
      h("button", { id: "export", onclick: () => this.exportFile() }, "JSONエクスポート"),
      h("label", {}, "JSON読込 ", h("input", { type: "file", accept: ".json,application/json", id: "import", onchange: async (e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return; const p = parseState(await f.text()); if (!p.ok) { this.toast("読み込めません: " + p.problems[0]); return; } this.store.replace(p.state); this.r.fit(p.state); this.toast("読み込みました" + (p.problems.length ? ` (修復${p.problems.length}件)` : "")); } }))));
    if (this.stepId === "confirm") {
      const errs = this.issues.filter((i) => i.severity === "error").length, ready = errs === 0 && !!this.terrain;
      body.append(h("h3", {}, "最終確定"));
      body.append(h("div", { class: "row" }, h("button", { id: "finalize", disabled: !ready, onclick: () => this.finalize() }, this.s.finalized ? "確定済み(再確定)" : "この地図を最終確定"), h("small", {}, ready ? "確定すると地理IDと座標変換APIが固定されます" : errs ? "不正を直してください" : "地形生成の完了を待ってください")));
      if (this.terrain) { const t = this.terrain.stats; body.append(h("small", {}, `陸地${t.landCells}セル / 河川${t.riverCount}本 / 府県${t.prefCount} / 都市補正${t.citiesMoved} / hash ${this.terrain.hash}`)); }
    }
    body.append(h("div", { class: "row" }, h("button", { id: "reset", onclick: () => { if (confirm("初期状態に戻します。よろしいですか?")) { this.store.replace(defaultState(this.s.seed)); this.r.fit(this.s); } } }, "最初からやり直す")));
  }
  finalize() {
    if (!this.terrain || this.issues.some((i) => i.severity === "error")) return;
    this.store.set((s) => { s.finalized = true; }); saveSlot("auto", this.s); this.toast("最終確定しました。JSONエクスポートで書き出せます");
  }
  exportFile() {
    const geo = this.s.finalized && this.terrain ? new GeoMap(this.s, this.terrain).summary() : undefined;
    const blob = new Blob([exportJson(this.s, { geo })], { type: "application/json" });
    const a = h("a", { href: URL.createObjectURL(blob), download: this.s.finalized ? "kfm-map-final.json" : "kfm-map-draft.json" });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
}
export { tOf };
