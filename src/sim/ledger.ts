/**
 * The ledger's own reading of a line's history (Stage 26: the year-by-year snapshots and the look-at-a-past-year view are gone; a line's numbers and names live in its own history).
 */
import { GRADE_LABEL, GRADE_MODE, type SimRoute, type SimState } from "./types";
import { prefName } from "./engine";

/** Every number a line has carried, oldest first, for the ledger. */
export function numberHistory(sim: SimState, r: SimRoute): { year: number; label: string; text: string }[] {
  return r.history.map((x) => {
    const rail = GRADE_MODE[x.grade] === "rail", scope = x.scope ?? r.scope;
    return { year: sim.startYear + Math.floor(x.month / 12), text: x.text, label: rail ? `${x.opName ?? r.opName ?? GRADE_LABEL[x.grade]}${x.number}号線` : `${scope === "JP" ? "" : prefName(scope) + " "}${GRADE_LABEL[x.grade]}${x.number}号` };
  });
}
