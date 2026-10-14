/**
 * Reading the past without touching it: snapshots, and "what was this line called in year Y".
 * Everything here is a pure read of the sim; looking at 1975 never changes 2026.
 */
import { GRADE_LABEL, GRADE_MODE, type Grade, type SimEdge, type SimRoute, type SimState, type Snapshot } from "./types";
import { prefName } from "./engine";

/** Edge code in a snapshot: (built? state: 4 = under construction) * 16 + quality bucket. Lives here, not in the renderer, so the simulation never imports drawing code. */
export function snapCode(e: SimEdge): number { return (e.built < 1 ? 4 : { open: 0, dormant: 1, closed: 2, lost: 3 }[e.state]) * 16 + Math.min(15, Math.floor(e.quality / 6.5)); }
const MIN_SNAP_GAP = 5;
export const SNAP_EVERY_YEARS = MIN_SNAP_GAP;
/** Absolute edge codes in year `year` (the latest snapshot at or before it, with every earlier delta folded in). Null before the first snapshot. */
export function codesAt(snaps: Snapshot[], year: number): Record<string, number> | null {
  let out: Record<string, number> | null = null;
  for (const s of snaps) { if (s.year > year) break; const base: Record<string, number> = s.delta && out ? out : {}; out = { ...base, ...s.edges }; }
  return out;
}
export const snapYears = (snaps: Snapshot[]) => snaps.map((s) => s.year);
/** Delta against the previous absolute state: only edges that appeared or changed are stored, so a century of snapshots stays small. */
export function makeDeltaSnapshot(sim: SimState, year: number): Snapshot {
  const now: Record<string, number> = {}; for (const e of Object.values(sim.edges)) now[e.id] = snapCode(e);
  const prev = codesAt(sim.snaps, year - 1), delta: Record<string, number> = {};
  for (const [id, c] of Object.entries(now)) if (!prev || prev[id] !== c) delta[id] = c;
  return { year, edges: prev ? delta : now, ...(prev ? { delta: true as const } : {}) };
}

export interface RouteView { exists: boolean; grade: Grade; number: number; scope: string; label: string; opName?: string }
/** The line as it was at the end of calendar year `year`: number, grade and operator come from its own history. */
export function routeAtYear(sim: SimState, r: SimRoute, year: number): RouteView {
  const m = (year - sim.startYear) * 12 + 11;
  const exists = r.since <= m && !(r.endMonth !== undefined && r.endMonth <= m);
  let h = r.history[0]; for (const x of r.history) if (x.month <= m) h = x;
  const rail = GRADE_MODE[h.grade] === "rail", scope = h.scope ?? r.scope, opName = h.opName ?? r.opName;
  const label = rail ? `${opName ?? GRADE_LABEL[h.grade]}${h.number}号線` : `${scope === "JP" ? "" : prefName(scope) + " "}${GRADE_LABEL[h.grade]}${h.number}号`;
  return { exists, grade: h.grade, number: h.number, scope, label, opName };
}
/** Every number a line has carried, oldest first, for the ledger. */
export function numberHistory(sim: SimState, r: SimRoute): { year: number; label: string; text: string }[] {
  return r.history.map((x) => {
    const rail = GRADE_MODE[x.grade] === "rail", scope = x.scope ?? r.scope;
    return { year: sim.startYear + Math.floor(x.month / 12), text: x.text, label: rail ? `${x.opName ?? r.opName ?? GRADE_LABEL[x.grade]}${x.number}号線` : `${scope === "JP" ? "" : prefName(scope) + " "}${GRADE_LABEL[x.grade]}${x.number}号` };
  });
}
