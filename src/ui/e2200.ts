/** Stage 22: the sheet of the 2200 event -- seats, the era name, and the policy chosen freely; one column of ○/● rows, nothing decided until 決める. */
import type { App } from "./app";
import { h } from "./app";
import { groupOf2200, type Choice2200 } from "../sim/event2200";
import type { SimState } from "../sim/types";
import { prefSelect } from "./prefSelect";
import { seatCity } from "../sim/ceremony";
import { DEFAULT_CAPITAL, DEFAULT_PALACE, DEFAULT_SUB, prefName } from "../core/seat";

export const e22Draft = (sim: SimState): Choice2200 => ({ era: 0, stance: "heisei", coast: sim.kaigen?.recon?.coast ?? "neutral", focus: sim.kaigen?.recon?.focus ?? "concentrate", capital: sim.capital ?? DEFAULT_CAPITAL, sub: sim.subCapital ?? (sim.capital === DEFAULT_SUB ? DEFAULT_CAPITAL : DEFAULT_SUB), palace: sim.palace?.pref ?? DEFAULT_PALACE });
const radio = (id: string, label: string, on: boolean, pick: () => void, desc?: string) => h("button", { id, type: "button", role: "radio", "aria-checked": String(on), class: "rw-item" + (on ? " on" : ""), onclick: pick }, h("span", { class: "rw-dot" }, on ? "●" : "○"), h("span", { class: "rw-txt" }, h("span", { class: "rw-label" }, label), ...(desc ? [h("span", { class: "rw-desc" }, desc)] : [])));
export function buildE2200(app: App, body: HTMLElement) {
  const sim = app.sim, e = sim?.e2200; if (!sim || !e) { body.append(h("small", {}, "2200年の出来事はまだです")); return; }
  body.append(h("h3", {}, `${e.year}年 遷都と復興(第${(e.n ?? 0) + 1}回)`));
  if (e.state !== "pending") { body.append(h("div", { class: "issue", id: "e22-done" }, e.kept ? "現状を維持しました" : `元号: ${e.era}／方針は自由選択${e.state === "road0" ? "／国道0号を描けます(下の道具)" : ""}`)); return; }
  const d = (app.e22 ??= e22Draft(sim)), re = () => app.buildSheet(), list = h("div", { class: "radio-list", id: "e22-box" });
  body.append(h("div", { class: "row", id: "e22-bgrow" }, h("small", {}, "地図の表示"), app.bgSwitch("e22-bg")));   // Stage 27: the map can be switched (道路図 / 地形図) while the seats are chosen; nothing chosen is touched
  body.append(h("div", { class: "issue warn", id: "e22-window" }, "首都・副首都・皇居、元号、復興方針を選び直せます。時間は止まっています。決めなければ「今のまま続ける」で現状維持。旧所在地の都市・道路・住民はそのまま残り、人はゆっくり移ります。"));
  // seats
  list.append(h("div", { class: "rw-head" }, "首都・副首都・皇居"));
  for (const [role, label] of [["capital", "首都"], ["sub", "副首都"], ["palace", "皇居"]] as const) {
    const pref = d[role], pos = role === "capital" ? d.capitalPos : role === "sub" ? d.subPos : d.palacePos;
    list.append(h("div", { class: "e22-seat", id: "e22-seat-" + role }, h("span", {}, `${label}: ${pref ? prefName(pref) : "-"}${pos ? "(地図で指定)" : ""}`), prefSelect("e22-sel-" + role, label, pref ?? "", role === "capital" ? d.sub ?? null : role === "sub" ? d.capital ?? null : null, (pid) => (app.world ? seatCity(app.world, pid)?.name ?? "" : ""), (pid) => { d[role] = pid; if (role === "capital") delete d.capitalPos; else if (role === "sub") delete d.subPos; else delete d.palacePos; re(); }), h("button", { id: "e22-map-" + role, type: "button", onclick: () => app.startE22Map(role) }, "地図で")));
  }
  // era
  const g = groupOf2200(sim)!;
  list.append(h("div", { class: "rw-head" }, "元号", h("small", {}, ` ${g.base}。一度でも使った元号は出ません`)));
  g.cands.forEach((c, i) => list.append(radio("e22-era-" + i, `${c.name}${c.yomi ? `(${c.yomi})` : ""}${c.origin === "fiction" ? "【架空】" : ""}`, d.era === i, () => { d.era = i; re(); }, c.note)));
  // policy, free combination
  list.append(h("div", { class: "rw-head" }, "交通方針", h("small", {}, " 元号とは切り離して自由に選べます")));
  for (const [k, l] of [["shubun", "道路重視"], ["shoka", "鉄道重視"], ["kairo", "海路重視"], ["kuuro", "空路重視"], ["heisei", "均衡"]] as const) list.append(radio("e22-stance-" + k, l, d.stance === k, () => { d.stance = k; re(); }));
  list.append(h("div", { class: "rw-head" }, "地域方針"));
  for (const [k, l] of [["japansea", "日本海側重視"], ["pacific", "太平洋側重視"], ["neutral", "中立"]] as const) list.append(radio("e22-coast-" + k, l, d.coast === k, () => { d.coast = k; re(); }));
  list.append(h("div", { class: "rw-head" }, "都市配置方針"));
  for (const [k, l] of [["concentrate", "一極集中"], ["disperse", "地方分散"]] as const) list.append(radio("e22-focus-" + k, l, d.focus === k, () => { d.focus = k; re(); }));
  body.append(list, h("div", { class: "row" }, h("button", { id: "e22-decide", type: "button", class: "mode on", onclick: () => app.decideE2200(false) }, "この内容で決める"), h("button", { id: "e22-keep", type: "button", onclick: () => app.decideE2200(true) }, "今のまま続ける")));
}
