/**
 * Stage 41 #8: SPECIAL ROUTES (特殊路線). Thirteen symbols, given in the ORDER THEY ARE BUILT, never by the calendar:
 *   1号(イチ) 0号(ゼロ) A号(エー) 元号(ゲン) 始号(シ) ㄅ号(ボ) ᚠ号(フェ) Ⰰ号(アズ) ꀀ号(イ) ᚛号(ベイ) 𓃀号(ベー) ⌘号(コマ) ꙮ号(オク)
 * 国道1号 and 国道0号 are the first two (their labels stay 国道1号 / 国道0号); the rest are new. Optional: a relocation that is skipped builds nothing and the same symbol waits for the next one. A special route can only be started when the previous one
 * is COMPLETE (in service, every section built). A special route is told apart from the numbered routes by its own field (`special`, with `gen` the year it was made, which keeps it out of the number register) and its own key in the integrity check --
 * never by a number. A line must be drawable in ONE STROKE (connected, with 0 or 2 places where an odd number of its sections meet: a loop is fine, a stray branch is not), and must pass the capital (or the palace, near it) and the sub-capital.
 * An existing special route can be EXTENDED: the new sections must join it and the whole must stay one stroke.
 * Display: the symbol is text, and a phone font may have no glyph for it (ᚠ Ⰰ ꀀ ᚛ 𓃀 ꙮ ...). `setGlyphCheck` lets the app say which symbols it can draw; any it cannot are shown by their katakana reading instead of an empty box -- the meaning, the key and the saved data never depend on a font.
 * Only games made with the flag (`sim.special41`) use this; a game saved before keeps the old rule (every relocation makes another dated 国道0号).
 */
import { modeOf, type SimEdge, type SimRoute, type SimState } from "./types";
import type { Vec } from "../core/types";
import type { World } from "./world";
import { homeCity, subCity } from "./ceremony";

export interface SpecialDef { sym: string; reading: string }
export const SPECIALS: readonly SpecialDef[] = [
  { sym: "1", reading: "イチ" }, { sym: "0", reading: "ゼロ" }, { sym: "A", reading: "エー" }, { sym: "元", reading: "ゲン" }, { sym: "始", reading: "シ" }, { sym: "ㄅ", reading: "ボ" }, { sym: "ᚠ", reading: "フェ" },
  { sym: "Ⰰ", reading: "アズ" }, { sym: "ꀀ", reading: "イ" }, { sym: "᚛", reading: "ベイ" }, { sym: "𓃀", reading: "ベー" }, { sym: "⌘", reading: "コマ" }, { sym: "ꙮ", reading: "オク" },
];
export const SPECIAL_SYMS = SPECIALS.map((s) => s.sym);
export const isSpecialSym = (s: unknown): s is string => typeof s === "string" && SPECIAL_SYMS.includes(s);
/** Which symbols the display can draw; the default (tests, tools) says all. The app installs a real check at start. */
let glyphOk: (sym: string) => boolean = () => true;
export const setGlyphCheck = (f: ((sym: string) => boolean) | null) => { glyphOk = f ?? (() => true); };
export const readingOf = (sym: string) => SPECIALS.find((s) => s.sym === sym)?.reading ?? "";
/** What is shown for a symbol: the symbol itself, or its reading when the phone cannot draw it. */
export const shownSymbol = (sym: string) => (glyphOk(sym) ? sym : readingOf(sym) || sym);
export const specialOfficial = (sym: string) => `${shownSymbol(sym)}号`;
/** The detailed name: symbol, reading and 号 -- e.g. 「ᚠ号(フェ)」. */
export const specialFullName = (sym: string) => `${sym === "1" || sym === "0" ? `国道${sym}` : sym}号(${readingOf(sym)})`;

/** The route that carries a symbol, if one was ever made (an abolished one still holds it: a symbol is not reused). */
export function specialRoutes(sim: SimState): Record<string, SimRoute> {
  const out: Record<string, SimRoute> = {};
  for (const r of Object.values(sim.routes)) {
    if (r.id.startsWith("r.__")) continue;
    if (r.special && isSpecialSym(r.special)) { out[r.special] = r; continue; }
    if (r.grade === "national" && r.scope === "JP" && !r.gen && (r.number === 1 || r.number === 0)) { const k = String(r.number); if (!out[k]) out[k] = r; }
  }
  return out;
}
export const nextSpecial = (sim: SimState): string | null => { const have = specialRoutes(sim); return SPECIAL_SYMS.find((s) => !have[s]) ?? null; };
/** In service and every section built and open. */
export function routeComplete(sim: SimState, r: SimRoute): boolean {
  if (!r.active) return false; if (!r.edges.length) return false;
  return r.edges.every((ref) => { const e = sim.edges[ref.edgeId]; return !!e && e.state === "open" && e.open && !e.lost && e.built >= 1; });
}
export interface Gate { ok: boolean; sym: string | null; reason: string }
/** May the next special route be made now? (The first symbol needs nothing before it; every later one needs the previous to be complete.) */
export function canBuildNext(sim: SimState): Gate {
  const sym = nextSpecial(sim); if (!sym) return { ok: false, sym: null, reason: "13本の特殊路線はすべて作られています" };
  const i = SPECIAL_SYMS.indexOf(sym); if (i === 0) return { ok: true, sym, reason: "" };
  const prev = specialRoutes(sim)[SPECIAL_SYMS[i - 1]]; if (!prev) return { ok: false, sym, reason: `前の特殊路線(${specialFullName(SPECIAL_SYMS[i - 1])})がまだありません` };
  if (!routeComplete(sim, prev)) return { ok: false, sym, reason: `前の特殊路線(${specialFullName(SPECIAL_SYMS[i - 1])})が完成していません(供用中で全区間が開通していることが条件です)` };
  return { ok: true, sym, reason: "" };
}

export interface StrokeResult { ok: boolean; reason: string; odd: number; components: number }
/** One-stroke check over the whole line: the sections as a graph (a place where two sections meet is one vertex, however many times the line passes it) must be connected and have 0 (a loop) or 2 vertices of odd degree. */
export function strokeCheck(edges: { a: string; b: string }[]): StrokeResult {
  if (!edges.length) return { ok: false, reason: "区間がありません", odd: 0, components: 0 };
  const deg = new Map<string, number>(), adj = new Map<string, string[]>();
  for (const e of edges) { for (const [x, y] of [[e.a, e.b], [e.b, e.a]] as const) { deg.set(x, (deg.get(x) ?? 0) + (x === y ? 0 : 1)); (adj.get(x) ?? adj.set(x, []).get(x)!).push(y); } if (e.a === e.b) deg.set(e.a, (deg.get(e.a) ?? 0) + 2); }
  const seen = new Set<string>(); let components = 0;
  for (const v of adj.keys()) { if (seen.has(v)) continue; components++; const st = [v]; seen.add(v); while (st.length) { const x = st.pop()!; for (const y of adj.get(x) ?? []) if (!seen.has(y)) { seen.add(y); st.push(y); } } }
  let odd = 0; for (const d of deg.values()) if (d % 2) odd++;
  if (components > 1) return { ok: false, reason: `つながっていない部分が${components}つあります`, odd, components };
  if (odd !== 0 && odd !== 2) return { ok: false, reason: `一筆書きにできません(枝分かれ・行き止まりが${odd}か所あり、端は2か所までです)`, odd, components };
  return { ok: true, reason: "", odd, components };
}
/** The route as it stands, as a graph. */
export const routeStroke = (sim: SimState, r: SimRoute) => strokeCheck(r.edges.map((ref) => sim.edges[ref.edgeId]).filter((e): e is SimEdge => !!e));

/** Does a line (the cells it runs over) pass the capital -- or the palace, when it runs near it -- and the sub-capital? Both are needed. */
export const SEAT_NEAR_KM = 20;
export interface SeatPass { capital: boolean; sub: boolean; palace: boolean; ok: boolean; reason: string }
export function seatsPass(sim: SimState, w: World, cells: Iterable<number>): SeatPass {
  const home = homeCity(w, sim.capital), sub = subCity(w, sim.subCapital), pal: Vec | undefined = sim.palace?.pos; const ps: Vec[] = []; for (const k of cells) ps.push(w.cellPos(k));
  const near = (p: Vec | undefined) => !!p && ps.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) <= SEAT_NEAR_KM);
  const palace = near(pal), capital = near(home?.pos) || palace, subOk = near(sub?.pos);
  const ok = capital && subOk; return { capital, sub: subOk, palace, ok, reason: ok ? "" : `${!capital ? "首都(または皇居の近く)" : ""}${!capital && !subOk ? "と" : ""}${!subOk ? "副首都" : ""}を通っていません` };
}
/** The cells of a route's sections (for seatsPass). */
export const routeCells = (sim: SimState, r: SimRoute): number[] => r.edges.flatMap((ref) => sim.edges[ref.edgeId]?.cells ?? []);

export interface ExtendResult { ok: boolean; reason: string }
/** May these new sections extend the special route `sym`? They must join it and the whole must stay one stroke (a loop closing is allowed; an unrelated branch is not). */
export function canExtend(sim: SimState, sym: string, newEdgeIds: string[]): ExtendResult {
  const r = specialRoutes(sim)[sym]; if (!r) return { ok: false, reason: "その特殊路線はまだありません" }; if (!r.active) return { ok: false, reason: "廃止された路線は延長できません" };
  const add = newEdgeIds.map((id) => sim.edges[id]).filter((e): e is SimEdge => !!e); if (!add.length || add.length !== newEdgeIds.length) return { ok: false, reason: "延長する区間がありません" };
  const have = new Set(r.edges.map((x) => x.edgeId)); if (add.some((e) => have.has(e.id))) return { ok: false, reason: "すでに路線に含まれる区間があります" };
  const old = r.edges.map((x) => sim.edges[x.edgeId]).filter((e): e is SimEdge => !!e), nodes = new Set(old.flatMap((e) => [e.a, e.b]));
  if (!add.some((e) => nodes.has(e.a) || nodes.has(e.b))) return { ok: false, reason: "路線につながっていません" };
  const s = strokeCheck([...old, ...add]); return s.ok ? { ok: true, reason: "" } : { ok: false, reason: s.reason };
}
/** Add the sections to the route (the number/symbol stays). Returns false and changes nothing when canExtend refuses. Sections are chained in route order only as far as the graph allows: the route keeps its list, new ones are appended with their direction as stored. */
export function extendSpecial(sim: SimState, sym: string, newEdgeIds: string[], month = sim.month): ExtendResult {
  const c = canExtend(sim, sym, newEdgeIds); if (!c.ok) return c; const r = specialRoutes(sim)[sym]!;
  for (const id of newEdgeIds) r.edges.push({ edgeId: id, dir: 1 }); r.history.push({ month, grade: r.grade, number: r.number, text: `${specialFullName(sym)}を${newEdgeIds.length}区間延長`, scope: r.scope });
  return { ok: true, reason: "" };
}
