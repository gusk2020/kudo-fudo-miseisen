/**
 * Stage 36 / M2・M4・M5 の土台(1800年開始の架空史の規則)。純粋関数だけで、まだゲームのどこからも呼ばれない:
 * 呼ぶのは新規ゲームだけ(旧セーブの時間軸は書き換えない)。数値はすべて PR #59 の仕様コメント(2026-11-06)による。架空であり史実ではない。
 */
export const START_YEAR_1800 = 1800, RELOC_STEP_1800 = 100;

/** 経済の100年周期(世紀の始まりから): 好況50年・停滞30年・不況20年。遷都の選択に関わらず世紀ごとに好況へ戻る。 */
export type EconPhase = "boom" | "stagnation" | "recession";
export const ECON_CYCLE = { boom: 50, stagnation: 30, recession: 20 } as const;
export function econPhase(year: number): EconPhase {
  const y = ((Math.floor(year) % 100) + 100) % 100;
  return y < ECON_CYCLE.boom ? "boom" : y < ECON_CYCLE.boom + ECON_CYCLE.stagnation ? "stagnation" : "recession";
}
/** 周期内の位置(0..1): 同じ局面の中での進み具合。滑らかな効果の重み付けに使う。 */
export function econProgress(year: number): number {
  const y = ((year % 100) + 100) % 100, p = econPhase(year), from = p === "boom" ? 0 : p === "stagnation" ? 50 : 80, len = ECON_CYCLE[p];
  return Math.min(1, Math.max(0, (y - from) / len));
}

/** 交通技術: 固定の登場年。`service` は実際に旅客が使える段階、`experimental` は試験・実験のみ(定期路線を作ってはいけない)。 */
export type TechStage = "none" | "experimental" | "service";
export type TechId = "rail" | "airship" | "car" | "plane" | "expressway";
const T: Record<TechId, { year: number; stage: Exclude<TechStage, "none"> }[]> = {
  rail: [{ year: 1810, stage: "experimental" }, { year: 1830, stage: "service" }],   // 1850 は本線の拡大(段階ではなく普及度の話)
  airship: [{ year: 1860, stage: "experimental" }, { year: 1900, stage: "experimental" }],   // 1860 動力飛行船の試験 / 1900 硬式飛行船の実験。定期運航は仕様にない
  car: [{ year: 1890, stage: "experimental" }, { year: 1910, stage: "service" }],   // 1890 自動車・試験道路 / 1910 舗装拡大
  plane: [{ year: 1910, stage: "experimental" }, { year: 1920, stage: "service" }],   // 1920 定期航空
  expressway: [{ year: 1930, stage: "service" }],
};
export function techStage(id: TechId, year: number): TechStage { let s: TechStage = "none"; for (const e of T[id]) if (year >= e.year) s = e.stage; return s; }
/** 本線鉄道の拡大期(1850年〜)、飛行船の衰退(1940年〜)、統合多機関網(1950年〜)は、段階ではなく「普及の上限」を動かす年。 */
export const MILESTONES_1800 = { railMainline: 1850, airshipDecline: 1940, multimodal: 1950 } as const;
/** 定期旅客路線を作ってよいか(試験段階では作らない)。 */
export const mayScheduleService = (id: TechId, year: number) => techStage(id, year) === "service";

/** 遷都: 1800年から100年ごと(1900, 2000...)。改元とは独立(改元は別の20〜40年間隔)。 */
export const relocYears1800 = (upTo: number): number[] => { const out: number[] = []; for (let y = START_YEAR_1800 + RELOC_STEP_1800; y <= upTo; y += RELOC_STEP_1800) out.push(y); return out; };
export const nextReloc1800 = (year: number): number => START_YEAR_1800 + RELOC_STEP_1800 * (Math.floor((year - START_YEAR_1800) / RELOC_STEP_1800) + 1);

/** 使った元号名は二度と出さない: 史実の候補→ランダム名の順に探し、どちらも尽きたら決定的な連番名(同じ入力なら同じ結果)。 */
export function pickEraName(used: ReadonlySet<string>, historic: readonly string[], random: readonly string[], seq: number): string {
  for (const n of historic) if (!used.has(n)) return n;
  for (const n of random) if (!used.has(n)) return n;
  let i = seq; for (;;) { const n = `新${i}`; if (!used.has(n)) return n; i++; }
}
