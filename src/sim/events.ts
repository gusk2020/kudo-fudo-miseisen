/**
 * Events that move the dials: world events common to every world line, domestic events that differ by line, and (after 2026)
 * long-trend and random events.
 *
 * 史実/架空 is a property of every entry (`real`): international events are real history for all three lines (the world outside Japan is
 * the same); domestic events are real history only on 平成 and only up to 2026; on 修文 and 正化 the domestic side is a fictional response
 * to the same world, written as such. From 2027 on everything is a model: trends plus seeded random events, never history.
 *
 * The numbers in `d` are a toy model's, not measurements. They only have to push the right dial in the right direction.
 */
import type { Dials, EraKey } from "./eras";
import { eraKeyOf, type Mod } from "./eras";
import { ev, rand } from "./engine";
import type { SimState } from "./types";

type Delta = Partial<Dials>;
interface Variant { text: string; real: boolean; d: Delta; years: number; cause?: string }
export interface HistEvent { id: string; year: number; title: string; scope: "intl" | "domestic"; all?: Variant; heisei?: Variant; shubun?: Variant; shoka?: Variant }
const V = (text: string, real: boolean, d: Delta, years: number, cause?: string): Variant => ({ text, real, d, years, cause });

export const HIST_EVENTS: HistEvent[] = [
  { id: "korean-war", year: 1950, title: "朝鮮戦争", scope: "intl", all: V("朝鮮戦争(1950-53)で特需景気", true, { growth: 0.1 }, 3, "米軍の物資調達が国内産業を押し上げた") },
  { id: "regime-55", year: 1955, title: "政治体制の固定化", scope: "domestic",
    heisei: V("55年体制が成立し、長期の保守政権が続く", true, { growth: 0.04 }, 10, "政治が安定し、公共事業が計画的に進む"),
    shubun: V("自動車産業界と結んだ保守政権が成立(架空)", false, { hwyBuild: 0.15, roadShare: 0.05 }, 15, "自動車産業の政治力が強い世界線"),
    shoka: V("鉄道・公共交通を国の基盤とする改革政権が成立(架空)", false, { railBuild: 0.2, jnrSubsidy: 0.05 }, 15, "公共交通の整備を重視する世界線") },
  { id: "boom", year: 1956, title: "高度経済成長", scope: "domestic",
    heisei: V("神武景気に始まる高度経済成長(〜1973)", true, { growth: 0.14 }, 17, "「もはや戦後ではない」と言われた好況"),
    shubun: V("自動車と道路を軸にした高度成長(架空)", false, { growth: 0.14, hwyBuild: 0.2 }, 17, "道路投資が成長を牽引"),
    shoka: V("鉄道と都市開発を軸にした高度成長(架空)", false, { growth: 0.14, railBuild: 0.2 }, 17, "鉄道投資が成長を牽引") },
  { id: "suez", year: 1956, title: "スエズ危機", scope: "intl", all: V("スエズ危機で石油供給に不安", true, { growth: -0.02, carBias: -0.05 }, 1) },
  { id: "income-doubling", year: 1960, title: "所得倍増計画", scope: "domestic",
    heisei: V("国民所得倍増計画が決定", true, { growth: 0.06, hwyBuild: 0.1, railBuild: 0.1 }, 8, "公共投資を拡大する方針"),
    shubun: V("所得倍増計画。道路網整備に重点(架空)", false, { growth: 0.06, hwyBuild: 0.25 }, 8, "道路中心の計画"),
    shoka: V("所得倍増計画。幹線鉄道網整備に重点(架空)", false, { growth: 0.06, railBuild: 0.25, hsr: 0.15 }, 8, "鉄道中心の計画") },
  { id: "olympic", year: 1964, title: "東京五輪・幹線整備", scope: "domestic",
    heisei: V("東京五輪と東海道新幹線の開業", true, { hsr: 0.4, railBuild: 0.25, hwyBuild: 0.2 }, 6, "高速鉄道と首都高速など都市インフラが集中整備された"),
    shubun: V("東京五輪と首都高速・名神高速の整備(架空)", false, { hsr: 0.1, hwyBuild: 0.4, roadShare: 0.05 }, 6, "高速道路網が先行する世界線"),
    shoka: V("東京五輪と高速鉄道網の大規模整備(架空)", false, { hsr: 0.55, railBuild: 0.35 }, 6, "新幹線網が先行する世界線") },
  { id: "cuba", year: 1962, title: "キューバ危機", scope: "intl", all: V("キューバ危機。世界の緊張が高まる", true, { growth: -0.01 }, 1) },
  { id: "vietnam", year: 1965, title: "ベトナム戦争の本格化", scope: "intl", all: V("ベトナム戦争の本格化で輸出・特需が増える", true, { growth: 0.04 }, 6) },
  { id: "meishin", year: 1965, title: "高速道路の開通", scope: "domestic",
    heisei: V("名神高速道路が全通", true, { hwyBuild: 0.2, carBias: 0.1 }, 5, "自動車交通が本格化"),
    shubun: V("国土を結ぶ高速道路網が急拡大(架空)", false, { hwyBuild: 0.35, carBias: 0.2 }, 8, "自動車国策の世界線"),
    shoka: V("高速道路は主要都市間に限定される(架空)", false, { hwyBuild: 0.05 }, 5, "鉄道優先のため道路は補完") },
  { id: "expo", year: 1970, title: "大阪万博", scope: "domestic", heisei: V("大阪万博。交通需要が一時的に高まる", true, { growth: 0.03, railBias: 0.05 }, 2) },
  { id: "nixon", year: 1971, title: "ニクソン・ショック", scope: "intl", all: V("ドル切り下げで円高圧力", true, { growth: -0.05 }, 2) },
  { id: "remodel", year: 1972, title: "列島改造", scope: "domestic",
    heisei: V("日本列島改造論。全国で開発構想が膨らむ", true, { hwyBuild: 0.25, railBuild: 0.2, growth: 0.04 }, 2, "公共事業が急拡大した"),
    shubun: V("全国高速道路網の大構想(架空)", false, { hwyBuild: 0.4, growth: 0.04 }, 3, "道路の大構想"),
    shoka: V("全国新幹線網の大構想(架空)", false, { railBuild: 0.35, hsr: 0.3, growth: 0.04 }, 3, "鉄道の大構想") },
  { id: "oil1", year: 1973, title: "第一次石油危機", scope: "intl", all: V("第一次石油危機。燃料が高騰し景気が後退", true, { growth: -0.16, austerity: -0.12, carBias: -0.3, hwyBuild: -0.2 }, 3, "原油価格が約4倍に") },
  { id: "oil2", year: 1979, title: "第二次石油危機", scope: "intl", all: V("第二次石油危機", true, { growth: -0.07, carBias: -0.15 }, 2) },
  { id: "jnr-crisis", year: 1980, title: "公的鉄道の赤字問題", scope: "domestic",
    heisei: V("国鉄の巨額赤字が政治問題に。ローカル線の見直しが始まる", true, { jnrSubsidy: -0.05, railBuild: -0.15 }, 7, "赤字ローカル線対策法など再建策が進む"),
    shubun: V("鉄道の赤字見直しは完了済み(架空)", false, { railBuild: -0.03 }, 5),
    shoka: V("鉄道赤字は運賃改定と補助で吸収(架空)", false, { jnrSubsidy: 0.03 }, 8, "公共交通は国が支える方針") },
  { id: "plaza", year: 1985, title: "プラザ合意", scope: "intl", all: V("プラザ合意で円高が進む", true, { growth: -0.02 }, 2) },
  { id: "bubble", year: 1986, title: "バブル景気", scope: "domestic",
    heisei: V("バブル景気。内需拡大で開発が活発に", true, { growth: 0.12, hwyBuild: 0.2, railBuild: 0.1 }, 5, "地価と株価の上昇が投資を後押し"),
    shubun: V("バブル景気。高速道路と郊外開発が拡大(架空)", false, { growth: 0.12, hwyBuild: 0.3 }, 5),
    shoka: V("バブル景気。新幹線と都市再開発が拡大(架空)", false, { growth: 0.12, railBuild: 0.2, hsr: 0.2 }, 5) },
  { id: "cold-war-end", year: 1989, title: "冷戦の終結", scope: "intl", all: V("冷戦の終結(ベルリンの壁崩壊)", true, { growth: 0.02 }, 2) },
  { id: "bubble-burst", year: 1991, title: "バブル崩壊", scope: "domestic",
    heisei: V("バブル崩壊。長い景気低迷へ", true, { growth: -0.1, austerity: -0.05 }, 10, "資産価格が急落"),
    shubun: V("バブル崩壊。長い景気低迷へ(架空)", false, { growth: -0.1, austerity: -0.05 }, 10),
    shoka: V("バブル崩壊。長い景気低迷へ(架空)", false, { growth: -0.1, austerity: -0.05 }, 10) },
  { id: "gulf", year: 1991, title: "湾岸戦争・ソ連崩壊", scope: "intl", all: V("湾岸戦争とソ連崩壊で国際秩序が変わる", true, { growth: -0.02 }, 2) },
  { id: "hanshin", year: 1995, title: "大震災", scope: "domestic",
    heisei: V("阪神・淡路大震災(1995)", true, { austerity: -0.05, growth: -0.02 }, 2, "復旧に交通網の予算が振り向けられた"),
    shubun: V("関西で大地震(架空)", false, { austerity: -0.05 }, 2), shoka: V("関西で大地震(架空)", false, { austerity: -0.05 }, 2) },
  { id: "asia-crisis", year: 1997, title: "アジア通貨危機", scope: "intl", all: V("アジア通貨危機と国内金融不安", true, { growth: -0.06 }, 3) },
  { id: "reform-2001", year: 2001, title: "構造改革", scope: "domestic",
    heisei: V("構造改革で公共事業が削減される", true, { hwyBuild: -0.2, railBuild: -0.05, austerity: -0.04 }, 6, "財政再建のため投資が抑えられた"),
    shubun: V("構造改革。道路特定財源は維持される(架空)", false, { hwyBuild: -0.08, austerity: -0.04 }, 6),
    shoka: V("構造改革。鉄道・公共交通は例外とされる(架空)", false, { hwyBuild: -0.1, austerity: -0.03 }, 6) },
  { id: "911", year: 2001, title: "同時多発テロ", scope: "intl", all: V("同時多発テロ。世界経済が一時冷え込む", true, { growth: -0.04 }, 2) },
  { id: "lehman", year: 2008, title: "リーマン・ショック", scope: "intl", all: V("リーマン・ショック。世界同時不況", true, { growth: -0.14, austerity: -0.08 }, 3) },
  { id: "dpj", year: 2009, title: "政権交代", scope: "domestic",
    heisei: V("政権交代。公共事業を見直す方針", true, { hwyBuild: -0.2, railBuild: 0.03 }, 3, "「コンクリートから人へ」"),
    shubun: V("政権交代。道路整備の見直しが議論される(架空)", false, { hwyBuild: -0.12 }, 3),
    shoka: V("政権交代。公共交通の再編が議論される(架空)", false, { railBuild: -0.05 }, 3) },
  { id: "tohoku", year: 2011, title: "東日本大震災", scope: "domestic",
    heisei: V("東日本大震災。東北の鉄道・道路が大きな被害", true, { austerity: -0.08, growth: -0.03, hwyBuild: 0.05 }, 3, "復旧・復興が最優先となった"),
    shubun: V("東北で大地震と津波(架空)", false, { austerity: -0.08, growth: -0.03 }, 3), shoka: V("東北で大地震と津波(架空)", false, { austerity: -0.08, growth: -0.03 }, 3) },
  { id: "abe", year: 2013, title: "金融緩和・国土強靱化", scope: "domestic",
    heisei: V("金融緩和と国土強靱化で公共投資が増える", true, { growth: 0.05, hwyBuild: 0.12 }, 6, "インフラの老朽化対策も重視された"),
    shubun: V("国土強靱化。道路の老朽化対策が中心(架空)", false, { growth: 0.04, hwyBuild: 0.12 }, 6),
    shoka: V("国土強靱化。鉄道・橋梁の老朽化対策が中心(架空)", false, { growth: 0.04, railBuild: 0.1 }, 6) },
  { id: "covid", year: 2020, title: "新型コロナ", scope: "intl", all: V("新型コロナ。移動需要が急減し、公共交通の利用が落ち込む", true, { growth: -0.1, railBias: -0.15, austerity: -0.05 }, 3) },
  { id: "ukraine", year: 2022, title: "ウクライナ侵攻", scope: "intl", all: V("ウクライナ侵攻でエネルギー価格が高騰", true, { growth: -0.04, carBias: -0.08 }, 2) },
  { id: "recent", year: 2024, title: "近年の動向", scope: "domestic",
    heisei: V("物価高と人手不足。地方の公共交通の維持が課題に", true, { austerity: -0.04, railBuild: 0.02 }, 3, "運転士・保守要員の不足"),
    shubun: V("物価高と人手不足。道路の維持管理が課題に(架空)", false, { austerity: -0.04 }, 3),
    shoka: V("物価高と人手不足。鉄道の維持が課題に(架空)", false, { austerity: -0.04 }, 3) },
];
export const REAL_HISTORY_UNTIL = 2026;

const FUTURE: { id: string; text: string; d: Delta; years: number; cause: string; weight: number }[] = [
  { id: "f-boom", text: "好況期に入る", d: { growth: 0.08 }, years: 4, cause: "長期トレンドからの景気循環(確率的)", weight: 3 },
  { id: "f-slump", text: "景気後退", d: { growth: -0.09, austerity: -0.05 }, years: 3, cause: "景気循環(確率的)", weight: 3 },
  { id: "f-disaster", text: "大規模災害で交通網に被害", d: { austerity: -0.08, growth: -0.02 }, years: 2, cause: "自然災害(確率的)", weight: 2 },
  { id: "f-energy", text: "エネルギー価格が高騰", d: { carBias: -0.15, growth: -0.03 }, years: 3, cause: "資源市場の変動(確率的)", weight: 2 },
  { id: "f-selfdrive", text: "自動運転・EVが普及し自動車の利便性が上がる", d: { carBias: 0.2, hwyBuild: 0.05 }, years: 10, cause: "技術革新(確率的)", weight: 2 },
  { id: "f-railtech", text: "鉄道の省力化・高速化技術が普及", d: { railBias: 0.15, hsr: 0.1 }, years: 10, cause: "技術革新(確率的)", weight: 2 },
  { id: "f-shrink", text: "人口減少が加速し、維持費が重くのしかかる", d: { austerity: -0.07 }, years: 8, cause: "人口動態の長期トレンド", weight: 3 },
  { id: "f-stimulus", text: "大型の景気対策", d: { growth: 0.06, hwyBuild: 0.1, railBuild: 0.1 }, years: 3, cause: "政権の判断(確率的)", weight: 2 },
];

/** Fire this year's events. Deterministic: history is a table, the future draws from the sim's own random stream. */
export function applyYearEvents(sim: SimState, y: number): void {
  const era = eraKeyOf(sim.era); if (era === "kobun") return;
  for (const h of HIST_EVENTS) {
    if (h.year !== y || y > REAL_HISTORY_UNTIL) continue;
    const v: Variant | undefined = h[era as "heisei"] ?? h.all; if (!v) continue;
    push(sim, y, h.id, v.text, v.real, v.d, v.years, v.cause ?? "", h.scope);
  }
  if (y > REAL_HISTORY_UNTIL && (y - REAL_HISTORY_UNTIL) % 1 === 0) {
    // from 2027: a trend plus chance, never history. About one event every 2-3 years.
    if (rand(sim) < 0.4) {
      const tot = FUTURE.reduce((s, f) => s + f.weight, 0); let r = rand(sim) * tot, pick = FUTURE[0];
      for (const f of FUTURE) { r -= f.weight; if (r <= 0) { pick = f; break; } }
      push(sim, y, `${pick.id}-${y}`, pick.text, false, pick.d, pick.years, pick.cause, "domestic", true);
    } else rand(sim), rand(sim);
  }
}
function push(sim: SimState, y: number, id: string, text: string, real: boolean, d: Delta, years: number, cause: string, scope: "intl" | "domestic", future = false) {
  const m: Mod = { id, kind: "event", label: text, from: y, until: y + years, d }; sim.mods.push(m);
  const tag = future ? "【予測モデル】" : real ? "【史実】" : "【架空】", eff = Object.keys(d).length ? ` 影響: ${effectText(d)}` : "";
  ev(sim, scope === "intl" ? "world" : "domestic", `${tag}${text}`, `${cause || "世界の動き"}${eff}`, {});
  if (sim.mods.length > 160) sim.mods.splice(0, sim.mods.length - 160);
}
export const DIAL_SHORT: Record<keyof Dials, string> = { roadShare: "道路配分", carBias: "自動車選好", railBias: "鉄道選好", freightRail: "貨物鉄道選好", jnrSubsidy: "国鉄補助", railBuild: "鉄道建設", hwyBuild: "道路建設", hsr: "高速交通", growth: "成長", austerity: "維持費余裕", privatize: "民営化" };
export const effectText = (d: Delta) => Object.entries(d).map(([k, v]) => `${DIAL_SHORT[k as keyof Dials]}${(v as number) > 0 ? "+" : ""}${Math.round((v as number) * 100)}%`).join("・");
export type { EraKey };
