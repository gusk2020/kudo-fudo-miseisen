/** Stage 3 panels: era choice, timeline, route ledger, transport atlas (year slider), policy window. Plain DOM, built only when opened. */
import type { App } from "./app";
import { h } from "./app";
import { DIAL_LABEL, DIAL_KEYS, ERAS, SELECTABLE_ERAS, composeDials, type EraKey } from "../sim/eras";
import { effectText } from "../sim/events";
import { prefName, routeLabel } from "../sim/engine";
import { codesAt, numberHistory } from "../sim/ledger";
import { CAND_1945, STANCE_LABEL } from "../sim/kaigen";
import { displayName } from "../sim/straits";
import { DOMAIN_LABEL, POLICIES, skipWindow, POLICY_MODE_LABEL, POINTS_PER_WINDOW, ADOPT_BAR, baseScores, boostOf, computeEnv, resolveWindow, topFive, type Domain, type PolicyMode } from "../sim/policy";
import { GRADE_MODE, KIND_LABEL, PROJECT_LABEL, STATE_LABEL, modeOf, monthToYM, type SimRoute, type SimState } from "../sim/types";

export const ui3 = { tl: "all", tlN: 60, ledger: "road" as "road" | "rail" | "fac" | "gone", ledgerN: 40, open: new Set<string>(), spend: {} as Record<string, number>, domain: null as Domain | null };
const ym = (sim: SimState, m: number) => { const { year, month } = monthToYM(sim.startYear, m); return `${year}年${month}月`; };
const bar = (v: number) => "■".repeat(Math.round(Math.max(0, Math.min(1, v)) * 10)) + "□".repeat(10 - Math.round(Math.max(0, Math.min(1, v)) * 10));

export function eraPicker(app: App, tb: HTMLElement, current: number, pick: (i: number) => void) {
  tb.append(h("div", { id: "era-pick", class: "note" }, "最初の元号(1926年の昭和改元で実際に挙がった案)"));
  const sel = h("select", { id: "era-first", "aria-label": "最初の元号", onchange: (e: Event) => pick(+(e.target as HTMLSelectElement).value) }) as HTMLSelectElement;
  CAND_1945.forEach((c, i) => sel.append(h("option", { value: String(i), ...(i === current ? { selected: "" } : {}) }, `${c.name}(${STANCE_LABEL[c.stance]})`)));
  const c = CAND_1945[current] ?? CAND_1945[0];
  tb.append(h("div", { class: "grp" }, sel), h("div", { id: "era-desc", class: "note" }, `${c.note}／方針: ${STANCE_LABEL[c.stance]}(割り当てはゲーム上の仮のもの。1989・2019年にも改元があります)`));
  void app;
}
/** The era-change sheet: opens by itself when a kaigen is due; time is stopped until a name is chosen. */
export function buildKaigen(app: App, body: HTMLElement) {
  const sim = app.sim, k = sim?.kaigen; if (!sim || !k) { body.append(h("small", {}, "このデータには改元の仕組みがありません(旧形式のセーブ)")); return; }
  body.append(h("h3", {}, "改元"));
  body.append(h("div", { class: "issue", id: "kaigen-history" }, "元号の履歴: " + k.eras.map((e) => `${e.name}(${e.start}〜)`).join(" → ")));
  if (!k.pending) { body.append(h("div", { class: "issue" }, `次の改元: ${k.next}年ごろ(27〜33年間隔の暫定規則)`)); return; }
  const p = k.pending, real = p.year === 1989 || p.year === 2019;
  body.append(h("div", { class: "issue warn", id: "kaigen-window" }, `${p.year}年: 新しい元号を選んでください。時間は止まっています。`, h("br"), h("small", {}, real ? "候補は史実でこの年に挙がった案です(最初が実際に選ばれた元号)。方針の割り当てはゲーム上の仮のものです。" : "候補は暫定の生成規則による名前です(いろは順の漢字化+改元年の干支、画数の少ない順)。実在の元号ではありません。")));
  p.cands.forEach((c, i) => body.append(h("div", { class: "issue", id: "kaigen-cand-" + i }, `${c.name}(${STANCE_LABEL[c.stance]}) ${c.real ? "" : "【暫定規則】"}`, h("br"), h("small", {}, `${c.note}。${ERAS[c.stance].focus}`), h("div", { class: "row" }, h("button", { id: "kaigen-pick-" + i, onclick: () => app.chooseKaigen(i) }, `${c.name}にする`)))));
  body.append(h("small", {}, "これまでの元号の方針は、新しい元号のあとも一部が残って効き続けます。"));
}

const KIND_FILTER: Record<string, (k: string) => boolean> = {
  all: () => true, world: (k) => k === "world", domestic: (k) => k === "domestic" || k === "reform", policy: (k) => k === "policy",
  road: (k) => ["bypass", "route", "demote", "promote", "close", "dormant", "reopen", "crossing"].includes(k), rail: (k) => ["abolish", "reform"].includes(k), city: (k) => k === "city" || k === "village" || k === "boom",
};
const FILTER_LABEL: Record<string, string> = { all: "すべて", world: "世界", domestic: "国内", policy: "政策", road: "道路", rail: "鉄道・事業者", city: "人口" };
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
  if (cur !== null) body.append(h("div", { class: "issue warn", id: "atlas-readonly" }, `${cur}年を閲覧中(読み取り専用・時間は停止)。操作したい場合は「現在に戻る」を押してください。`));
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
    const row = h("div", { class: "row" }); for (const d of ["politics", "economy", "opinion"] as Domain[]) row.append(h("button", { id: "dom-" + d, class: dom === d ? "mode on" : "mode", "aria-pressed": dom === d ? "true" : "false", onclick: () => { ui3.domain = d; ui3.spend = {}; app.buildSheet(); } }, `${dom === d ? "✓ " : ""}${DOMAIN_LABEL[d]}`));
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
