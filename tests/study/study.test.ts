/**
 * Long-run study harness (not part of the normal suite): runs 1950-2100 under chosen conditions and writes decade metrics as JSON.
 *   STUDY=1 SCEN=H-auto,S-auto OUT=/tmp/study npx vitest run tests/study
 * Conditions are the levers the game offers: the first era's stance (kept at every later era change), the ten-yearly policy choice,
 * the seats of government, and the land (the added islands). Nothing here changes the model.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { analyze, RAIL_PAX } from "../../src/sim/demand";
import { settleKaigen, stepMonth, yearOf } from "../../src/sim/engine";
import { autoResolve, resolveWindow } from "../../src/sim/policy";
import { modeOf, type SimState } from "../../src/sim/types";
import type { World } from "../../src/sim/world";
import { realWorld, ridgeWorld, stage3Sim, stage3SimOn, viaShikoku } from "../unit/simhelp";
import { createSim } from "../../src/sim/engine";
import { cityBoost, paxPull } from "../../src/sim/sites";
import { coastSide, coreness } from "../../src/sim/recon";
import { performNational, previewNational } from "../../src/sim/ceremony";

export interface Scenario { ridges?: "ne" | "sw" | "both"; route?: "shikoku"; later?: "same" | "first"; first: number; policy: "auto" | "road" | "rail" | "none"; capital?: string; sub?: string; palace?: string; alps?: "ne" | "sw" | "both"; islands?: boolean; seed?: number; until?: number }
export const SCENARIOS: Record<string, Scenario> = {
  "H-auto": { first: 0, policy: "auto" }, "S-auto": { first: 1, policy: "auto" }, "R-auto": { first: 2, policy: "auto" }, "A-auto": { first: 3, policy: "auto" }, "K-auto": { first: 4, policy: "auto" },
  "H-none": { first: 0, policy: "none" }, "S-none": { first: 1, policy: "none" }, "R-none": { first: 2, policy: "none" },
  "H-road": { first: 0, policy: "road" }, "H-rail": { first: 0, policy: "rail" }, "S-rail": { first: 1, policy: "rail" }, "R-road": { first: 2, policy: "road" },
  "H-cap47": { first: 0, policy: "auto", capital: "JP-47", sub: "HK-SAP" }, "H-cap27": { first: 0, policy: "auto", capital: "JP-27", sub: "JP-13" },
  "H-noisl": { first: 0, policy: "auto", islands: false },
  // what a player who keeps pressing the first candidate at 1989 / 2019 gets (平成 / 令和 = 均衡): how long does the first choice last?
  // Stage 9: drawn ranges across the Tokaido (北) and the Sanyo (南) corridors, and a 国道1号 drawn through Shikoku
  "H-ridgeNE": { first: 0, policy: "auto", ridges: "ne" }, "H-ridgeSW": { first: 0, policy: "auto", ridges: "sw" }, "H-ridge2": { first: 0, policy: "auto", ridges: "both" }, "H-shikoku": { first: 0, policy: "auto", route: "shikoku" },
  // Stage 10: role swaps (A-C), the 1945 reconstruction policy (D, E: candidates 0 / 5 / 10 are all 均衡; 0 = 太平洋側・一極集中, 5 = 日本海側・一極集中, 10 = 太平洋側・地方分散)
  "T-base": { first: 0, policy: "auto" }, "T-capSAP": { first: 0, policy: "auto", capital: "HK-SAP", sub: "JP-27" }, "T-sub37": { first: 0, policy: "auto", sub: "JP-37" }, "T-sub17": { first: 0, policy: "auto", sub: "JP-17" },
  "T-pal40": { first: 0, policy: "auto", palace: "JP-40" }, "T-alps": { first: 0, policy: "auto", alps: "both" }, "T-alpsNE": { first: 0, policy: "auto", alps: "both", ridges: "ne" }, "T-ridgeNE": { first: 0, policy: "auto", ridges: "ne" }, "T-japansea": { first: 5, policy: "auto" }, "T-disperse": { first: 10, policy: "auto" },
  "S-later1": { first: 1, policy: "auto", later: "first" }, "R-later1": { first: 2, policy: "auto", later: "first" }, "H-seed2": { first: 0, policy: "auto", seed: 11 },
};
const STANCE_OF = ["heisei", "shubun", "shoka", "kuuro", "kairo"];

/** Decade metrics. Flows are read with a fresh analysis whose per-edge results are put back afterwards, so measuring never changes the run. */
export function measure(sim: SimState, w: World) {
  const es = Object.values(sim.edges), keep = es.map((e) => [e.through, e.local, e.freight]); const an = analyze(sim, w);
  let roadPkm = 0, railPkm = 0, roadFr = 0, railFr = 0;
  for (const e of es) { if (e.state !== "open" || e.built < 1 || e.facility === "ferry") continue; if (modeOf(e) === "rail") { railPkm += (e.through / RAIL_PAX + e.local) * e.lengthKm; railFr += e.freight * e.lengthKm; } else { roadPkm += (e.through + e.local) * e.lengthKm; roadFr += e.freight * e.lengthKm; } }
  es.forEach((e, i) => { [e.through, e.local, e.freight] = keep[i]; });
  const live = es.filter((e) => e.state === "open" && e.built >= 1 && e.facility !== "ferry"), km = (f: (e: (typeof es)[0]) => boolean) => Math.round(live.filter(f).reduce((s, e) => s + e.lengthKm, 0));
  const ops = sim.operators, priv = (e: (typeof es)[0]) => !!e.op && ops[e.op]?.kind !== "jnr" && !e.op.startsWith("jr.");
  const routes = Object.values(sim.routes).filter((r) => r.active);
  const dens = routes.filter((r) => modeOf(r) === "rail").map((r) => { const xs = r.edges.map((x) => sim.edges[x.edgeId]).filter(Boolean), k = xs.reduce((s, e) => s + e.lengthKm, 0) || 1; return xs.reduce((s, e) => s + (e.through + e.local + 0.4 * e.freight) * e.lengthKm, 0) / k; }).sort((a, b) => a - b);
  const q = (f: number) => (dens.length ? Math.round(dens[Math.min(dens.length - 1, Math.floor(f * dens.length))]) : 0);
  // Stage 8: the four modes side by side, in traveller-km (a road vehicle is RAIL_PAX travellers) and freight-km (rail freight is counted RAIL_PAX times on the line)
  let pR = 0, pT = 0, fR = 0, fT = 0; for (const e of es) { if (e.state !== "open" || e.built < 1 || e.facility === "ferry") continue; if (modeOf(e) === "rail") { pT += (e.through + e.local) * e.lengthKm; fT += (e.freight / RAIL_PAX) * e.lengthKm; } else { pR += (e.through + e.local) * RAIL_PAX * e.lengthKm; fR += e.freight * e.lengthKm; } }
  const h = sim.hubs, P = h ? Object.values(h.ports).filter((p) => p.until === undefined) : [], A = h ? Object.values(h.airports).filter((a) => a.until === undefined) : [], R = h ? h.routes.filter((r) => r.state === "open") : [];
  const mode = { pkmRoad: Math.round(pR / 1e3), pkmRail: Math.round(pT / 1e3), pkmAir: Math.round((an.airPkm ?? 0) / 1e3), fkmRoad: Math.round(fR / 1e3), fkmRail: Math.round(fT / 1e3), fkmSea: Math.round((an.seaTkm ?? 0) / 1e3),
    ports: P.length, portTier: P.reduce((s, p) => s + p.tier, 0), bigPorts: P.filter((p) => p.tier >= 3).length, portCargo: Math.round(P.reduce((s, p) => s + p.cargo, 0)), airports: A.length, hubs: A.filter((a) => a.kind === "hub").length,
    airPax: Math.round(A.reduce((s, a) => s + a.pax, 0)), airIntl: Math.round(A.reduce((s, a) => s + a.intl, 0)), hubCap: A.filter((a) => a.kind === "hub").reduce((s, a) => s + a.cap, 0), seaLanes: R.filter((r) => r.mode === "sea").length, airIntlLanes: R.filter((r) => r.mode === "air" && r.intl).length, airDomLanes: R.filter((r) => r.mode === "air" && !r.intl).length,
    lakeFerries: es.filter((e) => e.facility === "ferry" && (e.facilityName ?? "").includes("【湖】") && e.state === "open").length, lakeBridges: es.filter((e) => e.facility === "bridge" && (e.facilityName ?? "").includes("湖上大橋") && e.built >= 1).length, unmet: Math.round(an.hub?.unmet ?? 0) };
  // Stage 9: per corridor group -- network, high-standard lines, traffic (demand) on it, and city-to-city times
  const reg: Record<string, number> = {};
  for (const g of Object.keys(GROUPS)) {
    const inG = live.filter((e) => groupOf(e.region) === g), k = (f: (e: (typeof es)[0]) => boolean) => Math.round(inG.filter(f).reduce((s, e) => s + e.lengthKm, 0));
    reg[`${g}Road`] = k((e) => modeOf(e) === "road"); reg[`${g}Rail`] = k((e) => modeOf(e) === "rail"); reg[`${g}High`] = k((e) => e.standard === "highgrade");
    reg[`${g}Dem`] = Math.round(inG.reduce((s, e) => s + (e.through + e.local + 0.4 * e.freight) * e.lengthKm, 0) / 1e3);
  }
  const nc = w.cities.length, ix = (n: string) => w.cities.findIndex((c) => c.name === n), tt = (a: string, b: string) => { const i = ix(a), j = ix(b); if (i < 0 || j < 0) return -1; const t = Math.min(an.T[i * nc + j], an.TT[i * nc + j] + 0.4); return isFinite(t) ? Math.round(t * 100) / 100 : -1; };
  Object.assign(reg, { tToyamaNagano: tt("富山市", "長野市"), tKofuNagoya: tt("甲府市", "名古屋市"), tToyamaNagoya: tt("富山市", "名古屋市"), tTokyoOsaka: tt("東京", "大阪市"), tOsakaFukuoka: tt("大阪市", "福岡市"), tTokyoNagoya: tt("東京", "名古屋市"), tOkayamaHiroshima: tt("岡山市", "広島市"), tNiigataKanazawa: tt("新潟市", "金沢市"), tMatsueTottori: tt("松江市", "鳥取市"), tTakamatsuMatsuyama: tt("高松市", "松山市"), tKochiMatsuyama: tt("高知市", "松山市") });
  // Stage 10: per prefecture (the ones the role and policy comparisons read), and the two coasts / the core around the seats
  const pf: Record<string, number> = {};
  for (const p of PREFS10) {
    const cs = w.cities.filter((c) => c.pref === p), pop = cs.reduce((s, c) => s + sim.cities[c.id].pop, 0), ind = cs.reduce((s, c) => s + sim.cities[c.id].pop * sim.cities[c.id].industry, 0);
    const inP = live.filter((e) => e.region === p), pk = (f: (e: (typeof es)[0]) => boolean) => Math.round(inP.filter(f).reduce((s, e) => s + e.lengthKm, 0)), seat = cs.find((c) => c.kind === "capital");
    pf[`${p}.pop`] = Math.round(pop / 1000); pf[`${p}.ind`] = Math.round(ind / 1000); pf[`${p}.tour`] = seat ? Math.round(cityBoost(sim, w, seat.id).tourism * 1000) / 1000 : 0; pf[`${p}.pax`] = seat ? Math.round(paxPull(sim, w, seat.id) * 1000) / 1000 : 0;
    pf[`${p}.road`] = pk((e) => modeOf(e) === "road"); pf[`${p}.rail`] = pk((e) => modeOf(e) === "rail"); pf[`${p}.high`] = pk((e) => e.standard === "highgrade");
    pf[`${p}.port`] = Math.max(0, ...cs.map((c) => (h?.ports[c.id]?.until === undefined ? h?.ports[c.id]?.tier ?? 0 : 0))); pf[`${p}.air`] = cs.reduce((s, c) => s + (h?.airports[c.id]?.until === undefined ? (h?.airports[c.id]?.pax ?? 0) : 0), 0); pf[`${p}.hub`] = cs.some((c) => h?.airports[c.id]?.kind === "hub" && h?.airports[c.id]?.until === undefined) ? 1 : 0;
  }
  let pac = 0, jsea = 0, core = 0, tot = 0; for (const c of w.cities) { const n = sim.cities[c.id].pop, sd = coastSide(w, c.id); tot += n; if (sd > 0.2) pac += n; if (sd < -0.2) jsea += n; core += n * (coreness(sim, w, c.id) > 0.3 ? 1 : 0); }
  const shk = (f: (r: string) => boolean) => Math.round(live.filter((e) => f(e.region)).reduce((s, e) => s + e.lengthKm, 0));
  const pacPrefs = new Set(w.cities.filter((c) => coastSide(w, c.id) > 0.2).map((c) => c.pref)), jsPrefs = new Set(w.cities.filter((c) => coastSide(w, c.id) < -0.2).map((c) => c.pref));
  Object.assign(pf, { pacShare: Math.round((pac / tot) * 1000) / 1000, jsShare: Math.round((jsea / tot) * 1000) / 1000, coreShare: Math.round((core / tot) * 1000) / 1000, pacKm: shk((r) => pacPrefs.has(r)), jsKm: shk((r) => jsPrefs.has(r)) });
  return {
    ...pf,
    ...reg,
    ...mode,
    year: yearOf(sim), roadKm: km((e) => modeOf(e) === "road"), roadRural: km((e) => modeOf(e) === "road" && e.standard === "rural"), roadStd: km((e) => modeOf(e) === "road" && e.standard === "standard"), roadHigh: km((e) => modeOf(e) === "road" && e.standard === "highgrade"),
    railKm: km((e) => modeOf(e) === "rail"), railRural: km((e) => modeOf(e) === "rail" && e.standard === "rural"), railHigh: km((e) => modeOf(e) === "rail" && e.standard === "highgrade"), railJnr: km((e) => modeOf(e) === "rail" && !priv(e)), railJR: km((e) => modeOf(e) === "rail" && !!e.op && e.op.startsWith("jr.")), railPriv: km((e) => modeOf(e) === "rail" && priv(e)),
    roadRoutes: routes.filter((r) => modeOf(r) === "road").length, railRoutes: routes.filter((r) => modeOf(r) === "rail").length, localRoad: routes.filter((r) => modeOf(r) === "road" && (r.grade === "fu" || r.grade === "ken")).length,
    paxRailShare: Math.round((railPkm / Math.max(1, railPkm + roadPkm)) * 1000) / 1000, frRailShare: Math.round((railFr / Math.max(1, railFr + roadFr)) * 1000) / 1000, airShare: Math.round(an.airShare * 1000) / 1000,
    lostRoadKm: Math.round(es.filter((e) => modeOf(e) === "road" && e.state === "lost").reduce((s, e) => s + e.lengthKm, 0)), closedRailKm: Math.round(es.filter((e) => modeOf(e) === "rail" && e.built >= 1 && (e.state === "closed" || e.state === "lost")).reduce((s, e) => s + e.lengthKm, 0)),
    bypass: sim.links.length, unbuilt: Object.values(sim.projects).filter((p) => p.status === "unbuilt").length, pop: Math.round(Object.values(sim.cities).reduce((s, c) => s + c.pop, 0) / 1e5) / 10,
    budget: Math.round(sim.macro.budgetBu * 100) / 100, deficitLines: Object.values(sim.routes).filter((r) => r.history.some((h) => h.text === "赤字のため廃止")).length, railDensP10: q(0.1), maxGrowth: Math.round(Math.max(...w.cities.map((c) => sim.cities[c.id].pop / Math.max(1, c.pop0))) * 100) / 100, top1: Math.round(Math.max(...w.cities.map((c) => sim.cities[c.id].pop)) / Math.max(1, w.cities.reduce((s, c) => s + sim.cities[c.id].pop, 0)) * 1000) / 1000, railDensP25: q(0.25), railDensP50: q(0.5),
  };
}
export const PREFS10 = ["JP-13", "JP-14", "JP-11", "JP-12", "HK-SAP", "HK-HAK", "HK-NEM", "JP-02", "JP-27", "JP-28", "JP-26", "JP-37", "JP-36", "JP-38", "JP-17", "JP-40", "JP-15", "JP-23", "JP-34", "JP-16", "JP-19", "JP-20", "JP-21"];
export const RIDGE_NE: [number, number][] = [[138.35, 34.95], [138.4, 35.4], [138.5, 35.9], [138.6, 36.4]], RIDGE_SW: [number, number][] = [[133.75, 34.45], [133.65, 34.8], [133.55, 35.15], [133.45, 35.45]];
/** Stage 9: corridors compared in the report (prefecture groups; used only to read the results, never by the model). */
export const GROUPS: Record<string, string[]> = { belt: ["JP-11", "JP-12", "JP-13", "JP-14", "JP-22", "JP-23", "JP-24", "JP-25", "JP-26", "JP-27", "JP-28", "JP-29", "JP-30", "JP-33", "JP-34", "JP-35"], sea: ["JP-05", "JP-06", "JP-15", "JP-16", "JP-17", "JP-18", "JP-31", "JP-32"], shikoku: ["JP-36", "JP-37", "JP-38", "JP-39"] };
export const groupOf = (pref: string | null | undefined) => Object.keys(GROUPS).find((g) => GROUPS[g].includes(pref ?? "")) ?? null;
function start9(sc: Scenario) {
  const ridges = sc.ridges === "ne" ? { ne: RIDGE_NE } : sc.ridges === "sw" ? { sw: RIDGE_SW } : sc.ridges === "both" ? { ne: RIDGE_NE, sw: RIDGE_SW } : null;
  const base = ridges || sc.alps ? ridgeWorld(ridges ?? {}, true, sc.alps === "ne" ? { ne: true } : sc.alps === "sw" ? { sw: true } : sc.alps === "both" ? { ne: true, sw: true } : undefined) : realWorld(true);
  if (!sc.route) return stage3SimOn(base, sc.first, sc.seed ?? 7);
  const { w, hash } = base, sim = createSim(w, "m", hash, sc.seed ?? 7, { stage3: true, firstEra: sc.first, techK: 2, subCapital: "JP-27" }), p = previewNational(w, viaShikoku(w), sim.capital, sim.subCapital);
  if (!performNational(sim, w, p)) throw new Error("shikoku ceremony failed: " + p.reasons.join()); return { sim, w };
}
export function runScenario(name: string, sc: Scenario) {
  const { sim, w } = sc.ridges || sc.route || sc.alps ? start9(sc) : stage3Sim("heisei", sc.seed ?? 7, true, sc.first, 2, sc.islands ?? true, sc.capital || sc.sub || sc.palace ? { capital: sc.capital, sub: sc.sub, palace: sc.palace } : undefined);
  sim.policy!.mode = "priority";
  const stance = STANCE_OF[sc.first], status = new Map<string, string>(), est = new Map<string, string>(), dec: Record<string, number>[] = [], rows: ReturnType<typeof measure>[] = [];
  let cur: Record<string, number> = {}; const bump = (k: string, n = 1) => { cur[k] = (cur[k] ?? 0) + n; };
  for (const p of Object.values(sim.projects)) status.set(p.id, p.status); for (const e of Object.values(sim.edges)) est.set(e.id, e.state);
  rows.push(measure(sim, w)); const until = sc.until ?? 2100, t0 = Date.now(); let maxMonthMs = 0;
  while (yearOf(sim) < until) {
    const tm = performance.now(); stepMonth(sim, w); maxMonthMs = Math.max(maxMonthMs, performance.now() - tm);
    if (sim.kaigen?.pending) { const i = sc.later === "first" ? 0 : sim.kaigen.pending.cands.findIndex((c) => c.stance === stance); settleKaigen(sim, i >= 0 ? i : 0, true); }
    if (sim.policy?.pending) {
      const pts = sim.policy.points;
      if (sc.policy === "auto") autoResolve(sim, w); else if (sc.policy === "none") { sim.policy.pending = null; }
      else resolveWindow(sim, w, "politics", { [sc.policy === "road" ? "p-road" : "p-rail"]: pts });
    }
    for (const p of Object.values(sim.projects)) { const was = status.get(p.id); if (was !== p.status) { status.set(p.id, p.status); { const g = groupOf(p.region === "JP" ? (sim.edges[p.edgeIds[0]]?.region ?? "") : p.region); if (g && p.status === "open") { bump(`${g}.opened`); bump(`${g}.cost`, Math.round(p.costBu * 10) / 10); } } if (p.status === "open" || p.status === "unbuilt" || p.status === "abolished" || p.status === "suspended" || (p.status === "building" && was !== "building")) bump(`${modeOf(p)}.${p.kind}.${p.status}`); } }
    for (const e of Object.values(sim.edges)) { const was = est.get(e.id); if (was !== e.state) { est.set(e.id, e.state); if (was && e.built >= 1 && e.facility !== "ferry") { bump(`${modeOf(e)}.${was}>${e.state}`); const g = groupOf(e.region); if (g && (e.state === "closed" || e.state === "lost") && was === "open") bump(`${g}.closedKm`, Math.round(e.lengthKm)); } } }
    if (sim.month % 120 === 0 && rows[rows.length - 1].year !== yearOf(sim)) { rows.push(measure(sim, w)); dec.push({ year: yearOf(sim), ...cur }); cur = {}; }
  }
  return { name, sc, rows, dec, wallS: Math.round((Date.now() - t0) / 100) / 10, maxMonthMs: Math.round(maxMonthMs) };
}

describe.skipIf(!process.env.STUDY)("study", () => {
  for (const name of (process.env.SCEN ?? "H-auto").split(",")) it(name, () => {
    const r = runScenario(name, { ...SCENARIOS[name], ...(process.env.UNTIL ? { until: +process.env.UNTIL } : {}) }); const out = process.env.OUT ?? "/tmp/claude-0/study"; mkdirSync(out, { recursive: true }); writeFileSync(`${out}/${name}.json`, JSON.stringify(r, null, 1));
  }, 3_600_000);
});
