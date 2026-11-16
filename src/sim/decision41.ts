/**
 * Stage 41: 判断直前のセーブ. When the player is NOT there to decide (常に自動 / 遷都のみ手動 / 放置中のみ自動 while away), the game decides an era change, a policy window or a relocation by itself and moves on. For each such decision the app is handed a COPY of the
 * game in exactly the state the manual path would have waited in -- the decision open, nothing applied yet -- to keep as a save point. Loading it brings the decision back to the player, who may choose again; while it is open the automatic mode is held back and, once nothing is
 * left to decide, the mode the game was saved in comes back by itself (`resumeMode`).
 * Nothing here runs unless the app has registered a sink: tests, tools and the plain stepping pay nothing. No random number is drawn and the game that goes on is not touched: the copy is made before the automatic choice and the real game then takes that choice as it always did.
 */
import type { SimState } from "./types";

export type DecisionKind = "kaigen" | "policy" | "reloc";
export interface DecisionPoint { kind: DecisionKind; year: number; /** a deep copy of the game with the decision open */ sim: SimState }
type Sink = (d: DecisionPoint) => void;
let sink: Sink | null = null;
export const setDecisionSink = (f: Sink | null): void => { sink = f; };
export const decisionSinkSet = (): boolean => sink !== null;
/** Called just before an automatic decision is taken. `open` turns the copy into the state the manual path waits in (when the game has not done that yet). */
export function noteDecision(kind: DecisionKind, year: number, sim: SimState, open?: (copy: SimState) => void): void {
  if (!sink) return;
  const copy = JSON.parse(JSON.stringify(sim)) as SimState; open?.(copy); sink({ kind, year, sim: copy });
}
const AUTO = new Set(["auto", "autoReloc", "idleAuto"]);
/** A game loaded from a decision save point: hold the automatic mode back so the decision is waited for, and remember it. */
export function prepareDecisionLoad(sim: SimState): boolean {
  const pol = sim.policy; if (!pol || !AUTO.has(pol.mode)) return false;
  sim.resumeMode = pol.mode as "auto" | "autoReloc" | "idleAuto"; pol.mode = "priority"; return true;
}
/** Nothing is waiting for the player any more: the mode the game was saved in comes back. */
export function resumeAfterDecision(sim: SimState): void { if (sim.resumeMode && sim.policy) { sim.policy.mode = sim.resumeMode; delete sim.resumeMode; } }
