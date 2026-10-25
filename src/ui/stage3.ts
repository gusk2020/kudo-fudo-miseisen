/** Stage 3 panels: era choice, timeline, route ledger, transport atlas (year slider), policy window. Plain DOM, built only when opened. */
import type { RadioGroup } from "./radioWin";
import type { App } from "./app";
import { h } from "./app";
import { DIAL_LABEL, DIAL_KEYS, ERAS, SELECTABLE_ERAS, composeDials, type EraKey } from "../sim/eras";
import { effectText } from "../sim/events";
import { prefName, routeLabel } from "../sim/engine";
import { codesAt, numberHistory } from "../sim/ledger";
import { CAND_1945, ERA_GROUPS, ERA_GROUP_LABEL, ERA_GROUP_NOTE, STANCE_LABEL, eraGroup, type EraCand } from "../sim/kaigen";
import { potentialWeights } from "../sim/potential17";
import { reconText } from "../sim/recon";
import { homeCity, subCity } from "../sim/ceremony";
import { ECO_LABEL, ECO_PARTS, mainCause } from "../sim/econ";
import { displayName } from "../sim/straits";
import { FACILITY_LABEL, ZONE_LABEL, facLevel, tierHistory, wardPops } from "../sim/tier23";
import { yearOf } from "../sim/engine";
import { AIR_KIND_LABEL, PORT_CAP, PORT_TIER_LABEL, airName, foreignName, hubsAt, portName } from "../sim/hubs";
import { DOMAIN_LABEL, POLICIES, skipWindow, POLICY_MODE_LABEL, POINTS_PER_WINDOW, ADOPT_BAR, baseScores, boostOf, computeEnv, resolveWindow, topFive, type Domain, type PolicyMode } from "../sim/policy";
import { GRADE_MODE, KIND_LABEL, PROJECT_LABEL, STATE_LABEL, modeOf, monthToYM, type SimRoute, type SimState } from "../sim/types";

export const ui3 = { tl: "all", tlN: 60, ledger: "road" as "road" | "rail" | "fac" | "gone", ledgerN: 40, open: new Set<string>(), spend: {} as Record<string, number>, domain: null as Domain | null };
const ym = (sim: SimState, m: number) => { const { year, month } = monthToYM(sim.startYear, m); return `${year}年${month}月`; };
const bar = (v: number) => "■".repeat(Math.round(Math.max(0, Math.min(1, v)) * 10)) + "□".repeat(10 - Math.round(Math.max(0, Math.min(1, v)) * 10));

/** What is particular to one candidate (the group heading already says the transport policy): the reconstruction policy of a first-era name, "暫定" for a name made by the game's rule. */
const specific = (c: EraCand) => c.recon ? reconText(c.recon) : c.real ? "" : "暫定規則の名";
/** Stage 20: the first-era list -- a heading per transport group (said once), one candidate per line with only its own condition, the chosen line blue. */
export function eraPicker(app: App, tb: HTMLElement, current: number, pick: (i: number) => void) {
  const c = CAND_1945[current] ?? CAND_1945[0], box = h("div", { id: "era-list", class: "era-list-box scroll", role: "listbox", "aria-label": "最初の元号" });
  for (const g of ERA_GROUPS) {
    const idx = CAND_1945.map((x, i) => i).filter((i) => eraGroup(CAND_1945[i].stance) === g); if (!idx.length) continue;
    box.append(h("div", { class: "era-head" }, h("b", {}, ERA_GROUP_LABEL[g]), h("span", {}, ERA_GROUP_NOTE[g])));
    for (const i of idx) box.append(h("button", { type: "button", id: "era-opt-" + i, role: "option", class: "era-row" + (i === current ? " on" : ""), "aria-selected": String(i === current), "aria-pressed": String(i === current), onclick: () => pick(i) }, h("b", {}, `${i === current ? "✔ " : ""}${CAND_1945[i].name}`), h("span", {}, specific(CAND_1945[i]))));
  }
  tb.append(box, h("div", { id: "era-desc", class: "note" }, c.recon ? `復興方針: ${reconText(c.recon)}(1945年の最初の元号だけが持ち、1950年以降の人口・産業・予算・建設の優先度に長く効く。太平洋側・日本海側は実際の海の位置で決まる)` : c.note));
  void app;
}
/** Stage 22: the candidates of 1926 as list-window groups (one heading per transport group, said once; each name with only its own condition below it). */
export function eraRadioGroups(current: number, pick: (i: number) => void): RadioGroup[] {
  return ERA_GROUPS.map((g) => ({ head: ERA_GROUP_LABEL[g], note: ERA_GROUP_NOTE[g], items: CAND_1945.map((c, i) => ({ c, i })).filter((x) => eraGroup(x.c.stance) === g).map(({ c, i }) => ({ id: "era-opt-" + i, label: c.name, desc: specific(c) || undefined, on: i === current, pick: () => pick(i) })) })).filter((g) => g.items.length);
}
export const eraDescText = (current: number) => { const c = CAND_1945[current] ?? CAND_1945[0]; return c.recon ? `復興方針: ${reconText(c.recon)}(1945年の最初の元号だけが持ち、1950年以降の人口・産業・予算・建設の優先度に長く効く)` : c.note; };
/** The era-change sheet: opens by itself when a kaigen is due; time is stopped until a name is chosen. */
export function buildKaigen(app: App, body: HTMLElement) {
  const sim = app.sim, k = sim?.kaigen; if (!sim || !k) { body.append(h("small", {}, "このデータには改元の仕組みがありません(旧形式のセーブ)")); return; }
  body.append(h("h3", {}, "改元"));
  body.append(h("div", { class: "issue", id: "kaigen-current" }, h("b", {}, `現在の元号: ${k.eras[k.eras.length - 1].name}`)));
  body.append(h("div", { class: "issue", id: "kaigen-history" }, "元号の履歴: " + k.eras.map((e) => `${e.name}(${e.start}〜)`).join(" → "), ...(k.recon ? [h("br"), h("small", { id: "kaigen-recon" }, `復興方針(1945年に決定・以後も持続): ${reconText(k.recon)}`)] : [])));
  if (!k.pending) { body.append(h("div", { class: "issue" }, `次の改元: ${k.next}年ごろ(27〜33年間隔の暫定規則)`)); return; }
  const p = k.pending, real = p.year === 1989 || p.year === 2019;
  body.append(h("div", { class: "issue warn", id: "kaigen-window" }, `${p.year}年: 新しい元号を選んでください。時間は止まっています。`, h("br"), h("small", {}, real ? "候補は史実でこの年に挙がった案です(最初が実際に選ばれた元号)。方針の割り当てはゲーム上の仮のものです。" : "候補は暫定の生成規則による名前です(いろは順の漢字化+改元年の干支、画数の少ない順)。実在の元号ではありません。")));
  {   // Stage 19: a heading per transport group, one candidate per line (name -- main effect); the candidates of the same group are together
    const box = h("div", { id: "kaigen-box", class: "era-list-box" });
    for (const g of ERA_GROUPS) {
      const idx = p.cands.map((c, i) => i).filter((i) => eraGroup(p.cands[i].stance) === g); if (!idx.length) continue;
      box.append(h("div", { class: "era-head", id: "kaigen-group-" + g }, h("b", {}, ERA_GROUP_LABEL[g]), h("span", {}, ERA_GROUP_NOTE[g])));
      for (const i of idx) { const c = p.cands[i]; box.append(h("button", { type: "button", id: "kaigen-pick-" + i, class: "era-row", title: c.note, onclick: () => app.chooseKaigen(i) }, h("b", {}, c.name), h("span", {}, specific(c)))); }
    }
    body.append(box);
  }
  body.append(h("small", {}, "これまでの元号の方針は、新しい元号のあとも一部が残って効き続けます。"));
}

const KIND_FILTER: Record<string, (k: string) => boolean> = {
  all: () => true, world: (k) => k === "world", domestic: (k) => k === "domestic" || k === "reform", policy: (k) => k === "policy",
  road: (k) => ["bypass", "route", "demote", "promote", "close", "dormant", "reopen", "crossing"].includes(k), rail: (k) => ["abolish", "reform"].includes(k), hub: (k) => ["port", "air", "lane", "ferry"].includes(k), city: (k) => k === "city" || k === "village" || k === "boom",
};
const FILTER_LABEL: Record<string, string> = { all: "すべて", world: "世界", domestic: "国内", policy: "政策", road: "道路", rail: "鉄道・事業者", hub: "港湾・空港", city: "人口" };
export function buildTimeline(app: App, body: HTMLElement) {
  body.append(h("h3", {}, "年表(新しい順・原因つき)")); const sim = app.sim; if (!sim) { body.append(h("small", {}, "開通の儀のあとに記録されます")); return; }
  if (sim.kaigen) body.append(h("div", { class: "issue", id: "era-line" }, "元号: " + sim.kaigen.eras.map((e) => `${e.name}(${e.start}〜)`).join(" → "), h("br"), h("small", {}, sim.kaigen.pending ? "改元の選択待ち" : `次の改元: ${sim.kaigen.next}年ごろ`)));
  const row = h("div", { class: "row" });
  for (const k of Object.keys(FILTER_LABEL)) row.append(h("button", { id: "tl-" + k, class: ui3.tl === k ? "mode on" : "mode", "aria-pressed": ui3.tl === k ? "true" : "false", onclick: () => { ui3.tl = k; ui3.tlN = 60; app.buildSheet(); } }, FILTER_LABEL[k]));
  body.append(row, h("small", {}, "【史実】=実際の歴史／【架空】=この世界線だけの出来事／【予測モデル】=2027年以降の確率的な想定"));
  if (sim.skippedMonths) body.append(h("div", { class: "issue warn" }, `放置により合計${Math.floor(sim.skippedMonths / 12)}年${sim.skippedMonths % 12}か月分の経過を省略しています`));
  const f = KIND_FILTER[ui3.tl] ?? KIND_FILTER.all, list = [...sim.events].reverse().filter((e) => (ui3.tl === "rail" ? /鉄|線|電|事業者|国鉄/.test(e.text) : f(e.kind)));
  for (const e of list.slice(0, ui3.tlN)) body.append(h("div", { class: "issue" }, `${ym(sim, e.month)} ${e.text}`, h("br"), h("small", {}, `原因・理由: ${e.cause}`)));
  if (list.length > ui3.tlN) body.append(h("button", { id: "tl-more", onclick: () => { ui3.tlN += 60; app.buildSheet(); } }, `さらに表示(残り${list.length - ui3.tlN}件)`));
}

function routeKm(sim: SimState, r: SimRoute) { return Math.round(r.edges.reduce((a, x) => a + (sim.edges[x.edgeId]?.lengthKm ?? 0), 0)); }
export function buildLedger(app: App, body: HTMLElement) {
  body.append(h("h3", {}, "路線台帳")); const sim = app.sim; if (!sim) { body.append(h("small", {}, "開通の儀のあとに記録されます")); return; }
  const tabs = h("div", { class: "row" });
  for (const [k, l] of [["road", "道路"], ["rail", "鉄道"], ["fac", "トンネル・橋・航路"], ["gone", "計画・廃止・廃墟跡"]] as const) tabs.append(h("button", { id: "led-" + k, class: ui3.ledger === k ? "mode on" : "mode", "aria-pressed": ui3.ledger === k ? "true" : "false", onclick: () => { ui3.ledger = k; ui3.ledgerN = 40; app.buildSheet(); } }, l));
  body.append(tabs, h("small", {}, "番号は一度使われたら再利用されません(同じ路線の復活を除く)。行をタップすると番号・管理主体・区間の履歴が開きます。"));
  const item = (r: SimRoute) => {
    const es = r.edges.map((x) => sim.edges[x.edgeId]).filter(Boolean), q = Math.round(es.reduce((a, e) => a + e.quality, 0) / (es.length || 1)), open = ui3.open.has(r.id);
    const st = r.active ? (es.some((e) => e.state === "dormant") ? "一部休止" : "運用中") : "廃止", d = h("div", { class: "issue" + (r.active ? "" : " warn"), id: "led-" + r.id, onclick: () => { open ? ui3.open.delete(r.id) : ui3.open.add(r.id); app.buildSheet(); } },
      `${routeLabel(r)} ${routeKm(sim, r)}km 品質${q} [${st}]`, h("br"), h("small", {}, r.history[0]?.text ?? ""));
    if (open) for (const x of numberHistory(sim, r)) d.append(h("div", { class: "hist" }, `${x.year}年 ${x.label} — ${x.text}`));
    if (open && r.oldEdges.length) d.append(h("div", { class: "hist" }, `旧道区間${r.oldEdges.length}`));
    if (open) d.append(h("button", { class: "mini", id: "focus-" + r.id, onclick: (ev: Event) => { ev.stopPropagation(); app.focusRoute(r.id); } }, "地図で見る"));
    return d;
  };
  if (ui3.ledger === "road") {
    const rs = Object.values(sim.routes).filter((r) => modeOf(r) === "road" && r.active).sort((a, b) => (a.grade === b.grade ? a.scope.localeCompare(b.scope) || a.number - b.number : a.grade === "national" ? -1 : a.grade === "fu" ? -1 : 1));
    body.append(h("h3", {}, `道路 ${rs.length}路線(国道${rs.filter((r) => r.grade === "national").length})`)); for (const r of rs.slice(0, ui3.ledgerN)) body.append(item(r));
    if (rs.length > ui3.ledgerN) body.append(h("button", { onclick: () => { ui3.ledgerN += 40; app.buildSheet(); } }, `さらに表示(残り${rs.length - ui3.ledgerN})`));
  } else if (ui3.ledger === "rail") {
    const ops = Object.values(sim.operators).sort((a, b) => (a.kind === "jnr" ? -1 : b.kind === "jnr" ? 1 : a.name.localeCompare(b.name)));
    let shown = 0;
    for (const o of ops) {
      const rs = Object.values(sim.routes).filter((r) => modeOf(r) === "rail" && r.history.some((x) => (x.opName ?? "") === o.name) || (modeOf(r) === "rail" && r.op === o.id)).filter((r, i, a) => a.indexOf(r) === i).sort((a, b) => Number(b.active) - Number(a.active) || a.number - b.number); if (!rs.length) continue;
      body.append(h("h3", {}, `${o.name}(${o.kind === "jnr" ? "国有" : o.kind === "tertiary" ? "第三セクター" : "民間"}) ${o.since}年〜${o.until ?? ""} ${rs.filter((r) => r.active).length}路線`));
      for (const r of rs) { if (shown++ >= ui3.ledgerN) break; body.append(item(r)); }
    }
    if (shown > ui3.ledgerN) body.append(h("button", { onclick: () => { ui3.ledgerN += 40; app.buildSheet(); } }, "さらに表示"));
  } else if (ui3.ledger === "fac") {
    const fs = Object.values(sim.edges).filter((e) => e.facility).sort((a, b) => b.lengthKm - a.lengthKm);
    body.append(h("h3", {}, `トンネル・橋・フェリー航路 ${fs.length}(長いものを個別の施設として管理。航路は道路ではなく、海の上の連絡として別に扱う)`));
    for (const e of fs.slice(0, ui3.ledgerN)) body.append(h("div", { class: "issue" + (e.state === "open" || e.built < 1 ? "" : " warn"), id: "fac-" + e.id }, `${displayName(e)} ${Math.round(e.lengthKm * 10) / 10}km [${modeOf(e) === "rail" ? "鉄道" : "道路"}・${e.built < 1 ? "工事中" : STATE_LABEL[e.state]}]`, h("br"), h("small", {}, e.hist[e.hist.length - 1]?.t ?? `${prefName(e.region)}`)));
    if (!fs.length) body.append(h("small", {}, "まだありません。新しい路線が山地や広い河川を越えると現れます。"));
  } else {
    const act = Object.values(sim.projects).filter((p) => p.status === "concept" || p.status === "planned" || p.status === "building" || p.status === "suspended"); body.append(h("h3", {}, `構想・計画・工事中 ${act.length}`));
    for (const p of act.slice(-25).reverse()) { const part = p.status === "building" && p.edgeIds.some((id) => (sim.edges[id]?.built ?? 0) >= 1) && p.edgeIds.some((id) => (sim.edges[id]?.built ?? 1) < 1); body.append(h("div", { class: "issue" }, `[${part ? "部分開通" : PROJECT_LABEL[p.status]}/${modeOf(p) === "rail" ? "鉄道" : "道路"}${KIND_LABEL[p.kind]}] ${sim.nodes[p.from]?.name ?? "地点"}〜${sim.nodes[p.to]?.name ?? "地点"} (${Math.round((p.spentBu / (p.costBu || 1)) * 100)}%)`, h("br"), h("small", {}, `${ym(sim, p.startMonth)}〜 ${p.reason}`))); }
    const gone = Object.values(sim.routes).filter((r) => !r.active); body.append(h("h3", {}, `廃止された路線 ${gone.length}`)); for (const r of gone.slice(0, ui3.ledgerN)) body.append(item(r));
    const proj = Object.values(sim.projects).filter((p) => p.status !== "open" && p.status !== "building" && p.status !== "planned" && p.status !== "concept"); body.append(h("h3", {}, `未成・中断・取りやめ ${proj.length}`));
    for (const p of proj.slice(-30).reverse()) body.append(h("div", { class: "issue warn" }, `[${PROJECT_LABEL[p.status]}/${modeOf(p) === "rail" ? "鉄道" : "道路"}${KIND_LABEL[p.kind]}] ${sim.nodes[p.from]?.name ?? "地点"}〜${sim.nodes[p.to]?.name ?? "地点"} (${Math.round((p.spentBu / (p.costBu || 1)) * 100)}%)`, h("br"), h("small", {}, `${ym(sim, p.startMonth)}〜 ${p.reason}`)));
    const ruins = Object.values(sim.edges).filter((e) => e.state === "lost" && e.built >= 1); body.append(h("h3", {}, `廃道・廃線跡 ${ruins.length}`));
    for (const e of ruins.slice(0, 30)) body.append(h("div", { class: "issue" }, `${modeOf(e) === "rail" ? "廃線跡" : "廃道"} ${sim.nodes[e.a]?.name ?? "地点"}〜${sim.nodes[e.b]?.name ?? "地点"} ${Math.round(e.lengthKm)}km (${prefName(e.region)})`, h("br"), h("small", {}, e.hist[e.hist.length - 1]?.t ?? "")));
  }
}

export function buildAtlas(app: App, body: HTMLElement) {
  body.append(h("h3", {}, "交通地図帳(年代スライダー)")); const sim = app.sim; if (!sim) { body.append(h("small", {}, "開通の儀のあとに使えます")); return; }
  const years = sim.snaps.map((s) => s.year), cur = app.viewYear;
  body.append(h("small", {}, "過去の年を選ぶと、その年の道路・鉄道を表示します。閲覧中は時間が止まり、歴史は書き換わりません。"));
  if (years.length < 2) { body.append(h("small", {}, "5年ごとに記録されます。しばらく進めてから開いてください。")); return; }
  const idx = cur === null ? years.length - 1 : Math.max(0, years.indexOf(cur)), slider = h("input", { type: "range", id: "atlas-slider", min: 0, max: years.length - 1, step: 1, value: idx, oninput: (e: Event) => { const i = +(e.target as HTMLInputElement).value; label.textContent = `${years[i]}年`; }, onchange: (e: Event) => { const i = +(e.target as HTMLInputElement).value; app.setViewYear(i === years.length - 1 && cur === null ? null : years[i]); } }) as HTMLInputElement;
  const label = h("b", { id: "atlas-year" }, `${years[idx]}年`);
  body.append(h("div", { class: "row" }, label, slider));
  body.append(h("div", { class: "row" }, h("button", { id: "atlas-now", onclick: () => app.setViewYear(null) }, "現在に戻る"),
    h("button", { id: "atlas-diff", class: app.compareYear ? "mode on" : "mode", "aria-pressed": app.compareYear ? "true" : "false", onclick: () => { app.compareYear = app.compareYear ? null : (cur ?? years[0]); app.renderRoads(); app.buildSheet(); } }, app.compareYear ? "✓ 差分表示(今との違い)" : "差分表示(今との違い)")));
  const codes = codesAt(sim.snaps, cur ?? years[years.length - 1]);
  if (codes) {
    let rk = 0, rl = 0, sk = 0, sl = 0, lost = 0, plan = 0;
    for (const e of Object.values(sim.edges)) { const c = codes[e.id]; if (c === undefined) continue; const st = c >> 4, rail = modeOf(e) === "rail"; if (st === 0) rail ? (rl += e.lengthKm) : (rk += e.lengthKm); else if (st === 4) plan++; else if (st === 3) lost++; else sk += rail ? 0 : 0; void sl; }
    body.append(h("div", { class: "issue", id: "atlas-summary" }, `${cur ?? "現在"}年: 道路${Math.round(rk).toLocaleString()}km・鉄道${Math.round(rl).toLocaleString()}km(供用中) ／ 計画・工事中${plan}区間 ／ 廃道・廃線跡${lost}区間`));
  }
  buildTrends(sim, body); buildHubAtlas(app, sim, body, cur); buildCityEconomy(app, sim, body, cur); if (cur === null) buildCityTiers(app, sim, body);
  if (cur !== null) body.append(h("div", { class: "issue warn", id: "atlas-readonly" }, `${cur}年を閲覧中(読み取り専用・時間は停止)。操作したい場合は「現在に戻る」を押してください。`));
}

/**
 * Stage 7: 交通の移り変わり -- the network's length and the railway's share of travel, year by year, from what the game already records each year
 * (sim.stats). Two small line charts drawn as inline SVG, plus the latest turning points (lines given up, works frozen, new links) so the curves have reasons.
 */
const SVGNS = "http://www.w3.org/2000/svg";
function lineChart(id: string, title: string, series: { label: string; color: string; pts: [number, number][] }[], max: number, fmt: (v: number) => string): HTMLElement {
  const W = 340, H = 120, L = 34, R = 6, T = 8, B = 18, x0 = Math.min(...series.flatMap((s) => s.pts.map((p) => p[0]))), x1 = Math.max(...series.flatMap((s) => s.pts.map((p) => p[0])));
  const X = (x: number) => L + ((x - x0) / Math.max(1, x1 - x0)) * (W - L - R), Y = (v: number) => T + (1 - v / (max || 1)) * (H - T - B);
  const svg = document.createElementNS(SVGNS, "svg"); svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("width", "100%"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", title); svg.id = id;
  const el = (tag: string, a: Record<string, string | number>, text?: string) => { const n = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(a)) n.setAttribute(k, String(v)); if (text) n.textContent = text; svg.appendChild(n); return n; };
  for (const f of [0, 0.5, 1]) { el("line", { x1: L, x2: W - R, y1: Y(max * f), y2: Y(max * f), stroke: "#5a6b78", "stroke-width": 0.5 }); el("text", { x: L - 3, y: Y(max * f) + 3, "text-anchor": "end", "font-size": 9, fill: "#c9d8e4" }, fmt(max * f)); }
  for (const yr of [x0, Math.round((x0 + x1) / 2), x1]) el("text", { x: X(yr), y: H - 4, "text-anchor": "middle", "font-size": 9, fill: "#c9d8e4" }, String(yr));
  for (const s of series) if (s.pts.length > 1) el("polyline", { points: s.pts.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" "), fill: "none", stroke: s.color, "stroke-width": 2 });
  const legend = h("div", { class: "row" }, h("b", {}, title), ...series.map((s) => h("small", { style: `color:${s.color}` }, `■ ${s.label} ${s.pts.length ? fmt(s.pts[s.pts.length - 1][1]) : "-"}`)));
  return h("div", { class: "trend" }, legend, svg);
}
export function buildTrends(sim: NonNullable<App["sim"]>, body: HTMLElement) {
  const st = sim.stats.filter((s) => s.roadKm !== undefined && s.railKm !== undefined); body.append(h("h3", { id: "trends" }, "交通の移り変わり"));
  if (st.length < 2) { body.append(h("small", {}, "1年ごとに記録されます。しばらく進めてから開いてください。")); return; }
  const km = Math.max(...st.map((s) => Math.max(s.roadKm!, s.railKm!))) * 1.1;
  body.append(lineChart("trend-km", "延長(km)", [{ label: "道路", color: "#e8a33d", pts: st.map((s) => [s.year, s.roadKm!]) }, { label: "鉄道", color: "#4ea1ff", pts: st.map((s) => [s.year, s.railKm!]) }], km, (v) => (v >= 1000 ? `${Math.round(v / 100) / 10}千` : `${Math.round(v)}`)));
  const sh = st.filter((s) => s.paxRail !== undefined);
  if (sh.length > 1) body.append(lineChart("trend-share", "鉄道の分担", [{ label: "旅客", color: "#4ea1ff", pts: sh.map((s) => [s.year, s.paxRail!]) }, { label: "貨物", color: "#9ad17a", pts: sh.map((s) => [s.year, s.frRail!]) }, { label: "空路", color: "#d18ad1", pts: sh.map((s) => [s.year, s.airShare ?? 0]) }], 1, (v) => `${Math.round(v * 100)}%`));
  const turns = sim.events.filter((e) => /赤字ローカル線の廃止|工事凍結|工事再開|国鉄を分割|海峡連絡が開通|開業:|地方道の計画|国際ハブ空港|港の拡張が完成|開港|閉港|廃港|湖上大橋/.test(e.text)).slice(-6).reverse();
  if (turns.length) body.append(h("div", { class: "issue", id: "trend-turns" }, h("b", {}, "最近の転機"), ...turns.map((e) => h("div", {}, h("small", {}, `${sim.startYear + Math.floor(e.month / 12)}年 ${e.text}`)))));
}
export function buildPolicy(app: App, body: HTMLElement) {
  body.append(h("h3", {}, "政策介入(10年ごと)")); const sim = app.sim, pol = sim?.policy; if (!sim || !pol) { body.append(h("small", {}, "開通の儀のあとに使えます")); return; }
  body.append(h("div", { class: "issue", id: "pol-points" }, `共通の持ち点: ${pol.points}点(毎回+${POINTS_PER_WINDOW}点。使わなかった分は全額繰り越し、無制限)`, h("br"), h("small", {}, "同じ政策に点を足すほど効果は逓減します(1点目が最も効き、10点目はごくわずか)。")));
  const modes = h("div", { class: "row" }); body.append(h("small", {}, "放置したとき"), modes);
  for (const m of ["priority", "idleAuto", "auto"] as PolicyMode[]) modes.append(h("button", { id: "polmode-" + m, class: pol.mode === m ? "mode on" : "mode", "aria-pressed": pol.mode === m ? "true" : "false", onclick: () => { pol.mode = m; app.persist(); app.buildSheet(); } }, `${pol.mode === m ? "✓ " : ""}${POLICY_MODE_LABEL[m]}`));
  const next = (Math.floor((sim.startYear + Math.floor(sim.month / 12) - sim.startYear) / 10) + 1) * 10 + sim.startYear;
  if (!pol.pending) body.append(h("div", { class: "issue" }, `次の介入の機会: ${next}年`)); 
  else {
    const env = computeEnv(sim), dom = ui3.domain, win = pol.pending;
    body.append(h("div", { class: "issue warn", id: "pol-window" }, `${win.year}年: 介入する分野を選んでください。時間は止まっています。`));
    const row = h("div", { class: "row" }); for (const d of ["politics", "economy", "opinion"] as Domain[]) row.append(h("button", { id: "dom-" + d, class: dom === d ? "mode on" : "mode", "aria-pressed": dom === d ? "true" : "false", onclick: () => { ui3.domain = ui3.domain === d ? null : d; ui3.spend = {}; app.buildSheet(); } }, `${dom === d ? "✓ " : ""}${DOMAIN_LABEL[d]}`));
    row.append(h("button", { id: "pol-none", class: "mode none", onclick: () => { skipWindow(sim); ui3.spend = {}; ui3.domain = null; app.toast("点を使わず決定しました。持ち点は繰り越されます"); app.afterPolicy(); } }, "点を使わず決定"));
    body.append(row);
    if (dom) {
      // the buttons that act on the chosen domain sit right under the domain row, so nothing needs scrolling to confirm
      body.append(h("div", { class: "row", id: "pol-actions" }, h("button", { id: "pol-go", class: "primary", onclick: () => { const rec = resolveWindow(sim, app.world!, dom, ui3.spend); ui3.spend = {}; ui3.domain = null; if (rec) app.toast(`採用${rec.adopted.length}件・見送り${rec.declined.length}件。理由は年表に記録しました`); app.afterPolicy(); } }, "この選択にする")));
      const spentTotal = Object.values(ui3.spend).reduce((a, b) => a + b, 0), left = pol.points - spentTotal, top = new Set(topFive(env, dom).map((t) => t.p.id));
      body.append(h("div", { class: "issue", id: "pol-left" }, `残り持ち点 ${left} / ${pol.points}`, h("br"), h("small", {}, `優先度 ${ADOPT_BAR} 以上の上位2件が採用されます。環境の評価はいまの混雑・衰退・補助負担・世論から計算しています。`)));
      const rowOf = (p: (typeof POLICIES)[number], base: number) => {
        const s = ui3.spend[p.id] ?? 0, prio = base + boostOf(s), block = p.block?.(env, sim.era) ?? null;
        return h("div", { class: "issue", id: "pol-" + p.id }, `${p.label} ${bar(Math.min(1, prio))} ${prio.toFixed(2)}${s ? `(持ち点${s}で+${boostOf(s).toFixed(2)})` : ""}`, h("br"), h("small", {}, `${p.desc} ／ 環境評価${base.toFixed(2)} ／ 効果: ${effectText(p.d)}${block ? ` ／ ⚠ ${block}` : ""}`),
          h("div", { class: "row" }, h("button", { id: "pm-" + p.id, disabled: s <= 0, onclick: () => { ui3.spend[p.id] = Math.max(0, s - 1); app.buildSheet(); } }, "−1"), h("button", { id: "pp-" + p.id, disabled: left <= 0, onclick: () => { ui3.spend[p.id] = s + 1; app.buildSheet(); } }, "＋1"), h("button", { disabled: left < 3, onclick: () => { ui3.spend[p.id] = s + Math.min(3, left); app.buildSheet(); } }, "＋3")));
      };
      body.append(h("h3", {}, `${DOMAIN_LABEL[dom]}の方針 上位5`)); for (const t of topFive(env, dom)) body.append(rowOf(t.p, t.base));
      body.append(h("h3", {}, "その他(持ち点で押し上げると候補に入ります)")); for (const t of baseScores(env, dom)) if (!top.has(t.p.id)) body.append(rowOf(t.p, t.base));
    }
  }
  if (pol.history.length) { body.append(h("h3", {}, "これまでの決定")); for (const r of [...pol.history].reverse()) body.append(h("div", { class: "issue" }, `${r.year}年 ${r.none ? "点を使わず決定" : DOMAIN_LABEL[r.domain]}${r.auto ? "(自動)" : ""}: 採用 ${r.adopted.map((a) => a.label).join("・") || "なし"}`, h("br"), h("small", {}, [...r.adopted.map((a) => `${a.label}: ${a.reason}`), ...r.declined.map((d) => `見送り ${d.label}: ${d.reason}`)].join(" ／ ")))); }
  const now = sim.dials; body.append(h("h3", {}, "現在の世界の傾向(参考)")); body.append(h("small", {}, DIAL_KEYS.map((k) => `${DIAL_LABEL[k]} ${now[k].toFixed(2)}`).join(" ／ "))); void composeDials; void GRADE_MODE; void STATE_LABEL;
}

/**
 * Stage 8: 港湾・空港 -- the facilities as they stood in the year being viewed (or now): each port's tier and handling, each airport's kind, runway and
 * travellers, their routes, and their own history (opening, expansions, cut-backs, closure). A chart of the sea and the air from sim.stats.
 */
/**
 * Stage 12: 都市の栄枯盛衰 -- who gained and who lost on the nation over the last twenty years, and why. One compact block: two short lists (the five that gained most
 * and the five that lost most, with the cause that moved them most), and a city picker that opens that city's size over time and the parts of its yearly advantage.
 */
/** Stage 23: the 政令指定都市 (with their wards) and 政令特区 of the game, and the ones that were given up. Tap a city to open its wards. */
const ROLE_LABEL: Record<string, string> = { center: "都心", industry: "工業", port: "港湾・物流", academic: "学術", residential: "住宅" };
export function buildCityTiers(app: App, sim: SimState, body: HTMLElement) {
  const t = sim.tier23, w = app.ensureWorld(); if (!t || !w) return;
  body.append(h("h3", { id: "city-tiers" }, "政令指定都市と政令特区(ゲーム独自の制度)")); const y = yearOf(sim);
  const rows = Object.entries(t.zones).map(([id, z]) => ({ id, z, c: w.cityById.get(id)!, pop: sim.cities[id]?.pop ?? 0 })).filter((r) => r.c).sort((a, b) => b.z.tier - a.z.tier || b.pop - a.pop);
  if (!rows.length) { body.append(h("small", {}, "まだありません。人口が全国の0.7%を保ち続けた都市が政令特区になります。")); }
  for (const r of rows) {
    const open = ui3.open.has("tier-" + r.id), facs = r.z.facs.map((f) => `${FACILITY_LABEL[f.k]}${facLevel(f, y) < 1 ? `(整備中${Math.round(facLevel(f, y) * 100)}%)` : ""}`).join("・");
    const d = h("div", { class: "issue", id: "tier-" + r.id, onclick: () => { open ? ui3.open.delete("tier-" + r.id) : ui3.open.add("tier-" + r.id); app.buildSheet(); } },
      `${r.c.name} ${r.z.tier === 2 ? "政令指定都市" : ZONE_LABEL[r.z.kind]} ${Math.round(r.pop / 1000).toLocaleString()}千人 ／ ${facs}`);
    if (open) { for (const x of wardPops(r.z, r.pop)) d.append(h("div", { class: "hist" }, `${x.ward.name}(${ROLE_LABEL[x.ward.role]}) ${Math.round(x.pop / 1000).toLocaleString()}千人`)); for (const hh of tierHistory(sim, r.id)) d.append(h("div", { class: "hist" }, `${hh.y}年 ${hh.tier === 2 ? "政令指定都市に昇格" : hh.tier === 1 ? "政令特区(" + ZONE_LABEL[hh.kind ?? r.z.kind] + ")" : "指定解除"}`)); }
    body.append(d);
  }
  const gone = Object.entries(t.hist).filter(([id]) => !t.zones[id]).map(([id, hh]) => ({ c: w.cityById.get(id), hh })).filter((r) => r.c);
  if (gone.length) body.append(h("small", { id: "tier-gone" }, "指定が解かれた都市: " + gone.map((g) => `${g.c!.name}(${g.hh[g.hh.length - 1].y}年)`).join("、")));
}
export function buildCityEconomy(app: App, sim: SimState, body: HTMLElement, year: number | null) {
  body.append(h("h3", { id: "city-eco" }, "都市の栄枯盛衰"));
  const w = app.ensureWorld(), c12 = sim.city12; if (!w || !c12) { body.append(h("small", {}, "このデータには都市経済のしくみがありません(旧形式のセーブ)")); return; }
  const rows: { id: string; name: string; p1: number; p0: number; rel: number }[] = []; let s0 = 0, s1 = 0;
  for (const c of w.cities) { const hh = c12[c.id]?.h; if (!hh || hh.length < 2) continue; const k = year === null ? hh.length - 1 : Math.max(1, Math.min(hh.length - 1, Math.floor((year - sim.startYear) / 5))), p1 = hh[k], p0 = hh[Math.max(0, k - 4)]; rows.push({ id: c.id, name: c.name, p1, p0, rel: 1 }); s0 += p0; s1 += p1; }
  if (rows.length < 5) { body.append(h("small", {}, "5年ごとに記録されます。しばらく進めてから開いてください。")); return; }
  const nat = s0 > 0 ? s1 / s0 : 1; for (const r of rows) r.rel = r.p0 > 0 ? r.p1 / r.p0 / nat : 1;
  const big = rows.filter((r) => r.p0 >= 100000), why = (id: string) => { const m = mainCause(c12[id]); return m ? `${ECO_LABEL[m.part]}${m.v > 0 ? "が追い風" : "が逆風"}` : "全国並み"; };
  const line = (r: (typeof rows)[0]) => h("div", { class: "issue" }, `${r.name} ${r.rel >= 1 ? "▲" : "▼"}${Math.round(Math.abs(r.rel - 1) * 100)}% (${Math.round(r.p0 / 1000).toLocaleString()}千→${Math.round(r.p1 / 1000).toLocaleString()}千人) ${why(r.id)}`);
  body.append(h("small", {}, `${year ?? "現在"}年までの約20年で、全国の増減(${nat >= 1 ? "+" : ""}${Math.round((nat - 1) * 100)}%)を上回った・下回った都市(人口10万以上)`));
  body.append(h("div", { id: "eco-up" }, h("b", {}, "伸びた"), ...[...big].sort((p, q) => q.rel - p.rel).slice(0, 5).map(line)));
  body.append(h("div", { id: "eco-down" }, h("b", {}, "縮んだ"), ...[...big].sort((p, q) => p.rel - q.rel).slice(0, 5).map(line)));
  if (sim.seats14) {
    const hc = homeCity(w, sim.capital), sc = subCity(w, sim.subCapital), order = [...w.cities].sort((a, b) => sim.cities[b.id].pop - sim.cities[a.id].pop);
    const line1 = (c: typeof hc, role: string) => { if (!c) return null; const m = sim.metro?.list.find((x) => x.members.includes(c.id)), rank = order.findIndex((o) => o.id === c.id) + 1; return h("div", { class: "issue" }, `${role} ${c.name.replace(/市$/, "")}: 都市単体 ${(sim.cities[c.id].pop / 1e6).toFixed(2)}百万人(全国${rank}位)${m ? `・都市圏 ${(m.pop / 1e6).toFixed(2)}百万人(単体の割合${Math.round((sim.cities[c.id].pop / m.pop) * 100)}%、衛星${m.members.length - 1}市)` : ""}`); };
    body.append(h("div", { id: "eco-seats" }, h("b", {}, "首都・副首都の都市序列(このゲームの人為的な規則)"), h("small", {}, "首都と副首都は都市単体の人口で全国の上位2つに保つ。超えた分は周辺の都市へ移し、人を消さない。工業・貿易・観光はほかの都市が全国一でもよい。都市単体と都市圏の人口は別の数字。"), ...([line1(hc, "首都"), line1(sc, "副首都")].filter((x) => !!x) as Node[])));
  }
  if (sim.metro) {
    const M = sim.metro, pick = (m: (typeof M.list)[0]) => { const hh = M.h[m.core] ?? []; if (year === null) return { pop: m.pop, area: m.areaKm2 }; let k = -1; for (let q = 0; q < hh.length; q++) if (hh[q][0] <= year) k = q; return k < 0 ? null : { pop: hh[k][1], area: hh[k][2] }; };
    const ms = M.list.map((m) => ({ m, v: pick(m) })).filter((x): x is { m: (typeof M.list)[0]; v: { pop: number; area: number } } => !!x.v).sort((p, q) => q.v.pop - p.v.pop).slice(0, 8);
    body.append(h("div", { id: "eco-metro" }, h("b", {}, "都市圏(通勤・生活の広がり。1つの人口は1つの都市圏にだけ数える)"), ...ms.map(({ m, v }) => {
      const nm = w.cityById.get(m.core)?.name ?? m.core, r = Math.sqrt(v.area / Math.PI);
      return h("div", { class: "issue" }, `${nm}圏 ${(v.pop / 1e6).toFixed(2)}百万人・${Math.round(v.area).toLocaleString()}km²(半径${Math.round(r)}km)${year === null ? `・衛星${m.members.length - 1}市・${m.prefs.length}府県にまたがり、本拠の府県の外が${Math.round(m.outsidePct * 100)}%` : ""}`);
    })));
  }
  if (sim.pot17) {   // Stage 17: the development-potential order of the 49 prefectures, and the places that grew into cities (and the ones that lost their name)
    const P = sim.pot17, W = potentialWeights(P.order), nm = (id: string) => prefName(id), cityName = (id: string) => w.cityById.get(id)?.name ?? id;
    body.append(h("div", { id: "pot17" }, h("b", {}, "府県の発展ポテンシャル順位(人口の順位ではなく、発展しやすさ。上位ほど強く、中位以下の差はわずか)"),
      h("div", { class: "issue", id: "pot17-top" }, "上位: " + P.order.slice(0, 12).map((p, i) => `${i + 1}${nm(p)}`).join(" ")),
      h("small", {}, `重み(平均1): 1位${W[P.order[0]].toFixed(2)}・7位${W[P.order[6]].toFixed(2)}・25位${W[P.order[24]].toFixed(2)}・49位${W[P.order[48]].toFixed(2)}。今効いている重みは順位替えのあと年々なだらかに動く`),
      ...P.hist.map((x) => h("div", { class: "issue" }, `${x.y}年 ${x.why}: 1〜6位 ${x.order.slice(0, 6).map(nm).join("・")}`))));
    const born = Object.entries(P.shown).filter(([id]) => !(w.cityById.get(id)?.kind === "capital")).sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]) || (a[0] < b[0] ? -1 : 1));
    body.append(h("div", { id: "city17" }, h("b", {}, `都市の誕生(県庁所在地のほか${born.filter(([, v]) => v > 0).length}市が都市として現れ、${born.filter(([, v]) => v < 0).length}市が表示を外れた)`),
      ...born.slice(-30).map(([id, v]) => h("div", { class: "issue" }, `${Math.abs(v)}年 ${cityName(id)} ${v > 0 ? "が都市として現れた" : "は表示を外れた(住民は残る)"}(今 ${Math.round((sim.cities[id]?.pop ?? 0) / 1000).toLocaleString()}千人)`))));
  }
  const det = h("details", { id: "eco-detail" }, h("summary", {}, "都市を選んで推移と原因を見る")) as HTMLDetailsElement, sel = h("select", { id: "eco-city", "aria-label": "都市" }) as HTMLSelectElement;
  for (const r of [...rows].sort((p, q) => q.p1 - p.p1).slice(0, 40)) sel.append(h("option", { value: r.id }, `${r.name} ${Math.round(r.p1 / 1000).toLocaleString()}千人`));
  const out = h("div", { id: "eco-out" }); const show = () => {
    out.replaceChildren(); const id = sel.value, d = c12[id]; if (!d) return;
    out.append(lineChart("eco-chart", "人口(千人)", [{ label: w.cityById.get(id)?.name ?? "", color: "#4ea1ff", pts: d.h.map((v, i) => [sim.startYear + 5 * i, v / 1000] as [number, number]) }], Math.max(...d.h) / 1000 * 1.1, (v) => `${Math.round(v).toLocaleString()}`));
    out.append(h("small", {}, "今年の追い風(+)・逆風(−)の内訳(年あたりの移動の勢い。国の動きは除く)"));
    ECO_PARTS.forEach((p, i) => { const v = d.p[i] ?? 0; out.append(h("div", { class: "row" }, h("small", {}, `${ECO_LABEL[p]} ${v >= 0 ? "+" : ""}${v.toFixed(2)}`), h("small", {}, bar(Math.min(1, Math.abs(v) / 0.6)) + (v < 0 ? " ▼" : v > 0 ? " ▲" : "")))); });
  };
  sel.addEventListener("change", show); det.append(sel, out); det.addEventListener("toggle", () => { if (det.open) show(); }); body.append(det);
}
export function buildHubAtlas(app: App, sim: SimState, body: HTMLElement, year: number | null) {
  const w = app.world; if (!sim.hubs || !w) return;
  const y = year ?? sim.startYear + Math.floor(sim.month / 12), at = hubsAt(sim, year ?? Number.POSITIVE_INFINITY), now = year === null;
  body.append(h("h3", { id: "hubs" }, `港湾・空港(${now ? "現在" : `${year}年`})`));
  const st = sim.stats.filter((s) => s.airPax !== undefined);
  if (st.length > 1) {
    const mx = Math.max(...st.map((s) => Math.max(s.seaCargo ?? 0, s.airPax ?? 0))) * 1.1;
    body.append(lineChart("trend-hubs", "海と空の取扱(/日)", [{ label: "港の貨物", color: "#1aa3a3", pts: st.map((s) => [s.year, s.seaCargo ?? 0]) }, { label: "空港の旅客", color: "#d9822b", pts: st.map((s) => [s.year, s.airPax ?? 0]) }, { label: "うち国際", color: "#ffc83a", pts: st.map((s) => [s.year, s.airIntl ?? 0]) }], mx, (v) => (v >= 1e4 ? `${Math.round(v / 1000)}千` : `${Math.round(v)}`)));
  }
  const tiers = [4, 3, 2, 1].map((t) => `${PORT_TIER_LABEL[t]}${at.ports.filter((p) => p.tier === t).length}`).join("・"), hubs = at.airports.filter((a) => a.kind === "hub");
  const open = at.routes.filter((r) => r.state === "open");
  body.append(h("div", { class: "issue", id: "hub-summary" }, `港湾${at.ports.length}(${tiers}) ／ 空港${at.airports.length}(うち国際ハブ${hubs.length}) ／ 国際航路${open.filter((r) => r.mode === "sea").length}・国際線${open.filter((r) => r.mode === "air" && r.intl).length}・国内線${open.filter((r) => r.mode === "air" && !r.intl).length}`));
  const routesOf = (id: string, mode: "sea" | "air") => open.filter((r) => r.mode === mode && (r.a === id || r.b === id));
  const hist = (x: { hist: { y: number; t: string }[] }) => x.hist.filter((e) => e.y <= y).map((e) => `${e.y}年 ${e.t}`).join(" ／ ");
  const det = (id: string, title: string, lines: (string | HTMLElement)[]) => { const d = h("details", { id, ...(ui3.open.has(id) ? { open: "" } : {}) }, h("summary", {}, title), ...lines.map((l) => (typeof l === "string" ? h("div", {}, h("small", {}, l)) : l))) as HTMLDetailsElement; d.addEventListener("toggle", () => { if (d.open) ui3.open.add(id); else ui3.open.delete(id); }); return d; };
  const ports = [...at.ports].sort((p, q) => q.tier - p.tier || q.cargo - p.cargo).slice(0, 14), airs = [...at.airports].sort((p, q) => (q.kind === "hub" ? 1 : 0) - (p.kind === "hub" ? 1 : 0) || q.pax - p.pax).slice(0, 14);
  body.append(det("hub-ports", `港湾(上位${ports.length})`, ports.map((p) => { const r = routesOf(p.city, "sea"); return `${portName(w, p.city)} ${PORT_TIER_LABEL[p.tier]}${now ? ` 取扱${p.cargo.toLocaleString()}/日(能力の${Math.round(p.load * 100)}%)${p.build ? `・拡張工事中(${p.build.done}年完成予定)` : ""}` : ""}${r.length ? ` 航路: ${r.map((x) => foreignName(x.b)).join("、")}` : ""} — ${hist(p)}`; })));
  body.append(det("hub-airports", `空港(上位${airs.length})`, airs.map((a) => { const r = routesOf(a.city, "air"); return `${airName(w, a.city)} ${AIR_KIND_LABEL[a.kind]}・滑走路${a.runwayM}m${now ? ` 旅客${a.pax.toLocaleString()}人/日(国際${a.intl.toLocaleString()})・能力の${Math.round(a.load * 100)}%${a.railAccess ? "・アクセス鉄道あり" : ""}${a.build ? `・${a.build.what}(${a.build.done}年完成予定)` : ""}` : ""} 便: 国内${r.filter((x) => !x.intl).length}・国際${r.filter((x) => x.intl).length} — ${hist(a)}`; })));
  const closed = [...Object.values(sim.hubs.ports), ...Object.values(sim.hubs.airports)].filter((x) => x.until !== undefined && x.until <= y);
  if (closed.length) body.append(det("hub-closed", `閉港・廃港(${closed.length})`, closed.map((x) => `${"tier" in x ? portName(w, x.city) : airName(w, x.city)} ${x.since}〜${x.until}年`)));
  void PORT_CAP;
}
