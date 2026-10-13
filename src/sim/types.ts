import type { Vec } from "../core/types";

/** Administrative grade, kept apart from the physical road. Display names: national=酷道, ken=険道, fu=腐道. */
export type Grade = "national" | "ken" | "fu";
export const GRADE_LABEL: Record<Grade, string> = { national: "酷道", ken: "険道", fu: "腐道" };
export const GRADE_SHORT: Record<Grade, string> = { national: "酷", ken: "険", fu: "腐" };
export type Surface = "unpaved" | "gravel" | "paved";
export const SURFACE_LABEL: Record<Surface, string> = { unpaved: "未舗装", gravel: "砂利", paved: "舗装" };
export const FU_PREFS = new Set(["JP-13", "JP-26", "JP-27"]); // 東京府・京都府・大阪府

export type NodeKind = "city" | "junction" | "pass" | "end";
/** Intersection/city/pass/end point. Position is the city site or a 5 km grid-cell centre: nothing finer is claimed. */
export interface SimNode { id: string; kind: NodeKind; cell: number; pos: Vec; cityId?: string; name?: string }

/** A physical road section between two nodes. Carries only physical state: no route number, no grade. */
export interface SimEdge {
  id: string; a: string; b: string; cells: number[]; lengthKm: number;
  surface: Surface; quality: number; weathering: number; built: number; // built 0..1
  open: boolean;      // passable and in service
  lost: boolean;      // 廃道: physically gone
  maxGradePct: number; traffic: number; lowYears: number; builtMonth: number | null;
}
export interface RouteEdgeRef { edgeId: string; dir: 1 | -1 }
/** A numbered route: designation over edges. The stable `id` never changes; grade/number may (promotion/demotion). */
export interface SimRoute {
  id: string; scope: string; grade: Grade; number: number; name: string; edges: RouteEdgeRef[];
  since: number; active: boolean; lowYears: number; highYears: number;
  history: { month: number; grade: Grade; number: number; text: string }[];
}
export type ProjectStatus = "planned" | "building" | "suspended" | "unbuilt" | "open" | "abolished";
export const PROJECT_LABEL: Record<ProjectStatus, string> = { planned: "計画", building: "工事中", suspended: "中断", unbuilt: "未成線", open: "供用", abolished: "廃止" };
/** Construction plan: lifecycle of building (or upgrading) edges. Independent of the edge's physical state. */
export interface SimProject {
  id: string; kind: "new" | "upgrade"; from: string; to: string; edgeIds: string[]; chain: RouteEdgeRef[];
  costBu: number; spentBu: number; status: ProjectStatus; startMonth: number; stallMonths: number; statusSince: number;
  routeId: string | null; reason: string; priority: number;
}
export interface SimEvent { id: number; month: number; kind: string; text: string; cause: string; refs: Record<string, string> }
export interface CityState { pop: number; industry: number; popSource: "ne" | "synthetic"; lowAccessYears: number }
export interface StatSample { year: number; routes: number; km: number; building: number; unbuilt: number; open: number; lost: number; budget: number }

export interface SimState {
  schemaVersion: 1; mapHash: string; terrainHash: string; seed: number; era: string; startYear: number;
  month: number; rngState: number; speed: 0 | 1 | 5 | 20;
  next: { node: number; edge: number; route: number; project: number; event: number };
  nodes: Record<string, SimNode>; edges: Record<string, SimEdge>; routes: Record<string, SimRoute>; projects: Record<string, SimProject>;
  cities: Record<string, CityState>;
  macro: { mood: number; budgetBu: number; maintCoverage: number };
  routeCounters: Record<string, number>;   // `${grade}:${scope}` -> last number issued (numbers are never reused)
  events: SimEvent[]; stats: StatSample[]; skippedMonths: number; lastWallMs: number;
  ceremonyDone: boolean;
}
export const ERA = { key: "kobun", name: "光文", firstYear: 1945, note: "1926年の昭和代替元号候補『光文』を、1945年の敗戦時に改元が起きた架空史へ転用" };
export const eraYear = (calYear: number) => calYear - ERA.firstYear + 1;
export const monthToYM = (start: number, month: number) => ({ year: start + Math.floor(month / 12), month: (month % 12) + 1 });
export const eraLabel = (calYear: number) => { const e = eraYear(calYear); return `${ERA.name}${e === 1 ? "元" : e}年`; };
export const ymLabel = (start: number, month: number) => { const { year, month: m } = monthToYM(start, month); return `${eraLabel(year)}(${year})${m}月`; };
export type { Vec };
