/**
 * Stage 41: the policy line at the top of the map -- what the game was started with (初期方針) and what is stressed now (現在の方針), each as three short words:
 * transport (均衡 / 道路重視 / 鉄道重視 / 海路重視 / 空路重視), city (集中 / 分散) and region (日本海側 / 太平洋側 / 中立). Read from what the game already keeps: the era list (the stance of the era in force) and the reconstruction policy
 * (kaigen.recon: coast and focus). The initial one is recorded when a game is made (`initPolicy`); a game saved before that has only the stance of its first era, and says "—" for the rest rather than guessing.
 */
import type { EraKey } from "./eras";
import type { SimState } from "./types";

export const STANCE_LABEL: Record<EraKey, string> = { heisei: "均衡", shubun: "道路重視", shoka: "鉄道重視", kairo: "海路重視", kuuro: "空路重視", kobun: "旧版" };
export const FOCUS_LABEL = { concentrate: "集中", disperse: "分散" } as const, COAST_LABEL = { japansea: "日本海側", pacific: "太平洋側", neutral: "中立" } as const;
export interface PolicyView { stance: string; city: string; region: string }
const view = (stance: EraKey | undefined, focus?: "concentrate" | "disperse", coast?: "japansea" | "pacific" | "neutral"): PolicyView => ({ stance: stance ? STANCE_LABEL[stance] ?? "—" : "—", city: focus ? FOCUS_LABEL[focus] : "—", region: coast ? COAST_LABEL[coast] : "—" });
export function currentPolicy(sim: Pick<SimState, "kaigen">): PolicyView | null {
  const k = sim.kaigen; if (!k?.eras.length) return null; const e = k.eras[k.eras.length - 1]; return view(e.stance, k.recon?.focus, k.recon?.coast);
}
export function initialPolicy(sim: Pick<SimState, "kaigen" | "initPolicy">): PolicyView | null {
  if (sim.initPolicy) return view(sim.initPolicy.stance, sim.initPolicy.focus, sim.initPolicy.coast);
  const first = sim.kaigen?.eras[0]; return first ? view(first.stance) : null;
}
export const policyText = (v: PolicyView): string => `${v.stance}・${v.city}・${v.region}`;
