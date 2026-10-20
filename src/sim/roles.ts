/**
 * Stage 10 (Issue #26): the seats of government SWAP regional roles with the real cities that held them -- they are not a bonus on top.
 *
 *   capital    = the role real Tokyo has (national centre: the biggest population, commerce, industry, transport)
 *   sub-capital = the role real Osaka has
 *   palace     = the role real Kyoto has (history, culture and tourism)
 *
 * What a "role" is, in this model: a prefecture's ROLE MASS -- the 1950 population of all its cities together (the thing population, industry, ports, airports,
 * passenger and goods pull and the regional budget all grow from). Choosing Sapporo as capital gives the Sapporo prefecture Tokyo's mass and the Tokyo prefecture
 * Sapporo's mass; inside each prefecture the cities keep their own geographic weights (each city is scaled by the same factor), so the coast, the plains, the
 * ports and the distances stay the real ones. Masses are only permuted, so the national total never changes.
 *
 * The surroundings: the prefectures closest to the real Tokyo by ACCESS (distance over land; a sea crossing counts SEA_ACCESS times) are its 首都圏 (Kanto-like
 * cluster). Their masses move to the prefectures closest to the chosen capital by the same measure, rank by rank (the nearest
 * to the real Tokyo -> the nearest to the new capital). Likewise the real Osaka's
 * surroundings (the 近畿-like cluster) move to the chosen sub-capital's. At most METRO_SIZE prefectures each, and a prefecture belongs to at most one cluster:
 * this is the cap on spillover. Names never enter: the clusters are found by distance from the real role holders' seats.
 *
 * The replacement rule (stable, no cycles, no double assignment): start from the identity; give the capital Tokyo's mass, then the sub-capital Osaka's mass, then
 * each cluster rank its mass -- each step a single exchange of two prefectures' masses ("whoever held the mass I take gets mine"), and a prefecture fixed by an
 * earlier step is never touched again. The capital and the sub-capital are always different prefectures (seatsValid); the palace changes no mass at all.
 *
 * The palace: real Kyoto's cultural role is a tourism site at its seat. When the palace is placed elsewhere than its default (the real palace, Tokyo), that site moves
 * to the palace's prefecture and Kyoto keeps only the ordinary attraction the palace prefecture had (none). Default palace -> Kyoto keeps it, as in reality.
 *
 * Only games created from Stage 10 on carry `sim.roles`; older saves keep the bonus they were created with (CAPITAL_BONUS) and are not recomputed.
 */
import { DEFAULT_CAPITAL, DEFAULT_PALACE, DEFAULT_SUB } from "../core/seat";
import { startPop } from "./census50";
import type { RoleState, SimState } from "./types";
import type { WCity, World } from "./world";

export const ROLE_TOKYO = DEFAULT_CAPITAL, ROLE_OSAKA = DEFAULT_SUB, ROLE_KYOTO = "JP-26";
export const METRO_SIZE = 5, SEA_ACCESS = 1.6;

const seatOf = (w: World, pref: string): WCity | undefined => w.cities.find((c) => c.pref === pref && c.kind === "capital");
/** The 1950 population of a prefecture's cities (its role mass). */
export function prefMass(w: World, pref: string, p15?: boolean): number { let m = 0; for (const c of w.cities) if (c.pref === pref) m += startPop(w, c, p15); return m; }
/** Travel effort between two prefecture seats: km, with a sea crossing (different land masses) weighted SEA_ACCESS. */
export function accessKm(w: World, a: string, b: string): number {
  const x = seatOf(w, a), y = seatOf(w, b); if (!x || !y) return Infinity;
  const km = Math.hypot(x.pos[0] - y.pos[0], x.pos[1] - y.pos[1]); return w.lm[x.cell] === w.lm[y.cell] ? km : km * SEA_ACCESS;
}
const prefsOf = (w: World) => w.t.prefOrder.filter((p) => !!seatOf(w, p) && prefMass(w, p) > 0);   // (the mass is only tested for being positive: same under either rule)
/** The METRO_SIZE prefectures nearest `centre` by access, skipping `skip`. Ties by id (stable). */
export function nearestPrefs(w: World, centre: string, skip: Set<string>, n = METRO_SIZE): string[] {
  return prefsOf(w).filter((p) => p !== centre && !skip.has(p)).map((p) => ({ p, d: accessKm(w, centre, p) })).filter((x) => isFinite(x.d)).sort((a, b) => a.d - b.d || (a.p < b.p ? -1 : 1)).slice(0, n).map((x) => x.p);
}
/** The role assignment for a game: who carries whose mass, the two clusters, and where the cultural role sits. */
export function computeRoles(w: World, capital: string, sub: string, palace: string, p15?: boolean): RoleState {
  const prof = new Map<string, string>(), holder = new Map<string, string>(), fixed = new Set<string>();
  for (const p of prefsOf(w)) { prof.set(p, p); holder.set(p, p); }
  const give = (target: string, mass: string) => {   // `target` takes `mass`; whoever held it takes target's
    if (!prof.has(target) || !holder.has(mass)) return; const x = holder.get(mass)!, mine = prof.get(target)!; if (x === target) { fixed.add(target); return; }
    prof.set(target, mass); holder.set(mass, target); prof.set(x, mine); holder.set(mine, x); fixed.add(target);
  };
  give(capital, ROLE_TOKYO); if (sub !== capital) give(sub, ROLE_OSAKA);
  // the clusters around the REAL holders (by access from them, never by name) and around the chosen seats, matched rank by rank (nearest to nearest), so the
  // default seats change nothing
  const origCap = nearestPrefs(w, ROLE_TOKYO, new Set([ROLE_TOKYO, ROLE_OSAKA])), origSub = nearestPrefs(w, ROLE_OSAKA, new Set([ROLE_TOKYO, ROLE_OSAKA, ...origCap]));
  const capMetro = nearestPrefs(w, capital, new Set([...fixed])); capMetro.forEach((t, i) => { if (origCap[i]) give(t, origCap[i]); });
  const subMetro = sub !== capital ? nearestPrefs(w, sub, new Set([...fixed])) : []; subMetro.forEach((t, i) => { if (origSub[i]) give(t, origSub[i]); });
  const out: Record<string, string> = {}; for (const [p, m] of prof) if (p !== m) out[p] = m;
  return { prof: out, capMetro, subMetro, culture: palace !== DEFAULT_PALACE ? palace : ROLE_KYOTO, ...(p15 ? { p15: true as const } : {}) };
}
const scaleMemo = new WeakMap<RoleState, { w: World; s: Map<string, number> }>();
/** The factor applied to every city of a prefecture: (mass it carries) / (its own mass). 1 without roles. */
export function roleScale(sim: Pick<SimState, "roles">, w: World, pref: string | null): number {
  const r = sim.roles; if (!r || !pref) return 1;
  let e = scaleMemo.get(r); if (!e || e.w !== w) { const s = new Map<string, number>(); for (const [p, m] of Object.entries(r.prof)) { const own = prefMass(w, p, r.p15); s.set(p, own > 0 ? prefMass(w, m, r.p15) / own : 1); } e = { w, s }; scaleMemo.set(r, e); }
  return e.s.get(pref) ?? 1;
}
/** A city's 1950 population under this game's roles (the real one when roles are not used). Everything that read `pop0` reads this. */
export const basePop = (sim: Pick<SimState, "roles">, w: World, c: WCity): number => (sim.roles ? Math.round(startPop(w, c, sim.roles.p15) * roleScale(sim, w, c.pref)) : c.pop0);
/** Which role a prefecture plays (for the UI and the docs). */
export function roleLabel(sim: Pick<SimState, "roles">, pref: string): string | null {
  const r = sim.roles; if (!r) return null; const m = r.prof[pref];
  if (m === ROLE_TOKYO) return "旧東京の役割(首都)"; if (m === ROLE_OSAKA) return "旧大阪の役割(副首都)";
  if (r.capMetro.includes(pref)) return "首都圏(旧関東の役割)"; if (r.subMetro.includes(pref)) return "副首都圏(旧近畿の役割)";
  return m ? "役割を交換(縮小または拡大)" : null;
}
/** The prefecture a stray item without one is booked to: the capital's (never a fixed name). */
export const capitalPref = (sim: Pick<SimState, "capital">): string => sim.capital ?? DEFAULT_CAPITAL;
/**
 * Industrial standing travels with the role too, but only half of it: the geographic part of a city's industry (a coast, a plain: 0.35 / 0.2 in the engine's
 * target) is real geography and stays, while ROLE_INDUSTRY of the gap to the role holder's seat moves with the role (a capital without a harbour still gets
 * part of the old capital's industry, never all of it).
 */
export const ROLE_INDUSTRY = 0.5;
const geoIndustry = (c: WCity) => 0.35 * (c.coastal ? 1 : 0) + 0.2 * c.plains;
export function roleIndustry(sim: Pick<SimState, "roles">, w: World, c: WCity): number {
  const m = sim.roles?.prof[c.pref ?? ""]; if (!m) return 0; const own = seatOf(w, c.pref!), src = seatOf(w, m); if (!own || !src) return 0;
  return ROLE_INDUSTRY * (geoIndustry(src) - geoIndustry(own));
}
