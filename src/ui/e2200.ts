import { PREF_IDS } from "../core/seat";
/** Stage 22: the sheet of the 2200 event -- seats, the era name, and the policy chosen freely; one column of ○/● rows, nothing decided until 決める. */
import type { App } from "./app";
import { h } from "./app";
import { groupOf2200, type Choice2200 } from "../sim/event2200";
import type { SimState } from "../sim/types";
import { prefSelect } from "./prefSelect";
import { seatCity } from "../sim/ceremony";
import { DEFAULT_CAPITAL, DEFAULT_PALACE, DEFAULT_SUB, prefName } from "../core/seat";

export const e22Draft = (sim: SimState): Choice2200 => ({ era: 0, stance: "heisei", coast: sim.kaigen?.recon?.coast ?? "neutral", focus: sim.kaigen?.recon?.focus ?? "concentrate", capital: sim.capital ?? DEFAULT_CAPITAL, sub: sim.subCapital ?? (sim.capital === DEFAULT_SUB ? DEFAULT_CAPITAL : DEFAULT_SUB), palace: sim.palace?.pref ?? DEFAULT_PALACE, ...(sim.subCapital2 ? { sub2: sim.subCapital2 } : {}) });
const radio = (id: string, label: string, on: boolean, pick: () => void, desc?: string) => h("button", { id, type: "button", role: "radio", "aria-checked": String(on), class: "rw-item" + (on ? " on" : ""), onclick: pick }, h("span", { class: "rw-dot" }, on ? "●" : "○"), h("span", { class: "rw-txt" }, h("span", { class: "rw-label" }, label), ...(desc ? [h("span", { class: "rw-desc" }, desc)] : [])));
export const RW_LABELS = ["元号・方針", "首都・副首都・皇居", "国道0号", "最終確認"];
const rwHead = (n: number, extra = "") => h("div", { id: "rw-head", class: "note", role: "status", "aria-live": "polite" }, `遷都 ${n + 1}/4  ${RW_LABELS[n]}${extra}`);
/** Stage 35: the relocation as four stages -- era and policy, the three seats, 国道0号, a final review. Nothing is applied before the seats stage is decided, and the game does not move until the review is confirmed. */
export function buildE2200(app: App, body: HTMLElement) {
  const sim = app.sim, e = sim?.e2200; if (!sim || !e) { body.append(h("small", {}, "遷都の出来事はまだです")); return; }
  body.append(h("h3", {}, `${e.year}年 遷都と復興(第${(e.n ?? 0) + 1}回)`));
  if (e.state !== "pending") { body.append(h("div", { class: "issue", id: "e22-done" }, e.kept ? "現状を維持しました" : `元号: ${e.era}／方針は自由選択${e.state === "road0" ? "／国道0号を描けます(下の道具)" : ""}`)); return; }
  const n = app.rwStage < 2 ? app.rwStage : 0, d = (app.e22 ??= e22Draft(sim)), re = () => app.buildSheet(), list = h("div", { class: "radio-list", id: "e22-box" });
  body.append(rwHead(n));
  body.append(h("div", { class: "row", id: "e22-bgrow" }, h("small", {}, "地図の表示"), app.bgSwitch("e22-bg")));   // Stage 27: the map can be switched (道路図 / 地形図) while the seats are chosen; nothing chosen is touched
  body.append(h("div", { class: "issue warn", id: "e22-window" }, n === 0 ? "元号と交通・地域・都市配置の方針を選びます。時間は止まっています。決めなければ「今のまま続ける」で現状維持。" : "首都・副首都・皇居を選びます(首都と副首都は別の府県、皇居は重なってもよい)。旧所在地の都市・道路・住民はそのまま残り、人はゆっくり移ります。"));
  if (n === 1) {
    list.append(h("div", { class: "rw-head" }, "首都・副首都・皇居"));
    // Stage 36 M3: one or two sub-capitals, chosen again here (the only time besides the start)
    const two = !!d.sub2;
    list.append(h("div", { class: "grp", id: "e22-sub-count" }, h("span", {}, "副首都の数"), ...([1, 2] as const).map((n) => h("button", { id: "e22-sub-count-" + n, type: "button", class: (two ? 2 : 1) === n ? "mode on" : "mode", "aria-pressed": (two ? 2 : 1) === n ? "true" : "false", onclick: () => { if (n === 1) { d.sub2 = null; delete d.subPos2; } else if (!d.sub2) d.sub2 = PREF_IDS.find((p) => p !== d.capital && p !== d.sub && p === "JP-04") ?? PREF_IDS.find((p) => p !== d.capital && p !== d.sub); re(); } }, n + "か所"))));
    const roles = (two ? [["capital", "首都"], ["sub", "副首都1"], ["sub2", "副首都2"], ["palace", "皇居"]] : [["capital", "首都"], ["sub", "副首都"], ["palace", "皇居"]]) as ["capital" | "sub" | "sub2" | "palace", string][];
    for (const [role, label] of roles) {
      const pref = d[role] ?? undefined, pos = role === "capital" ? d.capitalPos : role === "sub" ? d.subPos : role === "sub2" ? d.subPos2 : d.palacePos;
      list.append(h("div", { class: "e22-seat", id: "e22-seat-" + role }, h("span", {}, `${label}: ${pref ? prefName(pref) : "-"}${pos ? "(地図で指定)" : ""}`), prefSelect("e22-sel-" + role, label, pref ?? "", role === "capital" ? d.sub ?? null : role === "sub" || role === "sub2" ? d.capital ?? null : null, (pid) => (app.world ? seatCity(app.world, pid)?.name ?? "" : ""), (pid) => { app.centerOnPref(pid); if (role === "sub2" ? pid === d.capital || pid === d.sub : role === "sub" && !!d.sub2 && pid === d.sub2) { app.toast("首都と副首都(2か所なら両方)はそれぞれ別の府県にしてください"); re(); return; } (d as unknown as Record<string, unknown>)[role] = pid; if (role === "capital") delete d.capitalPos; else if (role === "sub") delete d.subPos; else if (role === "sub2") delete d.subPos2; else delete d.palacePos; re(); }), h("button", { id: "e22-map-" + role, type: "button", onclick: () => app.startE22Map(role) }, "地図で")));
    }
    body.append(list, h("div", { class: "row" }, h("button", { id: "e22-back", type: "button", onclick: () => app.rwBack() }, "‹ 戻る"), h("button", { id: "e22-decide", type: "button", class: "mode on", onclick: () => app.decideE2200(false) }, "これで決定 ›(次: 国道0号)")));
    return;
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
  body.append(list, h("div", { class: "row" }, h("button", { id: "e22-next", type: "button", class: "mode on", onclick: () => app.rwNext() }, "次へ ›(首都・副首都・皇居)"), h("button", { id: "e22-keep", type: "button", onclick: () => app.decideE2200(true) }, "今のまま続ける")));
}
/** Stage 35: the last stage -- what was chosen, in one place; the game resumes only on 確定して再開. */
export function buildRwReview(app: App, body: HTMLElement) {
  const sim = app.sim, e = sim?.e2200; if (!sim || !e) return;
  const d0 = app.cerDraft.kokudo0, road = app.rwSkip || !d0?.prev.ok ? "作らない(見送り)" : `約${d0.prev.lengthKm}km`, grown = app.world?.g34grown ?? [], seats = app.activeSeats();
  body.append(h("h3", {}, `${e.year}年 遷都と復興 — 最終確認`), rwHead(3));
  const rows: [string, string][] = [["元号", e.era ?? "-"], ["首都", prefName(seats.capital)], ["副首都", prefName(seats.sub)], ["皇居", prefName(seats.palace)], ["国道0号", road]];
  if (grown.length) rows.push(["島の拡大", grown.map((g) => `${g.from}→${g.to}km²(${g.cells}マス追加。格子は25km²単位)`).join("、")]);
  rows.push(["埋め立て", "旧所在地の埋め立ては止まり、すでに埋めた土地は残ります。新しい首都・副首都は予算0から始まります"]);
  body.append(h("div", { id: "rw-review", class: "wiz-review" }, ...rows.map(([k, v]) => h("div", { class: "wiz-row" }, h("span", { class: "wiz-name" }, k), h("span", { class: "wiz-sum" }, v)))));
  body.append(h("div", { class: "issue warn", id: "rw-note" }, "「確定して再開」を押すまで時間は進みません。確定すると保存され、時間が再び進みます。"), h("div", { class: "row" }, h("button", { id: "rw-back", type: "button", onclick: () => app.rwBack() }, "‹ 戻る"), h("button", { id: "rw-confirm", type: "button", class: "mode on", onclick: () => app.rwConfirm() }, "確定して再開")));
}
