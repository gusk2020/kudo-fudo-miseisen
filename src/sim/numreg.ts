/**
 * Stage 23: the route NUMBER REGISTER -- the numbers a player reads in the 路線番号一覧, kept apart from the game's internal ids (route.id, edge.id) and from the administrative
 * numbers the roads and railways already carry (国道7号, JR何号線: those belong to the routes and are not touched).
 *
 * Six classes, each with its own count from 1: 道路 / 高速道路 / 鉄道 / 新幹線(リニア含む) / 海路(国内) / 空路(国内). A number is issued once, when the line is first seen in the game
 * (planned, unbuilt or open alike); it is never given to another line, whatever happens to the first. What a number records:
 *   state   供用中 active / 計画中 planned / 未成 unbuilt / 廃線 abolished / 欠番 void (a number that was issued and then folded into another line's)
 *   revived the year a line that had been given up came back (it keeps its number)
 *   hist    every change of state, with its year
 * A line is recognised by the ground it covers (its edges), not by its id: a project that becomes a route, or a closed line that is reopened, keeps its number.
 * 欠番 (a gap in 1..max with no entry at all) is shown as such; nothing is drawn for it. 国道0号 holds 道路 number 0. A register started in a game that had none (an older save) marks its
 * numbers `est` -- estimated at that year -- because the order they were first seen in is not known, and says so.
 * Read-only for the simulation: the register changes nothing in the network, the economy or the people. No random numbers.
 */
import { modeOf, type SimEdge, type SimState } from "./types";

export type NumClass = "road" | "hwy" | "rail" | "hsr" | "sea" | "air";
export const NUM_CLASSES: [NumClass, string][] = [["road", "道路"], ["hwy", "高速道路"], ["rail", "鉄道"], ["hsr", "新幹線"], ["sea", "海路"], ["air", "空路"]];
export type NumState = "active" | "planned" | "unbuilt" | "abolished" | "void";
export const NUM_STATE_LABEL: Record<NumState, string> = { active: "供用中", planned: "計画中", unbuilt: "未成", abolished: "廃線", void: "欠番(統合)" };
export interface NumEntry { n: number; key: string; since: number; edges: string[]; ends?: [string, string]; state: NumState; revived?: number; est?: true; hist: { y: number; s: NumState }[]; label: string }
export interface NumReg { next: Record<NumClass, number>; list: Record<NumClass, NumEntry[]>; migrated?: number }

export const HWY_MIN_KM = 30;
export const newNumReg = (): NumReg => ({ next: { road: 1, hwy: 1, rail: 1, hsr: 1, sea: 1, air: 1 }, list: { road: [], hwy: [], rail: [], hsr: [], sea: [], air: [] } });
interface Item { key: string; cls: NumClass; edges: string[]; ends?: [string, string]; state: NumState; since: number; label: string; zero?: true }

const edgeCls = (e: SimEdge): NumClass => (e.facility === "ferry" ? "sea" : modeOf(e) === "rail" ? (e.maglev || e.standard === "highgrade" ? "hsr" : "rail") : e.standard === "highgrade" ? "hwy" : "road");
const live = (e: SimEdge) => e.built >= 1 && (e.state === "open" || e.state === "dormant");
/** The items of the game right now: its routes, ferries, domestic flights and sea lanes, and the new lines still only planned. */
function items(sim: SimState, y: number): Item[] {
  const out: Item[] = [], inRoute = new Set<string>(), yr = (m: number | null | undefined) => sim.startYear + Math.floor((m ?? 0) / 12);
  for (const r of Object.values(sim.routes)) {
    const es = [...r.edges.map((x) => sim.edges[x.edgeId]), ...r.oldEdges.map((id) => sim.edges[id])].filter(Boolean); for (const x of r.edges) inRoute.add(x.edgeId);
    if (!es.length) continue; const main = r.edges.map((x) => sim.edges[x.edgeId]).filter(Boolean), rail = main.length ? modeOf(main[0]) === "rail" : r.mode === "rail";
    const state: NumState = !r.active ? "abolished" : main.some(live) ? "active" : main.some((e) => e.built < 1) ? "planned" : "abolished";
    out.push({ key: "r:" + r.id, cls: rail ? "rail" : "road", edges: es.map((e) => e.id), state, since: yr(r.since), label: r.name, ...(r.grade === "national" && r.number === 0 && r.scope === "JP" ? { zero: true as const } : {}) });
  }
  // 高速道路 and 新幹線 are stretches of a route, not routes of their own (an expressway is part of a 国道): the high-grade part of a route that is long enough is one line, and stays that line
  for (const r of Object.values(sim.routes)) {
    const main = r.edges.map((x) => sim.edges[x.edgeId]).filter(Boolean);
    for (const cls of ["hwy", "hsr"] as const) {
      const l = main.filter((e) => edgeCls(e) === cls); if (!l.length || l.reduce((t, e) => t + e.lengthKm, 0) < HWY_MIN_KM) continue;
      const first = l.slice().sort((a, b) => (a.builtMonth ?? 0) - (b.builtMonth ?? 0) || (a.id < b.id ? -1 : 1))[0];
      out.push({ key: `${cls}:${r.id}`, cls, edges: l.map((e) => e.id), state: !r.active ? "abolished" : l.some(live) ? "active" : l.some((e) => e.built < 1) ? "planned" : "abolished", since: yr(first.builtMonth), label: `${r.name}の${cls === "hwy" ? "高速区間" : "新幹線区間"}` });
    }
  }
  for (const e of Object.values(sim.edges)) if (e.facility === "ferry" && !inRoute.has(e.id)) out.push({ key: "f:" + e.id, cls: "sea", edges: [e.id], state: live(e) ? "active" : e.built < 1 ? "planned" : "abolished", since: yr(e.builtMonth), label: (e.facilityName ?? "航路").replace(/^ferry:/, "") });
  for (const hr of sim.hubs?.routes ?? []) { if (hr.intl) continue; out.push({ key: "h:" + hr.id, cls: hr.mode === "air" ? "air" : "sea", edges: [], ends: [hr.a, hr.b], state: hr.state === "closed" ? "abolished" : "active", since: hr.since, label: `${hr.a}〜${hr.b}` }); }
  for (const p of Object.values(sim.projects)) {
    if (p.routeId && sim.routes[p.routeId]) continue; if (p.kind !== "new" && p.kind !== "convert") continue; if (p.edgeIds.some((id) => inRoute.has(id))) continue;
    const es = p.edgeIds.map((id) => sim.edges[id]).filter(Boolean); if (!es.length) continue; if (p.status === "open") continue;
    if (es.every((e) => edgeCls(e) === "hwy" || edgeCls(e) === "hsr")) continue;   // (those are counted as stretches above)
    if (p.status !== "unbuilt" && es.reduce((t, e) => t + e.lengthKm, 0) < 40) continue;   // a short planned link is not a line of its own until it is one: 未成線 and long plans get a number
    out.push({ key: "p:" + p.id, cls: edgeCls(es[0]), edges: es.map((e) => e.id), state: p.status === "unbuilt" ? "unbuilt" : p.status === "abolished" ? "abolished" : "planned", since: yr(p.startMonth), label: `${sim.nodes[p.from]?.name ?? "地点"}〜${sim.nodes[p.to]?.name ?? "地点"}` });
  }
  void y; return out;
}
/** How much of the smaller of two edge lists lies in the other (a plan that became part of a longer route, a stretch that grew: the same ground). */
const overlap = (a: string[], b: Set<string>) => { if (!a.length || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / Math.min(a.length, b.size); };
/** Yearly: give new lines their numbers, follow the state of every numbered line. */
export function syncNumbers(sim: SimState, y: number): void {
  const fresh = !sim.numreg, reg = (sim.numreg ??= newNumReg()); if (fresh) reg.migrated = y;
  const its = items(sim, y), byKey = new Map<string, NumEntry>(), claimed = new Set<NumEntry>();
  for (const cl of NUM_CLASSES) for (const en of reg.list[cl[0]]) byKey.set(en.key, en);
  const unmatched: Item[] = [];
  for (const it of its) { const en = byKey.get(it.key); if (en && en.state !== "void" && !claimed.has(en)) claimed.add(en), update(en, it, y); else unmatched.push(it); }
  // a line whose key changed (a project that became a route, a line that came back) is the same line if it covers the same ground
  if (unmatched.length) {
    const stale = (cl: NumClass) => reg.list[cl].filter((en) => !claimed.has(en) && en.state !== "void" && en.edges.length);
    for (const it of [...unmatched]) {
      if (!it.edges.length) continue; let best: NumEntry | null = null, bv = 0;
      for (const en of stale(it.cls)) { const v = overlap(it.edges, new Set(en.edges)); if (v > bv + 1e-9) { bv = v; best = en; } }
      if (best && bv >= 0.5) { byKey.delete(best.key); best.key = it.key; claimed.add(best); update(best, it, y); unmatched.splice(unmatched.indexOf(it), 1); }
    }
  }
  // a plan that lies on ground an existing line already covers is part of that line: it takes no number of its own
  const covered = (it: Item) => it.key.startsWith("p:") && reg.list[it.cls].some((en) => claimed.has(en) && overlap(it.edges, new Set(en.edges)) >= 0.5);
  unmatched.sort((a, b) => a.since - b.since || (a.key < b.key ? -1 : 1));
  for (const it of unmatched) {
    if (covered(it)) continue;
    let n: number;
    if (it.zero && it.cls === "road" && !reg.list.road.some((e) => e.n === 0)) n = 0; else n = reg.next[it.cls]++;
    const en: NumEntry = { n, key: it.key, since: it.since, edges: it.edges, ...(it.ends ? { ends: it.ends } : {}), state: it.state, hist: [{ y: Math.max(it.since, sim.startYear), s: it.state }], label: it.label, ...(fresh ? { est: true as const } : {}) };
    reg.list[it.cls].push(en); claimed.add(en); byKey.set(it.key, en);
  }
  // a numbered line that no longer exists as anything (and was not matched): folded into a line that covers its ground (欠番) or given up (廃線)
  for (const cl of NUM_CLASSES) for (const en of reg.list[cl[0]]) {
    if (claimed.has(en) || en.state === "void" || en.state === "abolished") continue;
    const into = en.key.startsWith("p:") && reg.list[cl[0]].some((o) => o !== en && claimed.has(o) && o.state !== "void" && overlap(en.edges, new Set(o.edges)) >= 0.5);   // (a plan that became part of a line)
    en.state = into ? "void" : "abolished"; if (into) en.key = "void:" + cl[0] + en.n; en.hist.push({ y, s: en.state });
  }
}
function update(en: NumEntry, it: Item, y: number) {
  if (it.edges.length) en.edges = it.edges; if (it.ends) en.ends = it.ends; en.label = it.label;
  if (en.state !== it.state) { if (it.state === "active" && (en.state === "abolished" || en.state === "unbuilt") && en.hist.some((h) => h.s === "active")) en.revived = y; en.state = it.state; en.hist.push({ y, s: it.state }); }
}
/** What a chip of the number list shows. */
export type ChipKind = NumState | "revived" | "gap";
export const chipOf = (en: NumEntry | undefined): ChipKind => (!en ? "gap" : en.state === "active" && en.revived !== undefined ? "revived" : en.state);
export const entryOf = (sim: SimState, cls: NumClass, n: number): NumEntry | undefined => sim.numreg?.list[cls].find((e) => e.n === n);
export const maxNumber = (sim: SimState, cls: NumClass) => Math.max(0, (sim.numreg?.next[cls] ?? 1) - 1);
