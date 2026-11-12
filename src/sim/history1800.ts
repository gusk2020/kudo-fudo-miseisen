/**
 * Stage 36: what an 1800 game's timeline (年表) and atlas (地図帳) say about transport technology and the fictional history.
 * Every row is a milestone with a PHASE so that experiment, service, spread and decline are never confused:
 *   experiment  試験・実験: tried, nothing usable by passengers (never creates a scheduled route);
 *   service     実用: ordinary passengers can use it (a scheduled route may exist);
 *   spread      普及: it expands (more lines, more paving);
 *   decline     衰退: it is giving way to something else.
 * The years of the technology rows are the fixed unlock years of the specification (PR #59). The fictional-history rows (開国圧力・維新・土木技術者への転身) have NO year in the specification:
 * their years below are GAME ASSUMPTIONS chosen to sit before the 1830 public railway, and are marked 【架空】 on screen. Nothing here is a claim about real history except where a row says 【史実】.
 */
import { ev } from "./engine";
import { EARLY_EXPERIMENT_YEARS, EARLY_SERVICE_YEARS, gateOpen, type TechId } from "./rules1800";
import type { SimState } from "./types";

export type Phase = "experiment" | "service" | "spread" | "decline";
export const PHASE_LABEL: Record<Phase, string> = { experiment: "試験・実験", service: "実用", spread: "普及", decline: "衰退" };
export interface Milestone { year: number; id: string; tech: string; phase: Phase; text: string; cause: string; real: boolean }
export const TECH_MILESTONES: readonly Milestone[] = [
  { year: 1810, id: "rail-exp", tech: "鉄道", phase: "experiment", text: "産業用・実験的な鉄道が試みられた(旅客は乗れない)", cause: "仕様: 1810年は産業用・実験の段階。定期の旅客路線は作られない", real: false },
  { year: 1830, id: "rail-svc", tech: "鉄道", phase: "service", text: "鉄道の旅客営業が始まった(官営鉄道)", cause: "仕様: 1830年に公共の鉄道。これ以後、鉄道の計画が立つ", real: false },
  { year: 1830, id: "ship-steam", tech: "船舶", phase: "service", text: "蒸気船の定期航路が始まり、渡船と港の輸送が速くなった(帆船の渡船は1800年から)", cause: "仕様(Stage 40): 海路は1800年から実用。蒸気船は1830年(海路重視の元号では最大20年早まる)。渡船の速さ×1.35", real: false },
  { year: 1880, id: "ship-steel", tech: "船舶", phase: "spread", text: "鋼鉄の汽船が広まり、渡船と港の輸送がさらに速くなった", cause: "仕様(Stage 40): 鋼鉄の汽船は1880年(海路重視の元号では最大20年早まる)。渡船の速さ×1.8", real: false },
  { year: 1850, id: "rail-spread", tech: "鉄道", phase: "spread", text: "本線の鉄道が各地へ広がり始めた", cause: "仕様: 1850年から本線の拡大期。島をまたぐ鉄道の固定連絡も計画できる", real: false },
  { year: 1860, id: "airship-exp", tech: "飛行船", phase: "experiment", text: "動力つきの飛行船が試験飛行された(定期の運航はない)", cause: "仕様: 1860年は試験段階。空路は作られない", real: false },
  { year: 1890, id: "car-exp", tech: "自動車", phase: "experiment", text: "自動車と試験用の道路が現れた", cause: "仕様: 1890年は自動車・試験道路の段階", real: false },
  { year: 1900, id: "airship-rigid", tech: "飛行船", phase: "experiment", text: "硬式飛行船の実験が行われた(まだ旅客の定期運航ではない)", cause: "仕様: 1900年は硬式飛行船の実験段階", real: false },
  { year: 1910, id: "car-spread", tech: "自動車", phase: "spread", text: "道路の舗装が広がり、島をまたぐ道路の固定連絡も計画できるようになった", cause: "仕様: 1910年に自動車道の舗装が拡大", real: false },
  { year: 1910, id: "plane-exp", tech: "飛行機", phase: "experiment", text: "飛行機の試験飛行が始まった(定期便はまだない)", cause: "仕様: 1910年は飛行機の試験段階", real: false },
  { year: 1920, id: "plane-svc", tech: "飛行機", phase: "service", text: "定期の航空路が始まる条件が整った(空港と空路が作られうる)", cause: "仕様: 1920年から定期の航空", real: false },
  { year: 1930, id: "hwy-svc", tech: "高速道路", phase: "service", text: "高速道路が作られうるようになった", cause: "仕様: 1930年から高速道路", real: false },
  { year: 1940, id: "airship-decline", tech: "飛行船", phase: "decline", text: "航空機の進歩で飛行船が衰退した", cause: "仕様: 1940年に航空機が進み、飛行船は衰退", real: false },
  { year: 1950, id: "multimodal", tech: "総合交通", phase: "spread", text: "道路・鉄道・海・空を組み合わせた総合交通網の時代に入った", cause: "仕様: 1950年に統合された複合交通", real: false },
];
/** The fictional history (game assumptions for the years; see the file header). */
export const FICTION_1800: readonly Milestone[] = [
  { year: 1800, id: "fiction-start", tech: "世界線", phase: "experiment", text: "【架空】この世界は史実ではない架空の日本で、1800年から始まる", cause: "1800年開始の設定。出来事・年はゲーム上の想定で、史実ではない", real: false },
  { year: 1800, id: "ino-map", tech: "地図", phase: "service", text: "【史実】伊能忠敬が全国の測量を始めた。この世界では測量の成果が早くから国の道づくりに使われる", cause: "史実の測量開始は1800年(1816年に実地測量を終える)。成果の活用の早さは架空", real: true },
  { year: 1808, id: "foreign-pressure", tech: "世界線", phase: "experiment", text: "【架空】外国船の来航による圧力が、史実より約半世紀早く強まった", cause: "架空史の想定(年はゲーム上の仮定)。史実の開国は1850年代", real: false },
  { year: 1815, id: "industrial-info", tech: "世界線", phase: "experiment", text: "【架空】蒸気機関や工業の情報が早い時期に入り、国が鉄道を研究し始めた", cause: "架空史の想定(年はゲーム上の仮定)。1810年の鉄道の試験の背景", real: false },
  { year: 1825, id: "restoration", tech: "世界線", phase: "experiment", text: "【架空】史実より早く、明治維新に似た体制の転換が起きた", cause: "架空史の想定(年はゲーム上の仮定)。1830年の官営鉄道の前提", real: false },
  { year: 1826, id: "engineers", tech: "世界線", phase: "experiment", text: "【架空】徳川家と武士の多くが、土木技術者として国づくりに転身した", cause: "架空史の想定(年はゲーム上の仮定)。道路・港・鉄道の建設を担う", real: false },
];
export const ALL_MILESTONES: readonly Milestone[] = [...FICTION_1800, ...TECH_MILESTONES].slice().sort((a, b) => a.year - b.year);

/** Stage 40: the technology rows whose date moves with the era stance: the technology and how many years earlier it may come at most. Every other row (the fictional history, the decline of airships, the 1950 multimodal era) has a fixed year. The simulation's gates (rules1800.ts gateOpen) are the very same test, so the timeline and the atlas show exactly when something really became usable. */
export const MOVABLE: Record<string, { id: TechId; early: number }> = {
  "rail-exp": { id: "rail", early: EARLY_EXPERIMENT_YEARS }, "rail-svc": { id: "rail", early: EARLY_SERVICE_YEARS }, "rail-spread": { id: "rail", early: EARLY_SERVICE_YEARS },
  "airship-exp": { id: "airship", early: EARLY_EXPERIMENT_YEARS }, "airship-rigid": { id: "airship", early: EARLY_EXPERIMENT_YEARS },
  "car-exp": { id: "car", early: EARLY_EXPERIMENT_YEARS }, "car-spread": { id: "car", early: EARLY_SERVICE_YEARS },
  "plane-exp": { id: "plane", early: EARLY_EXPERIMENT_YEARS }, "plane-svc": { id: "plane", early: EARLY_SERVICE_YEARS }, "ship-steam": { id: "ship", early: EARLY_SERVICE_YEARS }, "ship-steel": { id: "ship", early: EARLY_SERVICE_YEARS }, "hwy-svc": { id: "expressway", early: EARLY_SERVICE_YEARS },
};
type SimYears = { startYear: number; kaigen?: { eras: readonly { start: number; stance: string }[] }; events?: SimState["events"] };
/** Has this row's milestone been reached by `year` in this game? */
export function reached(sim: SimYears, m: Milestone, year: number): boolean { const g = MOVABLE[m.id]; return g ? gateOpen(sim, g.id, m.year, g.early, year) : year >= m.year; }

/** The state of a technology row in `year`: not yet, or its phase. (Rows of one technology: the latest one reached wins.) */
export function techNow(tech: string, year: number, sim?: SimYears): { phase: Phase | "none"; since?: number; label: string } {
  let cur: Milestone | null = null; for (const m of TECH_MILESTONES) if (m.tech === tech && (sim ? reached(sim, m, year) : m.year <= year)) cur = m;
  const real = cur && sim?.events?.find((e) => e.kind === "tech" && e.refs?.milestone === cur!.id);   /* the year it really came in this game (the row's own year moves with the era stance) */
  return cur ? { phase: cur.phase, since: real ? sim!.startYear + Math.floor(real.month / 12) : cur.year, label: PHASE_LABEL[cur.phase] } : { phase: "none", label: "まだない" };
}
export const TECHS_1800 = ["鉄道", "飛行船", "自動車", "飛行機", "高速道路", "船舶"] as const;

/** Records the rows of `year` in the timeline (once each; an 1800 game only). */
export function fireHistory1800(sim: SimState, y: number): number {
  if (!sim.rules1800) return 0; let n = 0; const have = new Set(sim.events.filter((e) => e.kind === "tech").map((e) => e.refs?.milestone));
  for (const m of ALL_MILESTONES) if (!have.has(m.id) && reached(sim, m, y) && (MOVABLE[m.id] || m.year === y)) { ev(sim, "tech", `${y}年: ${m.text}${m.tech === "世界線" || m.tech === "地図" ? "" : `【${PHASE_LABEL[m.phase]}】`}`, m.cause, { milestone: m.id }); n++; }
  return n;
}

/** Stage 37: puts back any technology / fictional-history entry that is due but missing from the event list (a game that lost them to an old event cap, or one started before they existed). Idempotent: an entry is identified by its milestone id. Returns how many were added. */
export function backfillHistory1800(sim: SimState, nowYear: number): number {
  if (!sim.rules1800) return 0;
  const have = new Set(sim.events.filter((e) => e.kind === "tech").map((e) => e.refs?.milestone)); let n = 0;
  for (const m of ALL_MILESTONES) {
    if (!reached(sim, m, nowYear) || have.has(m.id)) continue;
    sim.events.push({ id: ++sim.next.event, month: Math.max(0, (Math.min(m.year, nowYear) - sim.startYear) * 12), kind: "tech", text: `${m.year}年: ${m.text}${m.tech === "世界線" || m.tech === "地図" ? "" : `【${PHASE_LABEL[m.phase]}】`}`, cause: m.cause, refs: { milestone: m.id } }); n++;
  }
  if (n) sim.events.sort((a, b) => a.month - b.month || a.id - b.id);
  return n;
}
