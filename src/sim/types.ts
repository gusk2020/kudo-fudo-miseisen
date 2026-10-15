import type { Vec } from "../core/types";
import { eraNameOf, type Dials, type EraKey, type Mod } from "./eras";
import type { PolicyState } from "./policy";

/**
 * Administrative designation (行政指定), kept apart from the physical road.
 * Official names: national=国道, ken=県道, fu=府道. The nicknames 酷道/険道/腐道 are NOT designations: they are earned
 * later by roads that are low-standard and rough (see Edge.nick / Route.nick). A road with no active route is a municipal road.
 */
export type Grade = "national" | "ken" | "fu" | "jnr" | "priv";
/** Stage 3: roads and railways are one network family. Edges/routes/projects without a `mode` are roads (every older save). */
export type Mode = "road" | "rail";
export const GRADE_MODE: Record<Grade, Mode> = { national: "road", ken: "road", fu: "road", jnr: "rail", priv: "rail" };
export const GRADE_LABEL: Record<Grade, string> = { national: "国道", ken: "県道", fu: "府道", jnr: "国鉄", priv: "私鉄" };
export const GRADE_SHORT: Record<Grade, string> = { national: "国", ken: "県", fu: "府", jnr: "鉄", priv: "私" };
/** Decay nicknames: 酷道/険道/腐道 for roads, 酷鉄 (国鉄) and 死鉄 (私鉄) for railways. Earned by condition, never assigned. */
export const NICK_LABEL: Record<Grade, string> = { national: "酷道", ken: "険道", fu: "腐道", jnr: "酷鉄", priv: "死鉄" };
export const NICK_SHORT: Record<Grade, string> = { national: "酷", ken: "険", fu: "腐", jnr: "酷", priv: "死" };
export const STANDARD_LABEL_RAIL: Record<Standard, string> = { rural: "単線・非電化", standard: "電化・複線級", highgrade: "高速新線級" };
export interface Operator { id: string; name: string; kind: "jnr" | "private" | "tertiary"; since: number; until?: number; note: string }
/** Road standard (規格): a physical design class, independent of designation and of current condition. */
export type Standard = "rural" | "standard" | "highgrade";
export const STANDARD_LABEL: Record<Standard, string> = { rural: "細道(1車線級)", standard: "一般(2車線)", highgrade: "高規格" };
/** Service state: open 供用 / dormant 休止(需要ゼロ) / closed 閉鎖 / lost 廃道. */
export type EdgeState = "open" | "dormant" | "closed" | "lost";
export const STATE_LABEL: Record<EdgeState, string> = { open: "供用", dormant: "休止", closed: "閉鎖", lost: "廃道" };
export type Surface = "unpaved" | "gravel" | "paved";
export const SURFACE_LABEL: Record<Surface, string> = { unpaved: "未舗装", gravel: "砂利", paved: "舗装" };
export const FU_PREFS = new Set(["JP-13", "JP-26", "JP-27"]); // 東京府・京都府・大阪府

export type NodeKind = "city" | "junction" | "pass" | "end" | "village";
/** Intersection/city/pass/end point. Position is the city site or a 5 km grid-cell centre: nothing finer is claimed. */
export interface SimNode { id: string; kind: NodeKind; cell: number; pos: Vec; cityId?: string; name?: string }

/** A physical road section between two nodes. Carries only physical state: no route number, no grade. */
export interface SimEdge {
  id: string; a: string; b: string; cells: number[]; lengthKm: number;
  surface: Surface; quality: number; weathering: number; built: number; // built 0..1
  open: boolean;      // in service (state === "open"); kept for older code paths and saves
  lost: boolean;      // 廃道 (state === "lost")
  maxGradePct: number; traffic: number; lowYears: number; builtMonth: number | null;
  // ---- v2 (all optional on read; filled with defaults by sanitizeSim) ----
  standard: Standard; state: EdgeState; through: number; local: number; peakThrough: number; zeroYears: number; reviveYears: number; congYears: number;
  nick: boolean; region: string; hist: { m: number; t: string }[]; bypassOf: string[]; bypassedBy: string[]; throughDropYears: number;
  // ---- v3 (Stage 3). Absent on older saves: sanitizeSim fills mode "road", freight 0 ----
  mode?: Mode; op?: string; freight: number; deficitYears?: number;
  curv?: number;   // curvature: total heading change per km of ground (radians/km), from the grid path; absent = straight
  facility?: "tunnel" | "bridge"; facilityName?: string; convertedTo?: string;   // long tunnels/bridges are edges of their own; a closed railway can be converted into a road
}
export const modeOf = (x: { mode?: Mode }): Mode => x.mode ?? "road";
export interface RouteEdgeRef { edgeId: string; dir: 1 | -1 }
/** A numbered route: designation over edges. The stable `id` never changes; grade/number may (promotion/demotion). */
export interface SimRoute {
  id: string; scope: string; grade: Grade; number: number; name: string; edges: RouteEdgeRef[];
  since: number; active: boolean; lowYears: number; highYears: number;
  history: { month: number; grade: Grade; number: number; text: string; scope?: string; opName?: string }[];
  endMonth?: number;        // month the designation ended (abolished); the line stays in the ledger
  mode?: Mode; op?: string; opName?: string;   // rail: operator id and the name printed on the line (国鉄 / a private operator) (key of SimState.operators)
  nick: boolean;          // 通称(酷道/険道/腐道)が付くほど荒れた区間が多い
  oldEdges: string[];     // 旧道区間: バイパス開通後も当面この路線の管理下に残る区間
}
export type ProjectKind = "new" | "upgrade" | "access" | "improve" | "bypass" | "restore" | "electrify" | "convert";
export const KIND_LABEL: Record<ProjectKind, string> = { new: "新規", upgrade: "舗装化", access: "集落アクセス", improve: "改良", bypass: "バイパス", restore: "復旧", electrify: "電化・複線化", convert: "廃線転用" };
export type ProjectStatus = "concept" | "planned" | "building" | "suspended" | "unbuilt" | "open" | "abolished";
export const PROJECT_LABEL: Record<ProjectStatus, string> = { concept: "構想", planned: "計画", building: "工事中", suspended: "中断", unbuilt: "未成線", open: "供用", abolished: "廃止" };
/** Construction plan: lifecycle of building (or upgrading) edges. Independent of the edge's physical state. */
export interface SimProject {
  id: string; kind: ProjectKind; region: string; replaces: string[]; from: string; to: string; edgeIds: string[]; chain: RouteEdgeRef[];
  costBu: number; spentBu: number; status: ProjectStatus; startMonth: number; stallMonths: number; statusSince: number;
  routeId: string | null; reason: string; priority: number; mode?: Mode; op?: string;
}
export interface SimEvent { id: number; month: number; kind: string; text: string; cause: string; refs: Record<string, string> }
export interface CityState { pop: number; industry: number; popSource: "ne" | "synthetic"; lowAccessYears: number; airport?: number /* year the airport opened (Stage 3) */ }
/** 集落: 合成の小さな居住地(実在の集落ではない)。旧道の「地域内需要」と孤立判定の根拠。 */
export interface Settlement { id: string; name: string; cell: number; city: string; pop: number; pop0: number; isolatedYears: number; gone: boolean }
export interface SimLink { id: string; kind: "bypass"; newEdges: string[]; oldEdges: string[]; month: number; routeId: string | null }
/** Edge codes (state*16 + quality bucket). `delta`: only edges that changed since the previous snapshot (Stage 3; fold with codesAt). */
export interface Snapshot { year: number; edges: Record<string, number>; delta?: true }
export interface StatSample { year: number; routes: number; km: number; building: number; unbuilt: number; open: number; lost: number; budget: number; pop?: number; villagePop?: number; dormant?: number; closed?: number; bypass?: number; regionsBuilding?: number; prefsWithRoad?: number; railKm?: number; roadKm?: number; airShare?: number; seaShare?: number }

export interface SimState {
  schemaVersion: 1 | 2 | 3; mapHash: string; terrainHash: string; seed: number; era: string; startYear: number;
  month: number; rngState: number; speed: 0 | 1 | 5 | 20;
  next: { node: number; edge: number; route: number; project: number; event: number };
  nodes: Record<string, SimNode>; edges: Record<string, SimEdge>; routes: Record<string, SimRoute>; projects: Record<string, SimProject>;
  cities: Record<string, CityState>;
  settlements: Record<string, Settlement>; links: SimLink[]; snaps: Snapshot[]; regionShare: Record<string, number>;
  macro: { mood: number; budgetBu: number; maintCoverage: number };
  routeCounters: Record<string, number>;   // `${grade}:${scope}` -> last number issued (numbers are never reused)
  events: SimEvent[]; stats: StatSample[]; skippedMonths: number; lastWallMs: number;
  ceremonyDone: boolean;
  // ---- v3 (Stage 3) ----
  operators: Record<string, Operator>;
  dials: Dials;               // composed from the era baseline and active mods once a year (see eras.ts)
  mods: Mod[];                // active and expired event/policy effects (kept for the timeline)
  policy?: PolicyState;       // ten-yearly interventions (Stage 3 only)
  stage3?: boolean;           // true for games started on the real map; false/absent = the Stage 2 flow
}
export const SIM_VERSION = 3;
export const ERA = { key: "kobun", name: "光文", firstYear: 1945, note: "1926年の昭和代替元号候補『光文』を、1945年の敗戦時に改元が起きた架空史へ転用" };
export const eraYear = (calYear: number) => calYear - ERA.firstYear + 1;
export const monthToYM = (start: number, month: number) => ({ year: start + Math.floor(month / 12), month: (month % 12) + 1 });
/** The era of the game being shown. One game is on screen at a time, so labels read it instead of every caller passing it down. */
let activeEra: EraKey = "kobun";
export const setActiveEra = (e: EraKey) => { activeEra = e; };
export const getActiveEra = () => activeEra;
export const eraLabel = (calYear: number, era: EraKey = activeEra) => eraNameOf(era, calYear);
export const ymLabel = (start: number, month: number, era: EraKey = activeEra) => { const { year, month: m } = monthToYM(start, month); return `${eraLabel(year, era)}(${year})${m}月`; };
export type { Vec };
