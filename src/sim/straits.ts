/**
 * Crossings between the four main islands. The 5 km land grid cannot lay a path across water, so a crossing is a ready-made
 * facility (a tunnel or a bridge) that joins two city nodes directly and opens in a given year.
 *
 * 史実/架空: the opening years on 平成 are the real ones (関門鉄道トンネル 1942 is already there in 1950); the other world lines open the
 * same crossings in different, fictional years: 修文 gets road crossings earlier and 正化 the railway ones. The names and the
 * geometry are the model's (a crossing joins two city centres), not a survey.
 */
import { TABLE_STANCE, type EraKey } from "./eras";
import { stanceAt } from "./kaigen";
import { buildIndex, newEdgeDefaults, newId, nodeAtCell, pushHist } from "./network";
import { designate, ev, yearOf } from "./engine";
import { successorOperator } from "./reform";
import type { Mode, SimEdge, SimState } from "./types";
import type { World } from "./world";

interface Strait { id: string; name: string; a: string; b: string; mode: Mode; fac: "tunnel" | "bridge"; year: Partial<Record<EraKey, number>>; needs?: string; unless?: string }   // needs/unless: a city id that must / must not be on the map
export const STRAITS: Strait[] = [
  { id: "kanmon-rail", name: "関門鉄道トンネル", a: "C-JP-35", b: "C-1159141097", mode: "rail", fac: "tunnel", year: { heisei: 1942, shubun: 1942, shoka: 1942 } },
  { id: "kanmon-road", name: "関門道路トンネル", a: "C-JP-35", b: "C-1159141097", mode: "road", fac: "tunnel", year: { heisei: 1958, shubun: 1956, shoka: 1968 } },
  { id: "seikan", name: "青函トンネル", a: "C-JP-02", b: "C-HK-HAK", mode: "rail", fac: "tunnel", year: { heisei: 1988, shubun: 1992, shoka: 1971 } },
  { id: "seto-road", name: "瀬戸大橋(道路)", a: "C-JP-33", b: "C-JP-37", mode: "road", fac: "bridge", year: { heisei: 1988, shubun: 1978, shoka: 1990 } },
  { id: "seto-rail", name: "瀬戸大橋(鉄道)", a: "C-JP-33", b: "C-JP-37", mode: "rail", fac: "bridge", year: { heisei: 1988, shubun: 1992, shoka: 1974 } },
  // With 淡路島 on the map the crossing is two bridges through 洲本; without it (older games) the single combined crossing below is used
  { id: "akashi-awaji", name: "明石海峡大橋", a: "C-JP-28", b: "X-AWAJI", mode: "road", fac: "bridge", year: { heisei: 1998, shubun: 1985, shoka: 2005 }, needs: "X-AWAJI" },
  { id: "naruto-awaji", name: "大鳴門橋", a: "X-AWAJI", b: "C-JP-36", mode: "road", fac: "bridge", year: { heisei: 1985, shubun: 1978, shoka: 1995 }, needs: "X-AWAJI" },
  { id: "akashi", name: "明石海峡・鳴門の橋", a: "C-JP-28", b: "C-JP-36", mode: "road", fac: "bridge", year: { heisei: 1998, shubun: 1985, shoka: 2005 }, unless: "X-AWAJI" },
  { id: "nishiseto", name: "西瀬戸の橋", a: "C-JP-34", b: "C-JP-38", mode: "road", fac: "bridge", year: { heisei: 1999, shubun: 1988, shoka: 2008 } },
];
const opened = (sim: SimState, id: string) => Object.values(sim.edges).some((e) => e.facilityName?.startsWith(id + ":"));
/** Open every crossing due by `year` (all that are due at the start, one year at a time afterwards). Returns how many opened. */
export function openStraits(sim: SimState, w: World, year: number, atStart = false): number {
  const era = stanceAt(sim, year); if (era === "kobun") return 0; let n = 0;
  for (const s of STRAITS) {
    if ((s.needs && !w.cityById.has(s.needs)) || (s.unless && w.cityById.has(s.unless))) continue;
    const due = s.year[TABLE_STANCE(era) as "heisei"]; if (due === undefined || opened(sim, s.id) || (atStart || sim.kaigen ? due > year : due !== year)) continue;
    const ca = w.cityById.get(s.a), cb = w.cityById.get(s.b); if (!ca || !cb) continue;
    const idx = buildIndex(sim, s.mode), a = nodeAtCell(sim, w, idx, ca.cell, "junction"), b = nodeAtCell(sim, w, idx, cb.cell, "junction"), id = newId(sim, "edge");
    const rail = s.mode === "rail", real = era === "heisei" || due <= 1950;
    let op: string | undefined; if (rail) op = sim.operators.jnr?.until !== undefined ? "" : "jnr";
    const e: SimEdge = {
      ...newEdgeDefaults(), id, a, b, cells: [ca.cell, cb.cell], lengthKm: Math.round(Math.hypot(ca.pos[0] - cb.pos[0], ca.pos[1] - cb.pos[1]) * 10) / 10,
      surface: "paved", quality: 92, built: 1, open: true, state: "open", standard: "standard", maxGradePct: 1, builtMonth: sim.month, region: w.prefOf(ca.cell) ?? "JP-13",
      facility: s.fac, facilityName: `${s.id}:${s.name}`, ...(rail ? { mode: "rail" as const, op: op || "jnr" } : {}),
    };
    sim.edges[id] = e; if (rail && op === "") { e.op = successorOperator(sim, w, e, year); }
    pushHist(sim, e, `${s.name}が開通(${real ? "史実に沿う" : "この世界線の架空の開通年"})`);
    const grade = rail ? (e.op === "jnr" ? "jnr" : "priv") : "national", r = designate(sim, [{ edgeId: id, dir: 1 }], grade, rail ? (e.op === "jnr" ? "JP" : e.op!) : "JP", `${ca.name}〜${cb.name}(${s.name})`, "島をまたぐ路線", true);
    ev(sim, "facility", `${atStart ? "" : real ? "【史実】" : "【架空】"}${s.name}が開通(${ca.name}〜${cb.name})${r ? `。${r.name}` : ""}`, atStart ? "1950年にはすでに開通していた島間の連絡" : `島をまたぐ${rail ? "鉄道" : "道路"}が結ばれた。${real ? "実際の開通年" : "世界線ごとに開通年が違う(架空)"}`, { edge: id });
    n++;
  }
  return n;
}
export const displayName = (e: SimEdge) => (e.facilityName ?? "").replace(/^[a-z-]+:/, "");
export { yearOf };

/**
 * Which of the added islands are cut off from the mainland right now: no open road or rail edge joins the island's network to a city on another
 * island. Returns island numbers (5.. in EXTRA_IDS order). A crossing that is not built yet leaves the island isolated, which is the intended state.
 */
export function isolatedIslands(sim: SimState, w: World): number[] {
  const nodes = Object.values(sim.nodes), nid = new Map(nodes.map((n, i) => [n.id, i])), adj: number[][] = nodes.map(() => []);
  for (const e of Object.values(sim.edges)) if (e.built >= 1 && (e.state === "open" || e.state === "dormant")) { const a = nid.get(e.a), b = nid.get(e.b); if (a !== undefined && b !== undefined) { adj[a].push(b); adj[b].push(a); } }
  const comp = new Int32Array(nodes.length).fill(-1); let c = 0;
  for (let s = 0; s < nodes.length; s++) if (comp[s] < 0) { const st = [s]; comp[s] = c; while (st.length) { const x = st.pop()!; for (const y of adj[x]) if (comp[y] < 0) { comp[y] = c; st.push(y); } } c++; }
  const byCell = new Map(nodes.map((n, i) => [n.cell, i])), out: number[] = [];
  const islands = [...new Set(w.cities.map((x) => x.island))].filter((i) => i > 4);
  for (const isl of islands) {
    const mine = w.cities.filter((x) => x.island === isl).map((x) => byCell.get(x.cell)).filter((x): x is number => x !== undefined), main = w.cities.filter((x) => x.island <= 4).map((x) => byCell.get(x.cell)).filter((x): x is number => x !== undefined);
    const mainComps = new Set(main.map((i) => comp[i])); if (!mine.some((i) => mainComps.has(comp[i]))) out.push(isl);
  }
  return out;
}
