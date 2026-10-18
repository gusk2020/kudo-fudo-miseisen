/**
 * Stage 7: the business side of a railway line (赤字ローカル線の廃止).
 *
 * Until now a railway only ever closed when nobody at all used it, or when its upkeep could not be paid and it slowly fell apart. Neither is how branch
 * lines actually disappear: a line that still carries some riders but far too few to pay for the trains is given up by the company that runs it, usually
 * replaced by a bus. This is that decision, once a year, line by line:
 *
 *   density   the line's mean traffic (riders per day, freight counted at 0.4 like everywhere else), over its length.
 *   deficit   a line whose density stays under DEFICIT_DENS runs at a loss; the count of loss years is kept on the line (`deficitYears`).
 *   who       a private or third-sector operator gives a loss-making line up after DEFICIT_YEARS_PRIV years; the national railway only after
 *             DEFICIT_YEARS_JNR and only below JNR_CLOSE_DENS, and not while the state still pays it a large subsidy (jnrSubsidy).
 *   shield    a rail-minded world (railBias) or strong subsidies halve the density under which a private line is given up -- the same dials the
 *             policy window moves (地方鉄道を守る運動, 地方交通の広域連携 ...), so policy can save lines but only within what the world line allows.
 *   limit     at most MAX_CLOSE_PER_YEAR lines a year, weakest first; a high-speed trunk is never given up this way.
 *
 * Only the sections that are themselves under the density are closed, so a busy section shared with another line keeps running. The line's history
 * says why, with the numbers. Pure rules over the sim; no place names.
 */
import { ev } from "./engine";
import { pushHist, setEdgeState } from "./network";
import { modeOf, type SimEdge, type SimRoute, type SimState } from "./types";
import type { World } from "./world";
import { upkeepMult } from "./land";

export const DEFICIT_DENS = 2500, JNR_CLOSE_DENS = 1500, DEFICIT_YEARS_PRIV = 6, DEFICIT_YEARS_JNR = 10, MAX_CLOSE_PER_YEAR = 3;
const dens = (e: SimEdge) => e.through + e.local + 0.4 * e.freight;
export function lineDensity(sim: SimState, r: SimRoute): { mean: number; es: SimEdge[] } {
  const es = r.edges.map((x) => sim.edges[x.edgeId]).filter((e): e is SimEdge => !!e && e.facility !== "ferry"), km = es.reduce((s, e) => s + e.lengthKm, 0) || 1;
  return { mean: es.reduce((s, e) => s + dens(e) * e.lengthKm, 0) / km, es };
}
/** One year's decisions. Returns the number of lines given up. */
export function reviewRailLines(sim: SimState, w: World, y: number): number {
  if (!sim.stage3) return 0;
  const dl = sim.dials, shield = dl.railBias >= 0.45 || dl.jnrSubsidy >= 0.6, cands: { r: SimRoute; mean: number; es: SimEdge[]; jnr: boolean }[] = [];
  for (const r of Object.values(sim.routes)) {
    if (!r.active || modeOf(r) !== "rail") continue;
    const { mean, es } = lineDensity(sim, r); if (!es.length || es.some((e) => e.standard === "highgrade")) { r.deficitYears = 0; continue; }
    // Stage 12: a line over hard ground costs more to keep, so it needs more riders to pay (land.ts upkeep, km-weighted); 1 on the plain and in older games
    const ups = w.land12 ? es.reduce((s, e) => s + upkeepMult(w, e) * e.lengthKm, 0) / Math.max(1, es.reduce((s, e) => s + e.lengthKm, 0)) : 1, need = DEFICIT_DENS * ups;
    r.deficitYears = mean < need ? (r.deficitYears ?? 0) + 1 : 0;
    const op = sim.operators[r.op ?? "jnr"], jnr = !op || op.kind === "jnr";
    const ok = jnr ? r.deficitYears >= DEFICIT_YEARS_JNR && mean < JNR_CLOSE_DENS * ups && dl.jnrSubsidy < 0.5 : r.deficitYears >= DEFICIT_YEARS_PRIV && mean < need * (shield ? 0.5 : 1);
    if (ok) cands.push({ r, mean, es, jnr });
  }
  cands.sort((a, b) => a.mean - b.mean || (a.r.id < b.r.id ? -1 : 1));
  let n = 0;
  for (const c of cands.slice(0, MAX_CLOSE_PER_YEAR)) {
    const cut = c.es.filter((e) => (e.state === "open" || e.state === "dormant") && dens(e) < DEFICIT_DENS * (w.land12 ? upkeepMult(w, e) : 1)); if (!cut.length) continue;
    const opName = sim.operators[c.r.op ?? "jnr"]?.name ?? "国鉄", why = `輸送密度${Math.round(c.mean)}人/日の赤字が${c.r.deficitYears}年続き、${opName}が廃止(バスに転換)`;
    for (const e of cut) { setEdgeState(sim, e, "closed", why); pushHist(sim, e, "赤字のため廃止"); }
    if (!c.es.some((e) => e.state === "open" || e.state === "dormant")) { c.r.active = false; c.r.endMonth = sim.month; c.r.history.push({ month: sim.month, grade: c.r.grade, number: c.r.number, text: "赤字のため廃止" }); }
    ev(sim, "abolish", `赤字ローカル線の廃止: ${c.r.name}(${Math.round(cut.reduce((s, e) => s + e.lengthKm, 0))}km)`, `${why}。自動車の選好${dl.carBias.toFixed(2)}・鉄道の選好${dl.railBias.toFixed(2)}${c.jnr ? `・国鉄への補助${dl.jnrSubsidy.toFixed(2)}` : ""}`, { route: c.r.id });
    n++;
  }
  void w; void y; return n;
}
