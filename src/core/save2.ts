/** Save format v2: { map, sim } with integrity checks. v1 (map only) is migrated, never rejected. Nothing here throws. */
import { validMetro } from "../sim/metro";
import { STANCES } from "../sim/kaigen";
import { checkIntegrity } from "../sim/network";
import { DIAL_KEYS, composeDials } from "../sim/eras";
import { defaultPolicy } from "../sim/policy";
import { hashString } from "../sim/engine";
import type { SimState } from "../sim/types";
import type { World } from "../sim/world";
import { parseState } from "./save";
import { prefName, seatsOf } from "./seat";
import type { ProjectState } from "./types";
import { ISLAND_IDS } from "./types";

export const SAVE_VERSION = 2;
/** Hash of everything that defines the finished map (not view prefs or step). Changes whenever the map is edited. */
export function mapStateHash(s: ProjectState): string {
  return hashString(JSON.stringify([s.seed, ISLAND_IDS.map((id) => s.bodies[id]), s.features.biwa, s.features.fuji, s.ridges.sw, s.ridges.ne, ...(s.ridgeExtra && (s.ridgeExtra.sw.length || s.ridgeExtra.ne.length) ? [["ridgeExtra", s.ridgeExtra]] : []), ...(s.alpsRemoved && (s.alpsRemoved.ne || s.alpsRemoved.sw) ? [["alps", !!s.alpsRemoved.ne, !!s.alpsRemoved.sw]] : []), ...(s.islands ? ["islands"] : []), ...(s.capital ? ["capital", s.capital] : []), ...(s.subCapital ? ["sub", s.subCapital] : []), ...(s.palace ? ["palace", s.palace] : []), ...(s.palacePos ? ["palacePos", s.palacePos] : []), ...(s.capitalPos ? ["capitalPos", s.capitalPos] : []), ...(s.subPos ? ["subPos", s.subPos] : [])]));   // the extras are appended only when set, so a save made before them hashes exactly as it did
}
export interface GameSave { format: "kudo-fudo-miseisen"; schemaVersion: 2; savedAt: number; map: ProjectState; mapHash: string; sim: SimState | null }
export function makeSave(map: ProjectState, sim: SimState | null): GameSave {
  return { format: "kudo-fudo-miseisen", schemaVersion: 2, savedAt: Date.now(), map, mapHash: mapStateHash(map), sim };
}
const monthYear = (r: any) => (Number.isInteger(r.startYear) ? r.startYear : 1950) + Math.floor((Number.isInteger(r.month) ? r.month : 0) / 12);
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isRec = (x: unknown): x is Record<string, any> => !!x && typeof x === "object" && !Array.isArray(x);

/** All-or-nothing: a road network is either fully trustworthy or not loaded at all (it is quarantined, not repaired). */
export function sanitizeSim(raw: unknown): { sim: SimState | null; problems: string[] } {
  const no = (m: string) => ({ sim: null, problems: [m] });
  if (!isRec(raw)) return no("道路データの形式が不正です");
  if (raw.schemaVersion !== 1 && raw.schemaVersion !== 2 && raw.schemaVersion !== 3) return no(`道路データのバージョン(${String(raw.schemaVersion)})に対応していません`);
  if (typeof raw.mapHash !== "string" || typeof raw.terrainHash !== "string") return no("道路データに地図の照合情報がありません");
  if (!Number.isInteger(raw.month) || raw.month < 0 || raw.month > 12 * 1000 || !Number.isInteger(raw.rngState) || !Number.isInteger(raw.startYear)) return no("道路データの時刻が不正です");
  for (const k of ["nodes", "edges", "routes", "projects", "cities", "next", "macro", "routeCounters"]) if (!isRec(raw[k])) return no(`道路データの${k}が不正です`);
  for (const n of Object.values<any>(raw.nodes)) if (!isRec(n) || typeof n.id !== "string" || !Number.isInteger(n.cell) || !Array.isArray(n.pos) || !fin(n.pos[0]) || !fin(n.pos[1])) return no("ノードが不正です");
  for (const e of Object.values<any>(raw.edges)) {
    if (!isRec(e) || typeof e.id !== "string" || typeof e.a !== "string" || typeof e.b !== "string" || !Array.isArray(e.cells) || e.cells.length < 2 || !e.cells.every((c: unknown) => Number.isInteger(c) && (c as number) >= 0)) return no("道路区間が不正です");
    for (const f of ["lengthKm", "quality", "weathering", "built", "maxGradePct", "traffic", "lowYears"]) if (!fin(e[f])) return no("道路区間の数値が不正です");
    if (typeof e.open !== "boolean" || typeof e.lost !== "boolean" || !["unpaved", "gravel", "paved"].includes(e.surface)) return no("道路区間の状態が不正です");
  }
  for (const r of Object.values<any>(raw.routes)) if (!isRec(r) || !Array.isArray(r.edges) || !["national", "ken", "fu", "jnr", "priv"].includes(r.grade) || !Number.isInteger(r.number)) return no("路線が不正です");
  for (const p of Object.values<any>(raw.projects)) if (!isRec(p) || !Array.isArray(p.edgeIds) || !Array.isArray(p.chain) || !fin(p.costBu)) return no("建設計画が不正です");
  // v1 -> v2: fill the fields added by the road-evolution rework with neutral defaults (the network itself is kept as saved)
  for (const e of Object.values<any>(raw.edges)) {
    e.standard = ["rural", "standard", "highgrade"].includes(e.standard) ? e.standard : "rural"; e.state = ["open", "dormant", "closed", "lost"].includes(e.state) ? e.state : e.lost ? "lost" : e.open ? "open" : "closed";
    for (const f of ["through", "local", "peakThrough", "zeroYears", "reviveYears", "congYears", "throughDropYears"]) if (!fin(e[f])) e[f] = 0;
    if (e.maglev !== undefined && e.maglev !== true) delete e.maglev;
    if (!fin(e.freight)) e.freight = 0; if (e.mode !== "rail") delete e.mode; if (e.op !== undefined && typeof e.op !== "string") delete e.op;
    if (typeof e.nick !== "boolean") e.nick = false; if (typeof e.region !== "string") e.region = ""; if (!Array.isArray(e.hist)) e.hist = []; if (!Array.isArray(e.bypassOf)) e.bypassOf = []; if (!Array.isArray(e.bypassedBy)) e.bypassedBy = [];
  }
  for (const r of Object.values<any>(raw.routes)) { if (!Array.isArray(r.oldEdges)) r.oldEdges = []; if (typeof r.nick !== "boolean") r.nick = false; if (r.mode !== "rail") { delete r.mode; r.name = `${{ national: "国道", ken: "県道", fu: "府道" }[r.grade as "national"]}${r.number}号`; } else if (typeof r.name !== "string") r.name = `${r.opName ?? "鉄道"}${r.number}号線`; }
  for (const p of Object.values<any>(raw.projects)) { if (typeof p.region !== "string") p.region = ""; if (!Array.isArray(p.replaces)) p.replaces = []; if (typeof p.kind !== "string") p.kind = "new"; }
  for (const n of Object.values<any>(raw.nodes)) void n;
  if (!isRec(raw.settlements)) raw.settlements = {}; if (!Array.isArray(raw.links)) raw.links = []; if (!Array.isArray(raw.snaps)) raw.snaps = []; if (!isRec(raw.regionShare)) raw.regionShare = {}; if (raw.regionSlack !== undefined && !isRec(raw.regionSlack)) delete raw.regionSlack;
  if (!isRec(raw.operators)) raw.operators = { jnr: { id: "jnr", name: "国鉄", kind: "jnr", since: 1950, note: "国有の鉄道" } };
  if (!Array.isArray(raw.mods)) raw.mods = [];
  raw.era = typeof raw.era === "string" ? raw.era : "kobun";
  if (!isRec(raw.dials)) raw.dials = composeDials({ era: raw.era, mods: raw.mods }, monthYear(raw));
  raw.mods = (raw.mods as unknown[]).filter((m: any) => isRec(m) && typeof m.id === "string" && fin(m.from) && fin(m.until) && isRec(m.d) && Object.values(m.d).every(fin));
  if (!DIAL_KEYS.every((k) => fin(raw.dials[k]))) raw.dials = composeDials({ era: raw.era, mods: raw.mods }, monthYear(raw));
  if (raw.stage3 === true && !(isRec(raw.policy) && fin(raw.policy.points) && Array.isArray(raw.policy.history) && ["priority", "idleAuto", "auto"].includes(raw.policy.mode) && (raw.policy.pending === null || (isRec(raw.policy.pending) && Number.isInteger(raw.policy.pending.year))))) raw.policy = defaultPolicy(); if (raw.stage3 !== true) { delete raw.stage3; delete raw.policy; }
  if (raw.tech !== undefined && !(isRec(raw.tech) && fin(raw.tech.k) && raw.tech.k >= 1 && raw.tech.k <= 4)) delete raw.tech;
  if (isRec(raw.tech) && raw.tech.wk !== undefined && !(fin(raw.tech.wk) && raw.tech.wk >= 1 && raw.tech.wk <= 6)) delete raw.tech.wk;   // Stage 13
  // Issue #13: the era timeline is kept only if it is well formed; otherwise the game simply continues as a single-era game (never refused)
  if (raw.kaigen !== undefined) {
    const k = raw.kaigen, okE = (e: any) => isRec(e) && typeof e.name === "string" && e.name.length > 0 && e.name.length < 12 && Number.isInteger(e.start) && STANCES.includes(e.stance);
    if (!(isRec(k) && Array.isArray(k.eras) && k.eras.length >= 1 && k.eras.length < 400 && k.eras.every(okE) && Number.isInteger(k.next) && Number.isInteger(k.nextIdx) && (k.pending === null || (isRec(k.pending) && Number.isInteger(k.pending.year) && Array.isArray(k.pending.cands) && k.pending.cands.length > 0 && k.pending.cands.every((c: any) => isRec(c) && typeof c.name === "string" && STANCES.includes(c.stance)))))) delete raw.kaigen;
  }
  // Stage 10: the role assignment is kept only if well formed (a damaged one is dropped: the game then reads the real 1950 sizes, never refused)
  if (raw.roles !== undefined) { const r = raw.roles, str = (x: any) => typeof x === "string" && x.length < 12; if (!(isRec(r) && isRec(r.prof) && Object.entries(r.prof).every(([k, v]) => str(k) && str(v)) && Array.isArray(r.capMetro) && r.capMetro.every(str) && Array.isArray(r.subMetro) && r.subMetro.every(str) && str(r.culture))) delete raw.roles; }
  // Stage 12: the per-city economy record is kept only if well formed (a damaged one is dropped; the next year rebuilds it)
  if (raw.city12 !== undefined && !(isRec(raw.city12) && Object.values<any>(raw.city12).every((c) => isRec(c) && Array.isArray(c.p) && c.p.length <= 12 && c.p.every(fin) && Array.isArray(c.h) && c.h.length < 60 && c.h.every(fin) && fin(c.adv)))) delete raw.city12;
  if (raw.metro !== undefined && !validMetro(raw.metro)) delete raw.metro;   // Stage 13: rebuilt at the next yearly step
  if (raw.econ !== undefined && raw.econ !== true) delete raw.econ;
  if (raw.seats14 !== undefined && raw.seats14 !== true) delete raw.seats14;   // Stage 14
  if (raw.pop15 !== undefined && raw.pop15 !== true) delete raw.pop15;   // Stage 15
  if (raw.isl20 !== undefined && raw.isl20 !== true) delete raw.isl20;   // Stage 20
  if (raw.sea22 !== undefined && raw.sea22 !== true) delete raw.sea22;   // Stage 22
  if (raw.numreg !== undefined && !(isRec(raw.numreg) && isRec(raw.numreg.next) && isRec(raw.numreg.list) && ["road", "hwy", "rail", "hsr", "sea", "air"].every((k) => Array.isArray(raw.numreg.list[k]) && Number.isInteger(raw.numreg.next[k])))) delete raw.numreg;   // Stage 23: a register that is not whole is started again (estimated)
  if (raw.tier23 !== undefined && !(isRec(raw.tier23) && isRec(raw.tier23.zones) && isRec(raw.tier23.hist) && isRec(raw.tier23.cnt))) delete raw.tier23;   // Stage 23
  if (raw.isl22 !== undefined && raw.isl22 !== true) delete raw.isl22;
  { const okEv = (e: any) => isRec(e) && Number.isInteger(e.year) && ["pending", "road0", "done"].includes(e.state);   // Stage 25: the earlier relocation events must be whole, each one done
    if (raw.e2200hist !== undefined && !(Array.isArray(raw.e2200hist) && raw.e2200hist.length < 60 && raw.e2200hist.every((e: any) => okEv(e) && e.state === "done"))) delete raw.e2200hist;
    if (isRec(raw.kaigen) && raw.kaigen.reloc !== undefined) { const g = raw.kaigen.reloc, okC = (c: any) => isRec(c) && typeof c.name === "string" && c.name.length > 0 && c.name.length < 12 && typeof c.real === "boolean" && ["inherit", "history", "fiction"].includes(c.origin);
      if (!(Array.isArray(g) && g.length < 60 && g.every((x: any) => x === null || (isRec(x) && Number.isInteger(x.n) && Number.isInteger(x.year) && Array.isArray(x.cands) && x.cands.length > 0 && x.cands.length < 40 && x.cands.every(okC))))) delete raw.kaigen.reloc; } }
  if (raw.e2200 !== undefined && !(isRec(raw.e2200) && Number.isInteger(raw.e2200.year) && ["pending", "road0", "done"].includes(raw.e2200.state))) delete raw.e2200;   // Stage 22
  if (raw.moves20 !== undefined && !(Array.isArray(raw.moves20) && raw.moves20.length > 0 && raw.moves20.length <= 150 && raw.moves20.every((m: any) => isRec(m) && typeof m.pref === "string" && m.pref.length < 12 && ["capital", "sub", "palace"].includes(m.by) && (m.since === undefined || Number.isInteger(m.since)) && Array.isArray(m.pos) && m.pos.length === 2 && m.pos.every((x: unknown) => typeof x === "number" && Number.isFinite(x) && Math.abs(x as number) < 5000)))) delete raw.moves20;
  if (raw.towns16 !== undefined && !(Array.isArray(raw.towns16) && raw.towns16.length > 0 && raw.towns16.length < 400 && raw.towns16.every((x: unknown) => typeof x === "string" && x.length < 24))) delete raw.towns16;   // Stage 16
  for (const k of ["capitalPos", "subPos"]) if (raw[k] !== undefined && !(Array.isArray(raw[k]) && raw[k].length === 2 && raw[k].every((x: unknown) => typeof x === "number" && Number.isFinite(x) && Math.abs(x as number) < 5000))) delete raw[k];   // Stage 19
  if (raw.pot17 !== undefined) { const q = raw.pot17, ok = q && typeof q === "object" && Array.isArray(q.order) && q.order.length === 49 && q.order.every((x: unknown) => typeof x === "string") && q.cur && typeof q.cur === "object" && Array.isArray(q.hist) && q.shown && typeof q.shown === "object"; if (!ok) delete raw.pot17; else { for (const k of Object.keys(q.cur)) if (!Number.isFinite(q.cur[k])) q.cur[k] = 1; } }   // Stage 17
  if (isRec(raw.kaigen) && raw.kaigen.recon !== undefined && !(isRec(raw.kaigen.recon) && ["pacific", "japansea", "neutral"].includes(raw.kaigen.recon.coast) && (raw.kaigen.recon.since === undefined || Number.isInteger(raw.kaigen.recon.since)) && ["concentrate", "disperse"].includes(raw.kaigen.recon.focus))) delete raw.kaigen.recon;
  // Stage 8: a lake bridge keeps only its two shore cells (an early Stage 8 build stored the water cells too, which the land check would refuse)
  for (const e of Object.values<any>(raw.edges)) if (e.facility === "bridge" && typeof e.facilityName === "string" && e.facilityName.includes("湖上大橋") && e.cells.length > 2) e.cells = [e.cells[0], e.cells[e.cells.length - 1]];
  // Stage 8: ports, airports and routes are kept only if well formed; otherwise they are rebuilt from the cities at the next yearly step (never refused)
  if (raw.hubs !== undefined) {
    const h = raw.hubs, fac = (x: any) => isRec(x) && typeof x.city === "string" && fin(x.since) && Array.isArray(x.hist) && ["cargo", "pax", "load", "hi", "lo"].every((f) => fin(x[f]));
    const ok = isRec(h) && isRec(h.ports) && isRec(h.airports) && Array.isArray(h.routes) && Number.isInteger(h.seq)
      && Object.values<any>(h.ports).every((p) => fac(p) && Number.isInteger(p.tier) && p.tier >= 1 && p.tier <= 4)
      && Object.values<any>(h.airports).every((a) => fac(a) && ["regional", "hub"].includes(a.kind) && fin(a.cap) && a.cap > 0 && fin(a.runwayM) && Number.isInteger(a.site) && Array.isArray(a.access) && fin(a.intl))
      && h.routes.every((r: any) => isRec(r) && typeof r.id === "string" && ["sea", "air"].includes(r.mode) && typeof r.a === "string" && typeof r.b === "string" && ["open", "suspended", "closed"].includes(r.state) && fin(r.since) && fin(r.vol) && fin(r.lo));
    if (!ok) delete raw.hubs;
  }
  raw.schemaVersion = 3;
  const sim = { ...raw, events: Array.isArray(raw.events) ? raw.events : [], stats: Array.isArray(raw.stats) ? raw.stats : [], skippedMonths: fin(raw.skippedMonths) ? raw.skippedMonths : 0, lastWallMs: fin(raw.lastWallMs) ? raw.lastWallMs : 0, speed: raw.speed === 50 ? 20 : [0, 1, 5, 20].includes(raw.speed) ? raw.speed : 0,   /* Stage 25: ×50 was withdrawn; an old save that had it runs at ×20 */ ceremonyDone: raw.ceremonyDone === true } as unknown as SimState;
  const bad = checkIntegrity(sim); if (bad.length) return no(`道路網の整合性エラー: ${bad[0]}`);
  return { sim, problems: [] };
}
/** After the world exists: every cell must be real land on this map. */
export function validateSimAgainstWorld(sim: SimState, w: World, terrainHash: string): string | null {
  if (sim.terrainHash !== terrainHash) return "地形が保存時と一致しません(地形ハッシュ不一致)";
  for (const e of Object.values(sim.edges)) for (const c of e.cells) if (c >= w.N || w.t.land[c] !== 1) return `道路が地形の外にあります(${e.id})`;
  for (const n of Object.values(sim.nodes)) if (n.cell >= w.N) return "ノードが地形の外にあります";
  if ((sim.towns16 ?? []).join(",") !== (w.townIds ?? []).join(",")) return "都市データの種類(町の有無)が保存時と一致しません";   // Stage 16
  if (JSON.stringify(sim.moves20 ?? null) !== JSON.stringify(w.moveSpec ?? null)) return "県庁所在地の移転が保存時と一致しません";   // Stage 20
  if ((sim.isl22 ? 2 : sim.isl20 ? 1 : 0) !== (w.islets ? w.t.isletVersion ?? 1 : 0)) return "島のデータの版(Stage 20の楕円か実際の輪郭か)が保存時と一致しません";   // Stage 22
  if (!!sim.isl20 !== !!w.islets) return "島のデータの種類(離島の有無)が保存時と一致しません";   // Stage 20
  return null;
}
export interface ParsedSave { map: ProjectState; sim: SimState | null; quarantine: unknown | null; problems: string[]; ok: boolean; migratedFrom: 1 | 2 | null }
export function parseSave(input: unknown): ParsedSave {
  let raw: any = input; const problems: string[] = [];
  if (typeof input === "string") { try { raw = JSON.parse(input); } catch { const d = parseState(null); return { map: d.state, sim: null, quarantine: null, problems: ["JSONとして読めません"], ok: false, migratedFrom: null }; } }
  if (isRec(raw) && raw.schemaVersion >= 2 && isRec(raw.map)) {
    const m = parseState(raw.map); problems.push(...m.problems);
    if (raw.schemaVersion > SAVE_VERSION) problems.push(`新しいバージョン(v${raw.schemaVersion})のデータです。読める範囲だけ読み込みます`);
    if (raw.sim == null) return { map: m.state, sim: null, quarantine: null, problems, ok: m.ok, migratedFrom: 2 };
    const s = sanitizeSim(raw.sim);
    if (!s.sim) return { map: m.state, sim: null, quarantine: raw.sim, problems: [...problems, ...s.problems, "道路データは読み込まず退避しました"], ok: m.ok, migratedFrom: 2 };
    const h = mapStateHash(m.state);
    if (!m.state.finalized || s.sim.mapHash !== h || (typeof raw.mapHash === "string" && raw.mapHash !== h)) return { map: m.state, sim: null, quarantine: raw.sim, problems: [...problems, "地図が道路データの保存時と一致しないため、道路は読み込まず退避しました"], ok: m.ok, migratedFrom: 2 };
    return { map: m.state, sim: s.sim, quarantine: null, problems, ok: m.ok, migratedFrom: 2 };
  }
  const m = parseState(raw);   // v1: the map alone (possibly wrapped by the v1 exporter)
  return { map: m.state, sim: null, quarantine: null, problems: m.problems, ok: m.ok, migratedFrom: m.ok ? 1 : null };
}
export function exportGame(save: GameSave, extra?: Record<string, unknown>): string { return JSON.stringify({ ...save, savedAt: Date.now(), ...extra }, null, 1); }

// ---- IndexedDB (best effort) ----
const DB = "kfm-stage1", STORE = "saves";
function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => { if (typeof indexedDB === "undefined") return rej(new Error("no indexedDB")); const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => { const q = f(db.transaction(STORE, mode).objectStore(STORE)); q.onsuccess = () => { res(q.result); db.close(); }; q.onerror = () => { rej(q.error); db.close(); }; });
}
export async function putRaw(key: string, value: unknown): Promise<boolean> { try { await tx("readwrite", (s) => s.put(JSON.stringify(value), key)); return true; } catch { return false; } }
export async function getRaw(key: string): Promise<string | undefined> { try { return await tx<string | undefined>("readonly", (s) => s.get(key) as IDBRequest<string | undefined>); } catch { return undefined; } }
/** Stage 23: what a slot shows -- the capital and sub-capital IN THAT SAVE and the year it was saved in (never the game now being played). */
export interface SlotMeta { capital: string; sub: string; year: number | null; savedAt: number }
export function slotMetaOf(save: GameSave): SlotMeta { const st = seatsOf(save.map); return { capital: prefName(save.sim?.e2200 && save.sim.capital ? save.sim.capital : st.capital), sub: prefName(save.sim?.e2200 && save.sim.subCapital ? save.sim.subCapital : st.sub), year: save.sim ? monthYear(save.sim) : null, savedAt: save.savedAt }; }
export async function saveGame(name: string, save: GameSave): Promise<boolean> { const ok = await putRaw(name, { savedAt: save.savedAt, save }); if (ok) await putRaw(name + ":meta", slotMetaOf(save)); return ok; }
/** A slot's label: its own small record, or (a slot saved before this existed) read once from the save and written for next time. null = empty. */
export async function slotMeta(name: string): Promise<SlotMeta | null> {
  const m = await getRaw(name + ":meta"); if (m) { try { const j = JSON.parse(m); if (j && typeof j.capital === "string") return j as SlotMeta; } catch { /* fall through and read the save */ } }
  const l = await loadGame(name); if (!l) return null;
  const meta: SlotMeta = { ...(() => { const st = seatsOf(l.map); return { capital: prefName(l.sim?.e2200 && l.sim.capital ? l.sim.capital : st.capital), sub: prefName(l.sim?.e2200 && l.sim.subCapital ? l.sim.subCapital : st.sub), year: l.sim ? monthYear(l.sim) : null }; })(), savedAt: l.savedAt }; await putRaw(name + ":meta", meta); return meta;
}
export interface LoadedGame extends ParsedSave { savedAt: number }
/** Reads v2 slots and legacy v1 slots ({savedAt,state}); a v1 slot is migrated in memory and rewritten as v2 on the next save. */
export async function loadGame(name: string): Promise<LoadedGame | null> {
  try {
    const v = await tx<string | undefined>("readonly", (s) => s.get(name) as IDBRequest<string | undefined>); if (!v) return null;
    const j = JSON.parse(v), p = parseSave(j.save ?? j.state ?? j); return p.ok ? { ...p, savedAt: j.savedAt ?? 0 } : null;
  } catch { return null; }
}
export async function listSlots(): Promise<string[]> { try { return (await tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys())).map(String); } catch { return []; } }
