/**
 * The ten-yearly policy intervention (10年ごとの政策介入).
 *
 * Every ten years from the start the game opens a window. The player picks one domain (政治 / 経済 / 世論). The program then scores that
 * domain's policies against the world's actual condition (congestion, rural decline, subsidy burden, opinion...) and shows the top five
 * with their scores. A pool of shared points (持ち点) lets the player push any policy of the domain, including ones outside the top five.
 *
 *  - Points carry over in full and without limit, but a policy's boost saturates (diminishing returns): the tenth point on one policy
 *    does far less than the first.
 *  - The two best policies whose final priority clears the bar are adopted; the others are declined, each with a reason.
 *  - Adopted policies become dial mods lasting until the next window; the adoption and the reasons go into the timeline.
 *
 * 史実と架空: the policies are model levers, not a record of real legislation. The window only exists to let the player steer.
 */
import { DIAL_KEYS, type Dials, type Mod } from "./eras";
import { effectText } from "./events";
import { ev } from "./engine";
import { reformJnr } from "./reform";
import { modeOf, type SimState } from "./types";
import { capacityOf } from "./demand";
import type { World } from "./world";

export type Domain = "politics" | "economy" | "opinion";
export const DOMAIN_LABEL: Record<Domain, string> = { politics: "政治", economy: "経済", opinion: "世論" };
export const POINTS_PER_WINDOW = 8, ADOPT_BAR = 0.55, MAX_ADOPT = 2, BOOST_MAX = 1.1, BOOST_SCALE = 5;
export type PolicyMode = "priority" | "idleAuto" | "auto";
export const POLICY_MODE_LABEL: Record<PolicyMode, string> = { priority: "介入優先(時間を止めて待つ)", idleAuto: "放置中のみ自動", auto: "常に自動" };

export interface Env { roadCong: number; railCong: number; ruralDecay: number; jnrWeak: number; growth: number; carDep: number; mood: number; maint: number; privatized: boolean }
interface Policy { id: string; domain: Domain; label: string; desc: string; d: Partial<Dials>; base(e: Env): number; block?(e: Env, era: string): string | null; after?(sim: SimState, w: World, y: number): void }
const c01 = (x: number) => Math.max(0, Math.min(1, x));

export const POLICIES: Policy[] = [
  { id: "p-road", domain: "politics", label: "道路重点配分", desc: "道路の整備・高規格化に予算を寄せる", d: { roadShare: 0.08, hwyBuild: 0.2, carBias: 0.05 }, base: (e) => c01(0.2 + 0.8 * e.roadCong) },
  { id: "p-rail", domain: "politics", label: "鉄道重点配分", desc: "幹線・都市鉄道の整備に予算を寄せる", d: { roadShare: -0.08, railBuild: 0.25, hsr: 0.15 }, base: (e) => c01(0.2 + 0.8 * e.railCong) },
  { id: "p-jnr", domain: "politics", label: "公的鉄道の再建支援", desc: "補助を厚くして荒廃と廃線を食い止める", d: { jnrSubsidy: 0.15, austerity: 0.03 }, base: (e) => c01(e.privatized ? 0.1 : 0.15 + 0.9 * e.jnrWeak) },
  { id: "p-priv", domain: "politics", label: "国鉄の分割・民営化", desc: "公的鉄道を分割し、赤字線は地域へ移すか廃止する", d: { jnrSubsidy: -0.1, growth: 0.01 }, base: (e) => c01(e.privatized ? 0 : 0.1 + 0.9 * e.jnrWeak * 0.8),
    block: (e) => (e.privatized ? "すでに民営化済み" : e.ruralDecay > 0.35 && e.mood < 0 ? "地方の反対が強く、世論が許さない" : null), after: (sim, w, y) => { if (sim.operators.jnr && !sim.operators.jnr.until) reformJnr(sim, w, y); } },
  { id: "p-region", domain: "politics", label: "地方交通の広域連携", desc: "自治体連携で地方の路線を維持する", d: { austerity: 0.06, railBias: 0.03 }, base: (e) => c01(0.1 + 0.9 * e.ruralDecay) },
  { id: "e-stimulus", domain: "economy", label: "景気対策(公共投資)", desc: "公共投資を増やし景気を押し上げる", d: { growth: 0.08, hwyBuild: 0.1, railBuild: 0.1, austerity: -0.02 }, base: (e) => c01(0.25 + (1 - e.growth) * 4) },
  { id: "e-austerity", domain: "economy", label: "財政健全化", desc: "新規投資を絞り、維持に回す", d: { growth: -0.03, hwyBuild: -0.1, railBuild: -0.1, austerity: 0.06 }, base: (e) => c01(0.15 + (e.growth - 1) * 3 + 0.5 * (1 - e.maint)),
    block: (e) => (e.mood < -0.3 ? "不況下の緊縮に世論が反発している" : null) },
  { id: "e-rail-freight", domain: "economy", label: "貨物の鉄道回帰", desc: "物流を鉄道へ(環境負荷と道路混雑の軽減)", d: { freightRail: 0.2, railBuild: 0.05 }, base: (e) => c01(0.15 + 0.7 * e.roadCong) },
  { id: "e-truck", domain: "economy", label: "トラック物流の拡大", desc: "物流を道路へ(高規格道路の活用)", d: { freightRail: -0.2, hwyBuild: 0.1 }, base: (e) => c01(0.15 + 0.6 * e.carDep) },
  { id: "e-fare", domain: "economy", label: "運賃・料金制度の見直し", desc: "公的鉄道の運賃を実情に合わせ、収支を改善する", d: { jnrFare: 0.18, railBias: -0.03, austerity: 0.03 }, base: (e) => c01(e.privatized ? 0.05 : 0.15 + 0.9 * e.jnrWeak) },
  { id: "e-tourism", domain: "economy", label: "観光立国", desc: "観光客向けの高速・地方鉄道に投資する", d: { railBias: 0.08, hsr: 0.1, growth: 0.02 }, base: (e) => c01(0.3 + 0.3 * e.ruralDecay) },
  { id: "o-car", domain: "opinion", label: "自動車社会の推進", desc: "自動車の便利さを広く訴える", d: { carBias: 0.2 }, base: (e) => c01(0.15 + 0.6 * e.carDep) },
  { id: "o-green", domain: "opinion", label: "環境・渋滞対策キャンペーン", desc: "鉄道・公共交通の利用を呼びかける", d: { carBias: -0.2, railBias: 0.1 }, base: (e) => c01(0.2 + 0.8 * e.roadCong) },
  { id: "o-rural", domain: "opinion", label: "地方鉄道を守る運動", desc: "地域で路線を支える動きを後押しする", d: { jnrSubsidy: 0.1, railBias: 0.06, austerity: 0.03 }, base: (e) => c01(0.15 + 0.85 * e.ruralDecay) },
  { id: "o-select", domain: "opinion", label: "選択と集中", desc: "利用の少ない所を絞り、幹線に集中する", d: { austerity: -0.05, growth: 0.03, hwyBuild: -0.05, railBuild: -0.05 }, base: (e) => c01(0.2 + 0.5 * e.ruralDecay), block: (e) => (e.ruralDecay > 0.45 ? "すでに多くの路線が失われ、地域の反発が強い" : null) },
  { id: "o-safety", domain: "opinion", label: "老朽化対策・防災", desc: "橋・トンネル・線路の維持と防災に力を入れる", d: { austerity: 0.1, growth: -0.01 }, base: (e) => c01(0.2 + 0.8 * (1 - e.maint)) },
];
export const policyById = (id: string) => POLICIES.find((p) => p.id === id)!;

export interface PolicyRecord { year: number; domain: Domain; adopted: { id: string; label: string; priority: number; effect: string; reason: string }[]; declined: { id: string; label: string; priority: number; reason: string }[]; spent: Record<string, number>; pointsAfter: number; auto: boolean }
export interface PendingWindow { year: number; domain: Domain | null }
export interface PolicyState { mode: PolicyMode; points: number; pending: PendingWindow | null; lastWindow: number; history: PolicyRecord[]; away: boolean }
export const defaultPolicy = (): PolicyState => ({ mode: "priority", points: 0, pending: null, lastWindow: 0, history: [], away: false });

export function computeEnv(sim: SimState): Env {
  let rc = 0, rn = 0, tc = 0, tn = 0, idle = 0, live = 0, weak = 0, jn = 0;
  for (const e of Object.values(sim.edges)) {
    if (e.built < 1) continue;
    const rail = modeOf(e) === "rail", on = e.state === "open";
    if (on) { if (rail) { tn++; if (e.congYears >= 2 || e.through > 0.9 * capacityOf(e)) tc++; } else { rn++; if (e.congYears >= 2) rc++; } }
    if (e.state === "dormant" || e.state === "closed" || e.state === "lost") idle++; else live++;
    if (rail && on) { jn++; if (e.quality < 40 || e.zeroYears >= 2) weak++; }
  }
  const d = sim.dials;
  return { roadCong: c01(rn ? (rc / rn) * 2 : 0), railCong: c01(tn ? (tc / tn) * 2 : 0), ruralDecay: c01((idle / Math.max(1, live + idle)) * 4), jnrWeak: c01(jn ? (weak / jn) * 2.5 : 0), growth: d.growth, carDep: c01((d.carBias + 0.4) / 2), mood: sim.macro.mood, maint: c01(sim.macro.maintCoverage), privatized: d.privatize >= 0.5 };
}
export const baseScores = (env: Env, domain: Domain) => POLICIES.filter((p) => p.domain === domain).map((p) => ({ p, base: p.base(env) })).sort((a, b) => b.base - a.base || (a.p.id < b.p.id ? -1 : 1));
export const boostOf = (spent: number) => BOOST_MAX * (1 - Math.exp(-Math.max(0, spent) / BOOST_SCALE));
export const topFive = (env: Env, domain: Domain) => baseScores(env, domain).slice(0, 5);

/** A window is due at the start of every tenth year after the start, once. */
export function windowDue(sim: SimState, y: number): boolean { return !!sim.stage3 && !!sim.policy && y > sim.startYear && (y - sim.startYear) % 10 === 0 && sim.policy.lastWindow !== y; }

/** Open the window: grant the points, and either wait for the player or resolve it by itself, according to the setting. */
export function openWindow(sim: SimState, w: World, y: number): void {
  const pol = sim.policy!; if (pol.pending) return;
  pol.points += POINTS_PER_WINDOW; pol.lastWindow = y;
  const auto = pol.mode === "auto" || (pol.mode === "idleAuto" && pol.away);
  if (!auto) { pol.pending = { year: y, domain: null }; ev(sim, "policy", `${y}年: 政策介入の機会(持ち点${pol.points}点)`, "10年ごとの政策介入。時間を止めて、介入する分野を選べます", {}); return; }
  autoResolve(sim, w);
}
/** No player: pick the domain whose best policy is most needed and adopt by the world's own scores, spending nothing (points are carried over). */
export function autoResolve(sim: SimState, w: World): PolicyRecord | null {
  const env = computeEnv(sim); let bestD: Domain = "politics", bv = -1;
  for (const d of ["politics", "economy", "opinion"] as Domain[]) { const t = topFive(env, d)[0].base; if (t > bv) { bv = t; bestD = d; } }
  return resolveWindow(sim, w, bestD, {}, true);
}
/** Player (or the auto setting) commits: spend points, adopt the best, record every outcome with its reason. */
export function resolveWindow(sim: SimState, w: World, domain: Domain, spend: Record<string, number>, auto = false): PolicyRecord | null {
  const pol = sim.policy!, y = pol.pending?.year ?? pol.lastWindow, env = computeEnv(sim), era = sim.era;
  let total = 0; const spent: Record<string, number> = {};
  for (const [id, n] of Object.entries(spend)) { const p = POLICIES.find((q) => q.id === id); if (!p || p.domain !== domain) continue; const k = Math.max(0, Math.floor(n)); if (!k) continue; spent[id] = k; total += k; }
  if (total > pol.points) { for (const id of Object.keys(spent)) delete spent[id]; total = 0; }   // never spend more than is held: spend nothing instead
  pol.points -= total;
  const ranked = baseScores(env, domain).map(({ p, base }) => ({ p, base, prio: base + boostOf(spent[p.id] ?? 0), boost: spent[p.id] ?? 0 })).sort((a, b) => b.prio - a.prio || (a.p.id < b.p.id ? -1 : 1));
  const top5 = new Set(topFive(env, domain).map((t) => t.p.id));
  const rec: PolicyRecord = { year: y, domain, adopted: [], declined: [], spent, pointsAfter: pol.points, auto };
  for (const r of ranked) {
    const blocked = r.p.block?.(env, era) ?? null, shown = top5.has(r.p.id) || r.boost > 0; if (!shown) continue;
    if (!blocked && r.prio >= ADOPT_BAR && rec.adopted.length < MAX_ADOPT) {
      const strength = Math.min(1, r.prio), d: Partial<Dials> = {}; for (const k of DIAL_KEYS) { const v = r.p.d[k]; if (v) d[k] = Math.round(v * strength * 1000) / 1000; }
      const m: Mod = { id: `${r.p.id}-${y}`, kind: "policy", label: r.p.label, from: y, until: y + 10, d }; sim.mods.push(m);
      const reason = `${top5.has(r.p.id) ? "現状から優先度が高い" : "持ち点で押し上げて採用"}(環境${r.base.toFixed(2)}${r.boost ? ` + 持ち点${r.boost}点で+${boostOf(r.boost).toFixed(2)}` : ""} = ${r.prio.toFixed(2)})`;
      rec.adopted.push({ id: r.p.id, label: r.p.label, priority: r.prio, effect: effectText(d), reason });
      ev(sim, "policy", `【政策採用】${DOMAIN_LABEL[domain]}: ${r.p.label}`, `${reason}。影響(10年間): ${effectText(d)}`, {});
      r.p.after?.(sim, w, y);
    } else {
      const reason = blocked ?? (r.prio < ADOPT_BAR ? `優先度が採用ラインに届かない(${r.prio.toFixed(2)} < ${ADOPT_BAR})` : `採用枠(${MAX_ADOPT}件)が埋まっていた`);
      rec.declined.push({ id: r.p.id, label: r.p.label, priority: r.prio, reason });
      ev(sim, "policy", `【政策見送り】${DOMAIN_LABEL[domain]}: ${r.p.label}`, reason, {});
    }
  }
  rec.pointsAfter = pol.points; pol.history.push(rec); if (pol.history.length > 20) pol.history.shift(); pol.pending = null;
  return rec;
}
export const setPolicyMode = (sim: SimState, m: PolicyMode) => { if (sim.policy) sim.policy.mode = m; };
