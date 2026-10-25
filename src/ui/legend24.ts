/**
 * Stage 24: the legend as a narrow vertical strip on the left or the right edge of the map: one column, its own scroll, each entry a line sample with its words UNDER it.
 * Three axes -- kind (6), tier (3: how thick), state (4: what kind of line) -- one sample per value, not one per combination: a thick dashed blue line is a main-tier line that is planned.
 * Display only: nothing here reads or changes the game.
 */
import { h } from "./app";

const SVG = (inner: string) => `<svg viewBox="0 0 64 16" width="100%" height="16" preserveAspectRatio="none" aria-hidden="true">${inner}</svg>`;
const ln = (c: string, w: number, extra = "") => `<line x1="3" y1="8" x2="61" y2="8" stroke="${c}" stroke-width="${w}" ${extra}/>`;
type Item = [string, string];   // svg inner, caption
const GROUPS: [string, Item[]][] = [
  ["交通種別", [
    [ln("#3d3d3d", 6) + ln("#5bd66b", 3.5), "道路"],
    [ln("#0b7a3e", 8) + ln("#5bd66b", 4.5) + ln("#fff", 1), "高速道路"],
    [ln("#fff", 6) + ln("#12284d", 3.5) + ln("#fff", 2.5, 'stroke-dasharray="4 5"'), "鉄道"],
    [ln("#fff", 7) + ln("#1e6fd9", 5) + ln("#fff", 1.2), "新幹線 リニアは紫"],
    [ln("#2f8fd8", 3, 'stroke-dasharray="7 5"'), "海路(国内)"],
    [ln("#9aa4ad", 1.4, 'stroke-dasharray="6 5"'), "空路(国内)"],
  ]],
  ["階層(太さ)", [[ln("#bbb", 7), "メイン"], [ln("#bbb", 4), "サブ"], [ln("#bbb", 2), "ローカル"]]],
  ["状態(線種)", [
    [ln("#ffe14a", 5, 'stroke-linecap="round"'), "供用中 実線"],
    [ln("#3aa0ff", 3, 'stroke-dasharray="7 4"'), "計画 青の破線"],
    [ln("#2b2b2b", 2, 'stroke-dasharray="2 5"'), "廃線 点線"],
    [ln("#b04bff", 3, 'stroke-dasharray="7 4"'), "未成 紫の破線"],
  ]],
  ["橋・トンネル", [
    [ln("#1a1a1a", 12) + ln("#fff", 8.6) + ln("#5bd66b", 3.5) + [10, 22, 34, 46, 58].map((x) => `<line x1="${x}" y1="1" x2="${x}" y2="15" stroke="#1a1a1a" stroke-width="1.4"/>`).join(""), "橋 白い帯と横線"],
    [ln("#2a1f14", 13, 'stroke-dasharray="4 3"') + ln("#fff", 8.5) + ln("#5bd66b", 3.5, 'stroke-opacity=".5"'), "トンネル 黒い破線"],
    ['<line x1="3" y1="5" x2="61" y2="5" stroke="#5bd66b" stroke-width="3"/><line x1="3" y1="11" x2="61" y2="11" stroke="#12284d" stroke-width="3"/>', "共用は2本並ぶ"],
  ]],
  ["そのほか", [
    [ln("#111", 10) + ln("#ff00d4", 6), "選んだ路線"],
    ['<circle cx="20" cy="8" r="5.5" fill="none" stroke="#3b1f6e" stroke-width="2.4"/><circle cx="44" cy="8" r="5.5" fill="none" stroke="#7a4fb5" stroke-width="1.4"/>', "紫の輪 政令市/特区"],
  ]],
];
/** The strip: a head (left/right switch, filters, close) and the entries. */
export function buildLegendStrip(opts: { side: "left" | "right"; swap: () => void; close: () => void; filters: () => void }): HTMLElement {
  const root = h("aside", { id: "legend-side", class: "legend-strip " + opts.side, "aria-label": "凡例" });
  const head = h("div", { class: "lg-head" },
    h("button", { id: "lg-swap", type: "button", title: opts.side === "left" ? "右へ移す" : "左へ移す", onclick: opts.swap }, opts.side === "left" ? "▶" : "◀"),
    h("button", { id: "lg-filters", type: "button", title: "表示の切替", onclick: opts.filters }, "切替"),
    h("button", { id: "lg-close", type: "button", title: "閉じる", onclick: opts.close }, "×"));
  const body = h("div", { class: "lg-body", id: "legend-side-body" });
  for (const [title, items] of GROUPS) {
    body.append(h("div", { class: "lg-title" }, title));
    for (const [svg, cap] of items) { const it = h("div", { class: "lg-item" }); it.innerHTML = `${SVG(svg)}<span class="lg-cap">${cap}</span>`; body.append(it); }
  }
  root.append(head, body); return root;
}
