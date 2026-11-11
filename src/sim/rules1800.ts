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

/**
 * Stage 40: the era stance moves the technology gates. A technology the era's stance favours comes earlier -- an experiment up to EARLY_EXPERIMENT_YEARS, practical service up to EARLY_SERVICE_YEARS --
 * but only in proportion to how long the game has lived under such eras (EXPOSURE_FULL_YEARS of exposure = the full shift), and never before the start year. 均衡 shifts nothing.
 * It is monotone: exposure only ever grows, so a gate once open stays open whatever era comes later, and a later era change speeds up (or stops speeding up) what comes after, it never undoes anything.
 * The 30-year shift is NOT used: diffusion (how fast lines, paving and airports spread) stays with the existing budgets, demand and geography; only the date a technology may be used moves.
 * Sea transport (ships, ports, ferries) is already in service in 1800: it has no gate to move; its stance acts through the existing policy dials.
 * (A FICTION/GAME RULE, not history: the 10/20-year maxima are a recommendation adopted provisionally with the user.)
 */
export const EARLY_EXPERIMENT_YEARS = 10, EARLY_SERVICE_YEARS = 20, EXPOSURE_FULL_YEARS = 20;
export const STANCE_TECHS: Record<string, readonly TechId[]> = { shubun: ["car", "expressway"], shoka: ["rail"], kuuro: ["plane", "airship"] };
type EraLike = { start: number; stance: string };
type SimTech = { startYear: number; kaigen?: { eras: readonly EraLike[] } };
/** Years of the game before `year` that were lived under an era whose stance favours `id`. */
export function stanceExposure(sim: SimTech, id: TechId, year: number): number {
  const eras = sim.kaigen?.eras; if (!eras?.length) return 0; let n = 0;
  for (let i = 0; i < eras.length; i++) { if (!STANCE_TECHS[eras[i].stance]?.includes(id)) continue; const a = Math.max(sim.startYear, eras[i].start), b = Math.min(year, i + 1 < eras.length ? eras[i + 1].start : year); if (b > a) n += b - a; }
  return n;
}
/** The year-`year` test of a gate whose unmoved year is `base` (`maxEarly` years at most earlier). */
export const gateOpen = (sim: SimTech, id: TechId, base: number, maxEarly: number, year: number): boolean => year >= Math.max(sim.startYear, base - maxEarly * Math.min(1, stanceExposure(sim, id, year) / EXPOSURE_FULL_YEARS));
export function techStageFor(sim: SimTech, id: TechId, year: number): TechStage { let s: TechStage = "none"; for (const e of T[id]) if (gateOpen(sim, id, e.year, e.stage === "experimental" ? EARLY_EXPERIMENT_YEARS : EARLY_SERVICE_YEARS, year)) s = e.stage; return s; }
export const mayScheduleServiceFor = (sim: SimTech, id: TechId, year: number) => techStageFor(sim, id, year) === "service";
/** The main-line railway's expansion year (1850), moved like a service gate. */
export const railMainlineOpen = (sim: SimTech, year: number) => gateOpen(sim, "rail", MILESTONES_1800.railMainline, EARLY_SERVICE_YEARS, year);
/** The years the airport rules (which are written in real years) are shifted by: scheduled air opens in 1920, which the airport rules call 1958; an early air service shifts it by the same amount. */
export const airShiftYears = (sim: SimTech, year: number): number => AIR_YEAR_SHIFT_1800 + EARLY_SERVICE_YEARS * Math.min(1, stanceExposure(sim, "plane", year) / EXPOSURE_FULL_YEARS);
/** 本線鉄道の拡大期(1850年〜)、飛行船の衰退(1940年〜)、統合多機関網(1950年〜)は、段階ではなく「普及の上限」を動かす年。 */
export const MILESTONES_1800 = { railMainline: 1850, airshipDecline: 1940, multimodal: 1950 } as const;
/** 定期旅客路線を作ってよいか(試験段階では作らない)。 */
export const mayScheduleService = (id: TechId, year: number) => techStage(id, year) === "service";

/** 遷都: 1800年から100年ごと(1900, 2000...)。改元とは独立(改元は別の20〜40年間隔)。 */
export const relocYears1800 = (upTo: number): number[] => { const out: number[] = []; for (let y = START_YEAR_1800 + RELOC_STEP_1800; y <= upTo; y += RELOC_STEP_1800) out.push(y); return out; };
export const nextReloc1800 = (year: number): number => START_YEAR_1800 + RELOC_STEP_1800 * (Math.floor((year - START_YEAR_1800) / RELOC_STEP_1800) + 1);

/**
 * 1800年の初期人口(ゲーム用推計。出典の数字そのものではない): 全国人口の推計(鬼頭宏の系列、国立社会保障・人口問題研究所の資料に掲載)
 * 1792年 29,869.7千人・1846年 32,297.2千人 を直線で補間した1800年 ≈ 30,229千人を、1950年国勢調査の全国人口 83,200千人(概数)で割った比を
 * 1950年の都市人口に一律に掛ける。県別・都市別の1800年の実数ではなく、都市の大小関係は1950年のものを流用している(既知の限界)。
 */
export const POP_1800_TOTAL_K = 29869.7 + (32297.2 - 29869.7) * (1800 - 1792) / (1846 - 1792), POP_1950_TOTAL_K = 83200, POP_1800_FACTOR = POP_1800_TOTAL_K / POP_1950_TOTAL_K;
/** 空港の判定(1958年に空港が開く等)は実年代で作られている。1800年開始では定期空路が1920年に始まるので、その判定には38年ずらした年を渡す(1920 → 1958)。 */
export const AIR_YEAR_SHIFT_1800 = 1958 - 1920;

/** 使った元号名は二度と出さない: 史実の候補→ランダム名の順に探し、どちらも尽きたら決定的な連番名(同じ入力なら同じ結果)。 */
export function pickEraName(used: ReadonlySet<string>, historic: readonly string[], random: readonly string[], seq: number): string {
  for (const n of historic) if (!used.has(n)) return n;
  for (const n of random) if (!used.has(n)) return n;
  let i = seq; for (;;) { const n = `新${i}`; if (!used.has(n)) return n; i++; }
}
