import { cycleShape } from "./cycle27";
/**
 * The three world lines (世界線) and the dials they turn. Everything era-, event- or policy-dependent reaches the mechanics through
 * ONE object, `Dials`, so the mechanics (demand split, budgets, building appetite) never ask "which era is this?".
 *
 * 史実と架空モデルの区別 (kept explicit, because the whole point is not to blur them):
 *  - The profiles below are a MODEL: smooth keyframes chosen so the pattern of each world line is plausible. They are not statistics.
 *  - 平成 follows the real course of Japan's domestic economy and policy up to 2026 *in its events* (events.ts marks each as 史実/架空).
 *  - 修文 and 正化 are fictional: same world events, different domestic responses.
 */
import type { SimState } from "./types";
import { eraWeights } from "./kaigen";

/** The policy stances. heisei / shubun / shoka are the original three (均衡 / 道路重視 / 鉄道重視); kuuro (空路重視) and kairo (海路重視) were added in Issue #15; kobun is the legacy Stage 2 single era. */
export type EraKey = "heisei" | "shubun" | "shoka" | "kuuro" | "kairo" | "kobun";
export interface EraDef { key: EraKey; name: string; firstYear: number; summary: string; focus: string }
/** 1945: the Showa era ended (GHQ). Year 1 of the new era is 1945, so 1950 is year 6. 'kobun' is the legacy single era of Stage 2 saves. */
export const ERAS: Record<EraKey, EraDef> = {
  heisei: { key: "heisei", name: "平成", firstYear: 1945, focus: "バランス型・史実準拠", summary: "道路と鉄道を並行して整備。国内の政治・経済は2026年まで史実の流れに沿う(国鉄改革・バブル・人口減少)。" },
  shubun: { key: "shubun", name: "修文", firstYear: 1945, focus: "道路・自動車重視", summary: "自動車と高速道路を国策とした世界線。鉄道は早期に民営化・縮小され、自家用車中心の社会へ。" },
  shoka: { key: "shoka", name: "正化", firstYear: 1945, focus: "鉄道・公共交通重視", summary: "鉄道と公共交通を国策とした世界線。国鉄は維持され、都市間は鉄道が主役、道路は補完的。" },
  kuuro: { key: "kuuro", name: "空路型", firstYear: 1945, focus: "空路重視", summary: "空港と航空路線を国策の柱にした世界線。道路・鉄道は幹線に絞り、都市間の長距離は空へ。(空路の詳細な運航モデルは今後の拡張で、いまは空港の早期開港と航空分担の増加として表れる)" },
  kairo: { key: "kairo", name: "海路型", firstYear: 1945, focus: "海路重視", summary: "港湾と海上輸送・フェリーを国策の柱にした世界線。島や沿岸は船でつなぎ、海運の貨物分担が大きい。(海路の詳細な運航モデルは今後の拡張で、いまは港湾貨物の分担とフェリー・海峡連絡の優先として表れる)" },
  kobun: { key: "kobun", name: "光文", firstYear: 1945, focus: "旧版(Stage 2)", summary: "Stage 2で使っていた単一の架空元号。旧セーブ互換のために残してある。" },
};
export const SELECTABLE_ERAS: EraKey[] = ["heisei", "shubun", "shoka", "kuuro", "kairo"];
/** The three stances that have their own scripted history tables (events, straits); the air and sea stances read the 均衡 tables and say so. */
export const TABLE_STANCE = (e: EraKey): "heisei" | "shubun" | "shoka" | "kobun" => (e === "kuuro" || e === "kairo" ? "heisei" : e);
export const eraKeyOf = (s: string): EraKey => (s in ERAS ? (s as EraKey) : "kobun");
export const eraYearOf = (era: EraKey, calYear: number) => calYear - ERAS[era].firstYear + 1;
export const eraNameOf = (era: EraKey, calYear: number) => { const y = eraYearOf(era, calYear); return `${ERAS[era].name}${y === 1 ? "元" : y}年`; };

export interface Dials {
  roadShare: number;     // share of the unified transport budget that goes to roads (the rest to railways)
  carBias: number;       // how much more attractive the car is than its travel time alone says (-1..2)
  railBias: number;      // same for the train
  freightRail: number;   // freight's preference for rail over truck (-1..1)
  jnrSubsidy: number;    // share of the railway budget that supports the national (public) railway
  jnrFare: number;       // how much of its fare income the national railway really collects (public fares were held down: <1)
  railBuild: number;     // appetite for building railway (0..1.5)
  hwyBuild: number;      // appetite for building roads (0..1.5)
  hsr: number;           // appetite for high-speed rail / expressway upgrades (0..1.5)
  growth: number;        // multiplies the economy-driven budget (1 = trend)
  austerity: number;     // multiplies maintenance spending capacity (1 = normal; <1 = cuts)
  privatize: number;     // 0..1 progress of privatisation of the public railway
  airBias: number;       // Issue #15: how strongly the world favours air travel (airports earlier, a larger air share of long trips). 0 = the original model
  seaBias: number;       // Issue #15: how strongly it favours the sea (a larger sea share of coastal freight, ferries and strait links preferred). 0 = the original model
}
export const DIAL_KEYS = ["roadShare", "carBias", "railBias", "freightRail", "jnrSubsidy", "jnrFare", "railBuild", "hwyBuild", "hsr", "growth", "austerity", "privatize", "airBias", "seaBias"] as const;
export const DIAL_LABEL: Record<keyof Dials, string> = { roadShare: "道路への配分", carBias: "自動車の選好", railBias: "鉄道の選好", freightRail: "貨物の鉄道選好", jnrSubsidy: "国鉄への補助", jnrFare: "国鉄の運賃収入", railBuild: "鉄道建設の意欲", hwyBuild: "道路建設の意欲", hsr: "高速交通の意欲", growth: "経済成長", austerity: "維持費の余裕", privatize: "国鉄民営化の進度", airBias: "空路の選好", seaBias: "海路の選好" };
export const DIAL_RANGE: Record<keyof Dials, [number, number]> = { roadShare: [0.1, 0.9], carBias: [-1, 2], railBias: [-1, 1.5], freightRail: [-1, 1], jnrSubsidy: [0, 1], jnrFare: [0.25, 1.3], railBuild: [0, 1.5], hwyBuild: [0, 1.5], hsr: [0, 1.5], growth: [0.5, 1.6], austerity: [0.5, 1.3], privatize: [0, 1], airBias: [0, 1.5], seaBias: [0, 1.5] };
/** Stage 36: the one table that says what each policy dial is -- its name, range, what it acts on, what it does and the sentence the game shows. Descriptive only: no dial, range or effect is changed by it. */
export interface DialInfo { target: string; effect: string; explain: string }
export const DIAL_INFO: Record<keyof Dials, DialInfo> = {
  roadShare: { target: "統合予算", effect: "道路と鉄道への予算の割り振り", explain: "大きいほど予算が道路に回り、小さいほど鉄道に回ります" },
  carBias: { target: "旅客の手段選び", effect: "自動車の魅力を所要時間以上に上げ下げ", explain: "大きいほど自動車が選ばれやすくなります" },
  railBias: { target: "旅客の手段選び", effect: "鉄道の魅力を所要時間以上に上げ下げ", explain: "大きいほど鉄道が選ばれやすくなります" },
  freightRail: { target: "貨物の手段選び", effect: "貨物が鉄道とトラックのどちらを選ぶか", explain: "大きいほど貨物が鉄道に集まります" },
  jnrSubsidy: { target: "官営・国鉄の鉄道", effect: "鉄道予算のうち国の鉄道に回る割合", explain: "大きいほど国の鉄道が手厚く支えられます" },
  jnrFare: { target: "官営・国鉄の運賃", effect: "運賃収入のうち実際に集まる割合", explain: "小さいほど運賃が抑えられ、国の鉄道の収入が減ります" },
  railBuild: { target: "鉄道の新設", effect: "鉄道を新しく造る意欲", explain: "大きいほど新線の計画と着工が増えます" },
  hwyBuild: { target: "道路の新設", effect: "道路を新しく造る意欲", explain: "大きいほど道路の計画と着工が増えます" },
  hsr: { target: "高速鉄道・高速道路", effect: "高規格化への意欲", explain: "大きいほど新幹線や高速道路の整備が早く進みます" },
  growth: { target: "経済全体", effect: "景気から決まる予算の倍率", explain: "大きいほど使える建設予算が増えます" },
  austerity: { target: "維持費", effect: "維持にかけられる余裕", explain: "小さいほど維持費が削られ、休止や廃道が増えます" },
  privatize: { target: "国の鉄道", effect: "民営化の進み具合", explain: "大きいほど国の鉄道が民営化へ進みます" },
  airBias: { target: "航空", effect: "空港と空路への傾き", explain: "大きいほど空港が早く整い、長距離で空路が選ばれます" },
  seaBias: { target: "海運", effect: "港と海路への傾き", explain: "大きいほど沿岸貨物で海路が選ばれ、フェリーや海峡の連絡が優先されます" },
};
/** Stage 7: the most the policies in force may move one dial, as a share of the dial's range. */
export const POLICY_CAP = 0.12;
export const clampDial = (k: keyof Dials, v: number) => Math.max(DIAL_RANGE[k][0], Math.min(DIAL_RANGE[k][1], v));

type Key = [number, number][];   // [year, value] keyframes, linear between them, flat outside
const at = (k: Key, y: number) => { if (y <= k[0][0]) return k[0][1]; for (let i = 1; i < k.length; i++) if (y <= k[i][0]) { const [a, va] = k[i - 1], [b, vb] = k[i]; return va + ((vb - va) * (y - a)) / (b - a); } return k[k.length - 1][1]; };
const NONE: Key = [[1950, 0], [2100, 0]];
type Profile = Record<Exclude<keyof Dials, "airBias" | "seaBias">, Key> & Partial<Record<"airBias" | "seaBias", Key>>;
const PROFILE: Record<"heisei" | "shubun" | "shoka" | "kobun", Profile> = {
  heisei: {
    roadShare: [[1950, 0.3], [1960, 0.42], [1975, 0.58], [1995, 0.62], [2015, 0.55], [2100, 0.5]],
    carBias: [[1950, -0.4], [1960, 0.25], [1970, 1.0], [1980, 1.4], [1995, 1.6], [2100, 1.4]],
    railBias: [[1950, 0.45], [1970, 0.15], [1995, 0.05], [2100, 0.1]],
    freightRail: [[1950, 0.45], [1975, 0.05], [1995, -0.3], [2100, -0.3]],
    jnrSubsidy: [[1950, 0.75], [1970, 0.7], [1976, 0.45], [1982, 0.3], [1986, 0.2], [1987, 0.12], [2100, 0.1]],
    jnrFare: [[1950, 1], [1965, 0.8], [1975, 0.42], [1982, 0.3], [1986, 0.25], [1987, 1], [2100, 1]],
    railBuild: [[1950, 0.5], [1964, 0.85], [1975, 0.5], [1990, 0.3], [2010, 0.2], [2100, 0.15]],
    hwyBuild: [[1950, 0.35], [1970, 0.9], [1990, 0.85], [2005, 0.4], [2100, 0.3]],
    hsr: [[1950, 0], [1958, 0.2], [1964, 0.9], [1990, 0.6], [2100, 0.4]],
    growth: [[1950, 1], [2100, 1]], austerity: [[1950, 1], [2100, 1]], privatize: [[1950, 0], [1986, 0], [1987, 1], [2100, 1]],
  },
  shubun: {
    roadShare: [[1950, 0.36], [1960, 0.56], [1975, 0.76], [2000, 0.8], [2100, 0.78]],
    carBias: [[1950, -0.2], [1960, 0.5], [1970, 1.4], [1980, 1.9], [2000, 2], [2100, 2]],
    railBias: [[1950, 0.3], [1975, -0.2], [2000, -0.4], [2100, -0.4]],
    freightRail: [[1950, 0.35], [1965, -0.2], [1985, -0.6], [2100, -0.6]],
    jnrSubsidy: [[1950, 0.65], [1960, 0.5], [1966, 0.3], [1972, 0.2], [1973, 0.08], [2100, 0.05]],
    jnrFare: [[1950, 1], [1960, 0.8], [1967, 0.4], [1972, 0.28], [1973, 1], [2100, 1]],
    railBuild: [[1950, 0.45], [1962, 0.3], [1975, 0.12], [2100, 0.06]],
    hwyBuild: [[1950, 0.5], [1960, 0.95], [1990, 1.1], [2100, 0.7]],
    hsr: [[1950, 0], [1975, 0.5], [1990, 1.1], [2100, 0.8]],
    growth: [[1950, 1], [2100, 1]], austerity: [[1950, 1], [2100, 1]], privatize: [[1950, 0], [1972, 0], [1973, 1], [2100, 1]],
  },
  shoka: {
    roadShare: [[1950, 0.26], [1975, 0.32], [2100, 0.34]],
    carBias: [[1950, -0.7], [1970, 0], [1990, 0.4], [2100, 0.4]],
    railBias: [[1950, 0.6], [1975, 0.6], [2100, 0.6]],
    freightRail: [[1950, 0.5], [1975, 0.3], [2100, 0.25]],
    jnrSubsidy: [[1950, 0.85], [2100, 0.8]],
    jnrFare: [[1950, 1], [1980, 0.85], [2100, 0.85]],
    railBuild: [[1950, 0.65], [1962, 0.9], [1985, 0.75], [2100, 0.5]],
    hwyBuild: [[1950, 0.25], [1975, 0.4], [2100, 0.25]],
    hsr: [[1950, 0.1], [1955, 0.7], [1990, 1], [2100, 0.8]],
    growth: [[1950, 1], [2100, 1]], austerity: [[1950, 1], [2100, 1]], privatize: [[1950, 0], [2100, 0]],
  },
  kobun: { // legacy: roads only (the Stage 2 world). No railway is ever built there, so rail dials never matter.
    roadShare: [[1950, 1], [2100, 1]], carBias: [[1950, 0], [2100, 0]], railBias: [[1950, 0], [2100, 0]], freightRail: [[1950, 0], [2100, 0]], jnrSubsidy: [[1950, 0.5], [2100, 0.5]], jnrFare: [[1950, 1], [2100, 1]],
    railBuild: [[1950, 0], [2100, 0]], hwyBuild: [[1950, 1], [2100, 1]], hsr: [[1950, 0], [2100, 0]], growth: [[1950, 1], [2100, 1]], austerity: [[1950, 1], [2100, 1]], privatize: [[1950, 0], [2100, 0]],
  },
};
/** The era's own baseline for a year (before any event or policy). */
/**
 * The air and sea stances are the 均衡 profile with a different centre of gravity (Issue #15). They are written as differences from it, so a change to the
 * balanced world line flows through. Only the dials listed here differ; the air / sea bias is what the later detailed models will hang on.
 */
const AIR: Partial<Record<keyof Dials, Key>> = {
  roadShare: [[1950, 0.3], [1975, 0.45], [2100, 0.4]], railBuild: [[1950, 0.45], [1964, 0.6], [1990, 0.2], [2100, 0.1]], hsr: [[1950, 0], [1964, 0.5], [2100, 0.3]],
  hwyBuild: [[1950, 0.3], [1970, 0.7], [2005, 0.35], [2100, 0.25]], airBias: [[1950, 0.1], [1960, 0.5], [1975, 1.0], [2100, 1.3]], seaBias: [[1950, 0.1], [2100, 0.1]], carBias: [[1950, -0.4], [1970, 0.6], [1995, 1.0], [2100, 0.9]],
};
const SEA: Partial<Record<keyof Dials, Key>> = {
  roadShare: [[1950, 0.28], [1975, 0.45], [2100, 0.42]], railBuild: [[1950, 0.45], [1964, 0.6], [1990, 0.25], [2100, 0.12]], hwyBuild: [[1950, 0.3], [1970, 0.7], [2005, 0.3], [2100, 0.22]],
  seaBias: [[1950, 0.3], [1970, 1.0], [2100, 1.2]], airBias: [[1950, 0.05], [2100, 0.2]], freightRail: [[1950, 0.3], [1975, -0.1], [2100, -0.4]],
};
export function baseDials(era: EraKey, year: number): Dials {
  const over = era === "kuuro" ? AIR : era === "kairo" ? SEA : null, p = PROFILE[over ? "heisei" : (era as "heisei")], d = {} as Dials;
  for (const k of DIAL_KEYS) d[k] = at(over?.[k] ?? (p as Profile)[k] ?? NONE, year);
  return d;
}
/** Issue #13: with an era timeline the baseline is a weighted blend of the stances chosen so far (see eraWeights): earlier choices keep a share. */
export function blendedDials(eras: { stance: EraKey; start: number }[], year: number): Dials {
  const w = eraWeights(eras as never, year), out = {} as Dials; for (const k of DIAL_KEYS) out[k] = 0;
  const cache = new Map<EraKey, Dials>();
  eras.forEach((e, i) => { if (!w[i]) return; const b = cache.get(e.stance) ?? baseDials(e.stance, year); cache.set(e.stance, b); for (const k of DIAL_KEYS) out[k] += w[i] * b[k]; });
  return out;
}
/** A time-limited nudge to the dials, from an event or a policy. `d` is additive; the reason is kept so the timeline can say why. */
export interface Mod { id: string; kind: "event" | "policy"; label: string; from: number; until: number; d: Partial<Dials> }
/** Baseline + every active mod, clamped. The only place dials are composed. */
export function composeDials(sim: Pick<SimState, "era" | "mods" | "kaigen"> & Partial<Pick<SimState, "e2200" | "rules1800">>, year: number): Dials {
  const d = sim.kaigen ? blendedDials(sim.kaigen.eras, year) : baseDials(eraKeyOf(sim.era), year);
  const pol = {} as Record<keyof Dials, number>; for (const k of DIAL_KEYS) pol[k] = 0;
  for (const m of sim.mods) if (year >= m.from && year < m.until) for (const k of DIAL_KEYS) { const v = m.d[k]; if (!v) continue; if (m.kind === "policy") pol[k] += v; else d[k] += v; }
  // Stage 7: the ten-yearly policies together may move a dial by at most POLICY_CAP of its range, so a policy steers within the world line and never replaces it
  for (const k of DIAL_KEYS) { const cap = POLICY_CAP * (DIAL_RANGE[k][1] - DIAL_RANGE[k][0]); d[k] += Math.max(-cap, Math.min(cap, pol[k])); d[k] = clampDial(k, d[k]); }
  const cs = cycleShape(sim.e2200, year, !!sim.rules1800);   // Stage 27: the 150-year cycle moves the appetite to build, and nothing else
  if (cs) { for (const k of ["hwyBuild", "railBuild"] as const) d[k] = clampDial(k, Math.max(d[k], cs.build) * cs.damp); for (const k of ["airBias", "seaBias"] as const) d[k] = clampDial(k, Math.max(d[k], cs.airsea) * cs.damp); }
  return d;
}
