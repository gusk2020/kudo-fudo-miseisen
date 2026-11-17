/**
 * Stage 41 #4: the SIMPLE intervention mode. Three questions instead of fifteen policies: which transport to stress (道路/鉄道/海路/空路), concentrate or disperse the cities (集中/分散), and which coast to favour (日本海側/太平洋側).
 * Every answer is mapped onto something the detailed mode already has -- nothing new is invented for the simulation:
 *   道路 -> 政策 p-road,  鉄道 -> p-rail,  海路/空路 -> the seaBias / airBias dials (the same dials the 海路型/空路型 stances move; there is no detailed policy item for them),
 *   集中 -> o-select (選択と集中),  分散 -> p-region (地方交通の広域連携),
 *   日本海側/太平洋側 -> no dial: the coast is a property of the reconstruction policy, which only an era change sets. So it steers the NEXT era change (the candidate whose recon matches is preferred) and nothing else.
 * One manual window adopts at most one thing per axis, spends no points, at the strength the world's own score gives it (floored at the adoption bar), and a policy that the detailed mode would block stays blocked. 「今後の自動でも続ける」 keeps the answers: the automatic
 * policy windows then use them instead of the best-scoring domain, and automatic era changes use the coast. Without it (or with no answer) the game decides exactly as before -- bit for bit.
 */
import { ADOPT_BAR, DOMAIN_LABEL, computeEnv, policyById, type PolicyRecord } from "./policy";
import type { Dials } from "./eras";
import { ev } from "./engine";
import type { EraCand } from "./kaigen";
import type { SimState } from "./types";

export type Transport = "road" | "rail" | "sea" | "air";
export type Concentration = "concentrate" | "disperse";
export type Coast = "japansea" | "pacific";
export interface Simple41 { transport?: Transport; city?: Concentration; coast?: Coast; /** keep applying these in the automatic modes */ keep: boolean }
export const TRANSPORT_LABEL: Record<Transport, string> = { road: "道路", rail: "鉄道", sea: "海路", air: "空路" };
export const CITY_LABEL: Record<Concentration, string> = { concentrate: "集中", disperse: "分散" };
export const COAST_LABEL2: Record<Coast, string> = { japansea: "日本海側", pacific: "太平洋側" };
export const SEA_AIR: Record<"sea" | "air", { id: string; label: string; d: Partial<Dials> }> = {
  sea: { id: "s-sea", label: "海路の重視(港・フェリー)", d: { seaBias: 0.15 } },
  air: { id: "s-air", label: "空路の重視(空港・航空)", d: { airBias: 0.15 } },
};
/** The policy id (or the sea/air item) behind each answer. */
export const ITEM_OF = { road: "p-road", rail: "p-rail", concentrate: "o-select", disperse: "p-region" } as const;
export interface SimpleItem { id: string; label: string; d: Partial<Dials>; base: number; block: string | null }

export function simpleItems(sim: SimState, a0: Pick<Simple41, "transport" | "city">): SimpleItem[] {
  const a = { transport: a0.transport && a0.transport in TRANSPORT_LABEL ? a0.transport : undefined, city: a0.city && a0.city in CITY_LABEL ? a0.city : undefined };   // (a hand-edited save cannot make this throw)
  const env = computeEnv(sim), out: SimpleItem[] = [];
  const add = (id: string) => { const p = policyById(id); out.push({ id, label: p.label, d: p.d, base: p.base(env), block: p.block?.(env, sim.era) ?? null }); };
  if (a.transport === "road") add(ITEM_OF.road); else if (a.transport === "rail") add(ITEM_OF.rail); else if (a.transport) { const s = SEA_AIR[a.transport]; out.push({ id: s.id, label: s.label, d: s.d, base: ADOPT_BAR, block: null }); }
  if (a.city) add(ITEM_OF[a.city]);
  return out;
}
/** Apply the answers as the player's decision of the open window. Returns the record, or null when no window is open. */
export function resolveSimple(sim: SimState, a: Simple41, auto = false): PolicyRecord | null {
  const pol = sim.policy; if (!pol?.pending) return null; const y = pol.pending.year, items = simpleItems(sim, a);
  const rec: PolicyRecord = { year: y, domain: "politics", adopted: [], declined: [], spent: {}, pointsAfter: pol.points, auto };
  for (const it of items) {
    if (it.block) { rec.declined.push({ id: it.id, label: it.label, priority: it.base, reason: it.block }); ev(sim, "policy", `【政策見送り】かんたん: ${it.label}`, it.block, {}); continue; }
    const strength = Math.min(1, Math.max(ADOPT_BAR, it.base)), d: Partial<Dials> = {}; for (const k of Object.keys(it.d) as (keyof Dials)[]) { const v = it.d[k]; if (v) d[k] = Math.round(v * strength * 1000) / 1000; }
    sim.mods.push({ id: `${it.id}-${y}`, kind: "policy", label: it.label, from: y, until: y + 10, d });
    const reason = `かんたん介入で選択(環境${it.base.toFixed(2)}、強さ${strength.toFixed(2)})`;
    rec.adopted.push({ id: it.id, label: it.label, priority: strength, effect: Object.entries(d).map(([k, v]) => `${k}${(v as number) > 0 ? "+" : ""}${v}`).join(" "), reason });
    ev(sim, "policy", `【政策採用】かんたん: ${it.label}`, `${reason}。影響(10年間)`, {});
  }
  if (a.coast) ev(sim, "policy", `${y}年: かんたん介入で${COAST_LABEL2[a.coast]}を重視`, "海岸側の重視は次の改元で候補の選びに効きます(10年ごとの政策としての効果はありません)", {});
  pol.history.push(rec); if (pol.history.length > 20) pol.history.shift(); pol.pending = null; void DOMAIN_LABEL;
  return rec;
}
/** Automatic policy windows with 「今後の自動でも続ける」 on: true when the saved answers decided this window. */
export function autoSimple(sim: SimState): PolicyRecord | null {
  const s = sim.simple41; if (!s?.keep || (!s.transport && !s.city)) return null; return resolveSimple(sim, s, true);
}
/** Automatic era change: the candidate whose reconstruction policy matches the kept coast (and city answer) best; the first one otherwise -- as before. */
export function autoEraIdx(sim: SimState, cands: EraCand[]): number {
  const s = sim.simple41; if (!s?.keep || (!s.coast && !s.city)) return 0;
  let best = 0, bv = -1; cands.forEach((c, i) => { const v = (s.coast && c.recon?.coast === s.coast ? 2 : 0) + (s.city && c.recon?.focus === s.city ? 1 : 0); if (v > bv) { bv = v; best = i; } }); return best;
}
/** Issue #86: an automatic era change in a game whose names and policy are separate keeps the policy in force -- unless the simple mode's kept transport answer says another. */
export function autoStance(sim: SimState): import("./eras").EraKey | undefined {
  const s = sim.simple41; if (!sim.kaigen?.era86 || !s?.keep || !s.transport) return undefined; return ({ road: "shubun", rail: "shoka", sea: "kairo", air: "kuuro" } as const)[s.transport];
}
