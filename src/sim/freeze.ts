/**
 * Stage 7: works frozen by a change of course (工事凍結) and resumed when the course comes back (工事再開).
 *
 * Unfinished lines -- 未成線 -- are rarely abandoned for want of money alone: they are frozen when the will to build goes, the way the national railway's
 * lines under construction were frozen when it was reformed, or road works were cut in a drive for sound finances. Once a year:
 *   freeze   when the era's appetite for a mode falls under FREEZE_AT or drops by FREEZE_DROP in a year (or the public railway is broken up, or roads face an austerity drive),
 *            the least urgent unfinished NEW lines and bypasses of that mode (less than FREEZE_PROGRESS built) are suspended, at most MAX_FREEZE a year.
 *   resume   a suspended project whose mode is wanted again (appetite RESUME_AT or more) goes back to planned, with the reason.
 * A suspended project that is not resumed becomes 未成 after eight years (the existing rule). Only new-economy games; no place names.
 */
import { ev, projLabel, yearOf } from "./engine";
import { isCrossingProject } from "./crossing";
import { composeDials } from "./eras";
import { modeOf, type Mode, type SimState } from "./types";

/** FREEZE_DROP: a fall of this share of the appetite in one year (a new policy, an era change taking hold) is also a change of course. */
export const FREEZE_DROP = 0.12;
export const FREEZE_AT: Record<Mode, number> = { rail: 0.3, road: 0.35 }, RESUME_AT = 0.55, FREEZE_PROGRESS = 0.7, MAX_FREEZE = 4, AUSTERITY_FREEZE = 0.92;
export function reviewWorks(sim: SimState): { frozen: number; resumed: number } {
  if (!sim.stage3) return { frozen: 0, resumed: 0 };
  const dl = sim.dials, y = yearOf(sim), prev = composeDials(sim, y - 1), app = (m: Mode, d = dl) => (m === "rail" ? d.railBuild : d.hwyBuild); let frozen = 0, resumed = 0;
  // a freeze is a CHANGE of course: it happens in the year the appetite falls through the line, not every year it stays low
  for (const p of Object.values(sim.projects)) {
    if (p.status !== "suspended" || !p.reason.includes(FROZEN_TAG) || app(modeOf(p)) < RESUME_AT) continue;
    p.status = "planned"; p.statusSince = sim.month; p.stallMonths = 0; resumed++;
    ev(sim, "project", `工事再開: ${projLabel(sim, p)}`, `${modeOf(p) === "rail" ? "鉄道" : "道路"}建設の意欲が戻った(${app(modeOf(p)).toFixed(2)})`, { project: p.id });
  }
  const reform = !!sim.operators.jnr && sim.operators.jnr.until === y;
  for (const m of ["rail", "road"] as Mode[]) {
    const drop = app(m, prev) > 0 ? (app(m, prev) - app(m)) / app(m, prev) : 0, fell = (app(m) < FREEZE_AT[m] && app(m, prev) >= FREEZE_AT[m]) || drop >= FREEZE_DROP, tight = m === "road" && dl.austerity < AUSTERITY_FREEZE && prev.austerity >= AUSTERITY_FREEZE;
    const why = m === "rail" ? (reform ? "国鉄の分割・民営化で建設中の新線を凍結" : fell ? `鉄道建設の意欲が低下(${app(m, prev).toFixed(2)}→${app(m).toFixed(2)})し工事を凍結` : null)
      : fell ? `道路建設の意欲が低下(${app(m, prev).toFixed(2)}→${app(m).toFixed(2)})し工事を凍結` : tight ? `財政の引き締め(${dl.austerity.toFixed(2)})で工事を凍結` : null;
    if (!why) continue;
    const cands = Object.values(sim.projects).filter((p) => modeOf(p) === m && (p.status === "building" || p.status === "planned") && (p.kind === "new" || p.kind === "bypass") && !isCrossingProject(p) && p.spentBu < FREEZE_PROGRESS * p.costBu && !p.edgeIds.some((id) => sim.edges[id]?.standard === "highgrade"))   // trunk high-speed works are not frozen this way
      .sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1));
    for (const p of cands.slice(0, MAX_FREEZE)) {
      p.status = "suspended"; p.statusSince = sim.month; if (!p.reason.includes(FROZEN_TAG)) p.reason = `${p.reason}${FROZEN_TAG}`; frozen++;
      ev(sim, "project", `工事凍結: ${projLabel(sim, p)}`, `${why}。進捗${Math.round((p.spentBu / Math.max(1e-9, p.costBu)) * 100)}%で中断(再開されなければ8年後に未成線)`, { project: p.id });
    }
  }
  return { frozen, resumed };
}
export const FROZEN_TAG = "【凍結】";
