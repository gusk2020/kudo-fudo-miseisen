/**
 * Stage 23: choosing a line to see on the map. One piece of code serves both ways in: a row of the ledger and a number of the 路線番号一覧 are turned into the same HlTarget
 * (the edges the game still has the position of, plus the two ends of a flight) and handed to App.toggleHl. Choosing never changes the game: it only says which edges to draw in the highlight colour.
 * While a line is chosen the ledger shrinks to a small bar (name, ◀ ▶ to the next line of the list, 解除, 通常サイズ) so the map stays visible.
 */
import type { App } from "./app";
import { h } from "./app";
import { NUM_CLASSES, NUM_STATE_LABEL, chipOf, entryOf, maxNumber, type ChipKind, type NumClass, type NumEntry } from "../sim/numreg";
import { routeLabel } from "../sim/engine";
import type { SimProject, SimRoute, SimState } from "../sim/types";
import type { Vec } from "../core/types";
import type { World } from "../sim/world";

export interface HlTarget { id: string; label: string; edges: string[]; air?: [Vec, Vec] }
export const targetOfRoute = (r: SimRoute): HlTarget => ({ id: "r:" + r.id, label: routeLabel(r), edges: [...r.edges.map((x) => x.edgeId), ...r.oldEdges] });
export const targetOfProject = (sim: SimState, p: SimProject): HlTarget => ({ id: "p:" + p.id, label: `${sim.nodes[p.from]?.name ?? "地点"}〜${sim.nodes[p.to]?.name ?? "地点"}`, edges: p.edgeIds });
export function targetOfEdges(id: string, label: string, edges: string[]): HlTarget { return { id, label, edges }; }
const className = (c: NumClass) => NUM_CLASSES.find((x) => x[0] === c)![1];
/** The same target for a numbered line, from the register: the route's current edges when it is one, else the edges last known; a flight or sea lane between two cities gets its two ends only if both are known. */
export function targetOfEntry(sim: SimState, w: World | null, cls: NumClass, en: NumEntry): HlTarget {
  let edges = en.edges.slice(); if (en.key.startsWith("r:")) { const r = sim.routes[en.key.slice(2)]; if (r) edges = [...r.edges.map((x) => x.edgeId), ...r.oldEdges]; }
  const t: HlTarget = { id: en.key, label: `${className(cls)}${en.n}号 ${en.label}`, edges };
  if (en.ends && w) { const a = w.cityById.get(en.ends[0])?.pos, b = w.cityById.get(en.ends[1])?.pos; if (a && b) { t.air = [a, b]; t.label = `${className(cls)}${en.n}号 ${w.cityById.get(en.ends[0])!.name}〜${w.cityById.get(en.ends[1])!.name}`; } }
  return t;
}

export const CHIP_GLYPH: Record<ChipKind, string> = { active: "●", planned: "◐", unbuilt: "▲", abolished: "×", void: "欠", revived: "★", gap: "欠" };
export const CHIP_LABEL: Record<ChipKind, string> = { active: "供用中", planned: "計画中", unbuilt: "未成", abolished: "廃線", void: "欠番(統合)", revived: "復活", gap: "欠番" };
const PAGE = 100;

/** The small bar the ledger becomes while a line is chosen. */
export function buildMini(app: App, body: HTMLElement) {
  const t = app.hl!;
  body.append(h("div", { class: "led-mini", id: "led-mini" }, h("b", { id: "led-mini-name" }, t.label),
    h("div", { class: "row" },
      h("button", { id: "hl-prev", type: "button", onclick: () => app.stepHl(-1) }, "◀"), h("button", { id: "hl-next", type: "button", onclick: () => app.stepHl(1) }, "▶"),
      h("button", { id: "hl-clear", type: "button", onclick: () => app.clearHl() }, "解除"), h("button", { id: "hl-full", type: "button", onclick: () => { app.ledgerMini = false; app.buildSheet(); } }, "通常サイズ")),
    h("small", {}, t.edges.length || t.air ? "地図の桃色の線が選んだ路線です(位置の分かる範囲だけ)" : "この路線は位置の記録が残っていないため、地図には描けません")));
}

/** 台帳の先頭の切替: 通常台帳 / 路線番号一覧. */
export function modeBar(app: App, mode: "normal" | "numbers", set: (m: "normal" | "numbers") => void): HTMLElement {
  return h("div", { class: "row", id: "led-modes" }, ...(["normal", "numbers"] as const).map((m) => h("button", { id: "led-mode-" + m, type: "button", class: mode === m ? "mode on" : "mode", "aria-pressed": mode === m ? "true" : "false", onclick: () => { if (mode !== m) { app.clearHl(false); set(m); app.buildSheet(); } } }, m === "normal" ? "通常台帳" : "路線番号一覧")));
}

/** 路線番号一覧: the six classes, each counted from 1; a page of at most 100 numbers at a time. */
export function buildNumberList(app: App, body: HTMLElement, st: { numClass: NumClass; numPage: number }) {
  const sim = app.sim!, reg = sim.numreg; const w = app.world;
  body.append(h("small", {}, "分類ごとに1番から。一度発行された番号は別の路線に使い回されません。番号をタップすると地図で強調します(もう一度で解除)。"));
  body.append(h("div", { class: "row", id: "num-classes" }, ...NUM_CLASSES.map(([c, l]) => h("button", { id: "num-cls-" + c, type: "button", class: st.numClass === c ? "mode on" : "mode", "aria-pressed": st.numClass === c ? "true" : "false", onclick: () => { app.clearHl(false); st.numClass = c; st.numPage = 0; app.buildSheet(); } }, l))));
  if (!reg) { body.append(h("div", { class: "issue" }, "番号の記録は次の年の初めに作られます")); return; }
  const cls = st.numClass, max = maxNumber(sim, cls), list = reg.list[cls], by = new Map(list.map((e) => [e.n, e]));
  const count: Record<ChipKind, number> = { active: 0, planned: 0, unbuilt: 0, abolished: 0, void: 0, revived: 0, gap: 0 };
  for (let n = 1; n <= max; n++) count[chipOf(by.get(n))]++;
  body.append(h("div", { class: "issue", id: "num-summary" }, `${className(cls)}: 最大発行番号 ${max} ／ 供用中${count.active + count.revived}(うち復活${count.revived}) ・計画中${count.planned} ・未成${count.unbuilt} ・廃線${count.abolished} ・欠番${count.void + count.gap}${list.some((e) => e.est) ? " ／ ※一部は旧データから推定した番号です" : ""}`));
  const pages = Math.max(1, Math.ceil(max / PAGE)); st.numPage = Math.min(st.numPage, pages - 1);
  if (pages > 1) body.append(h("div", { class: "row", id: "num-pages" }, ...Array.from({ length: pages }, (_, k) => h("button", { id: "num-pg-" + k, type: "button", class: st.numPage === k ? "mode on" : "mode", onclick: () => { st.numPage = k; app.buildSheet(); } }, `${k * PAGE + 1}–${Math.min(max, (k + 1) * PAGE)}`))));
  const grid = h("div", { class: "num-grid", id: "num-grid" }), targets: HlTarget[] = [], lo = st.numPage * PAGE + 1, hi = Math.min(max, lo + PAGE - 1);
  const ns: number[] = []; if (cls === "road" && by.has(0) && st.numPage === 0) ns.push(0); for (let n = lo; n <= hi; n++) ns.push(n);
  for (const n of ns) {
    const en = by.get(n), k = chipOf(en), on = !!en && app.hl?.id === en.key;
    const chip = h("button", { id: `num-${cls}-${n}`, type: "button", class: `chip ${k}${on ? " sel" : ""}`, title: `${className(cls)}${n}号 ${CHIP_LABEL[k]}`, onclick: () => {
      if (!en) { app.toast(`${className(cls)}${n}号は欠番です(対応する路線はありません)`); return; }
      const all = list.filter((e) => e.state !== "void").map((e) => targetOfEntry(sim, w, cls, e)); app.toggleHl(targetOfEntry(sim, w, cls, en), all);
    } }, h("span", { class: "g" }, CHIP_GLYPH[k]), String(n));
    grid.append(chip); if (en && en.state !== "void") targets.push(targetOfEntry(sim, w, cls, en));
  }
  body.append(grid, h("small", { id: "num-key" }, "● 供用中　◐ 計画中　▲ 未成　× 廃線　★ 復活　欠 欠番"));
  const sel = list.find((e) => app.hl?.id === e.key);
  if (sel) body.append(h("div", { class: "issue", id: "num-detail" }, `${className(cls)}${sel.n}号 ${sel.label}`, h("br"), h("small", {}, `${NUM_STATE_LABEL[sel.state]}${sel.revived ? `(${sel.revived}年に復活)` : ""} ／ ${sel.est ? "推定" : ""}${sel.since}年〜 ／ 履歴: ${sel.hist.map((x) => `${x.y}年${NUM_STATE_LABEL[x.s]}`).join(" → ")}`)));
}
