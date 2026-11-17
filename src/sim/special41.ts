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
import { type SimEdge, type SimRoute, type SimState } from "./types";
import type { Vec } from "../core/types";
import type { World } from "./world";
import { homeCity, subCity } from "./ceremony";

export interface SpecialDef { sym: string; reading: string; /** the year this symbol stands at in the owner's list (its place in the order; only the six FIXED years bind a symbol to a year) */ year?: number; cp?: number }
/** The first list (Stage 41, 13 symbols): games made by the build published on 2026-11-17 keep it (`special41` without `special60`). */
export const SPECIALS13: readonly SpecialDef[] = [
  { sym: "1", reading: "イチ" }, { sym: "0", reading: "ゼロ" }, { sym: "A", reading: "エー" }, { sym: "元", reading: "ゲン" }, { sym: "始", reading: "シ" }, { sym: "ㄅ", reading: "ボ" }, { sym: "ᚠ", reading: "フェ" },
  { sym: "Ⰰ", reading: "アズ" }, { sym: "ꀀ", reading: "イ" }, { sym: "᚛", reading: "ベイ" }, { sym: "𓃀", reading: "ベー" }, { sym: "⌘", reading: "コマ" }, { sym: "ꙮ", reading: "オク" },
];
/** Issue #87: the sixty symbols, 1800-7700, by code point (the characters are made from the numbers, so an editor or a font can never change which character a route carries). 3300 reads ハート and 7600 is U+221E, as the owner corrected. */
export const SPECIALS60: readonly SpecialDef[] = [
  { year: 1800, cp: 0x0031, sym: String.fromCodePoint(0x0031), reading: "イチ" },
  { year: 1900, cp: 0x0030, sym: String.fromCodePoint(0x0030), reading: "ゼロ" },
  { year: 2000, cp: 0x0041, sym: String.fromCodePoint(0x0041), reading: "エー" },
  { year: 2100, cp: 0x963F, sym: String.fromCodePoint(0x963F), reading: "ア" },
  { year: 2200, cp: 0x2668, sym: String.fromCodePoint(0x2668), reading: "ユ" },
  { year: 2300, cp: 0x2200, sym: String.fromCodePoint(0x2200), reading: "オール" },
  { year: 2400, cp: 0x5143, sym: String.fromCodePoint(0x5143), reading: "ゲン" },
  { year: 2500, cp: 0x1D11E, sym: String.fromCodePoint(0x1D11E), reading: "トオン" },
  { year: 2600, cp: 0x16A0, sym: String.fromCodePoint(0x16A0), reading: "フェ" },
  { year: 2700, cp: 0x2318, sym: String.fromCodePoint(0x2318), reading: "コマ" },
  { year: 2800, cp: 0x592A, sym: String.fromCodePoint(0x592A), reading: "タイ" },
  { year: 2900, cp: 0x10380, sym: String.fromCodePoint(0x10380), reading: "ウガ" },
  { year: 3000, cp: 0x00A7, sym: String.fromCodePoint(0x00A7), reading: "セク" },
  { year: 3100, cp: 0xA000, sym: String.fromCodePoint(0xA000), reading: "イ" },
  { year: 3200, cp: 0x1F702, sym: String.fromCodePoint(0x1F702), reading: "エン" },
  { year: 3300, cp: 0x2665, sym: String.fromCodePoint(0x2665), reading: "ハート" },
  { year: 3400, cp: 0x2325, sym: String.fromCodePoint(0x2325), reading: "オプ" },
  { year: 3500, cp: 0x3090, sym: String.fromCodePoint(0x3090), reading: "ヰ" },
  { year: 3600, cp: 0x2202, sym: String.fromCodePoint(0x2202), reading: "デル" },
  { year: 3700, cp: 0x2C00, sym: String.fromCodePoint(0x2C00), reading: "アズ" },
  { year: 3800, cp: 0x1D122, sym: String.fromCodePoint(0x1D122), reading: "ヘオン" },
  { year: 3900, cp: 0x203B, sym: String.fromCodePoint(0x203B), reading: "コメ" },
  { year: 4000, cp: 0x0531, sym: String.fromCodePoint(0x0531), reading: "アイ" },
  { year: 4100, cp: 0xABC0, sym: String.fromCodePoint(0xABC0), reading: "コク" },
  { year: 4200, cp: 0x10A71, sym: String.fromCodePoint(0x10A71), reading: "サバ" },
  { year: 4300, cp: 0x00B6, sym: String.fromCodePoint(0x00B6), reading: "ピル" },
  { year: 4400, cp: 0xA9C5, sym: String.fromCodePoint(0xA9C5), reading: "ジャワ" },
  { year: 4500, cp: 0x263F, sym: String.fromCodePoint(0x263F), reading: "メル" },
  { year: 4600, cp: 0x5700, sym: String.fromCodePoint(0x5700), reading: "クニ" },
  { year: 4700, cp: 0x2660, sym: String.fromCodePoint(0x2660), reading: "スペ" },
  { year: 4800, cp: 0x2203, sym: String.fromCodePoint(0x2203), reading: "イグ" },
  { year: 4900, cp: 0x11005, sym: String.fromCodePoint(0x11005), reading: "ブラ" },
  { year: 5000, cp: 0x269B, sym: String.fromCodePoint(0x269B), reading: "アトム" },
  { year: 5100, cp: 0x10D0, sym: String.fromCodePoint(0x10D0), reading: "アニ" },
  { year: 5200, cp: 0x20BF, sym: String.fromCodePoint(0x20BF), reading: "ビット" },
  { year: 5300, cp: 0x10280, sym: String.fromCodePoint(0x10280), reading: "リュク" },
  { year: 5400, cp: 0x21A04, sym: String.fromCodePoint(0x21A04), reading: "ナン" },
  { year: 5500, cp: 0x232C, sym: String.fromCodePoint(0x232C), reading: "ベン" },
  { year: 5600, cp: 0x13A1, sym: String.fromCodePoint(0x13A1), reading: "レ" },
  { year: 5700, cp: 0x26E9, sym: String.fromCodePoint(0x26E9), reading: "トリ" },
  { year: 5800, cp: 0x10900, sym: String.fromCodePoint(0x10900), reading: "アルパ" },
  { year: 5900, cp: 0x263E, sym: String.fromCodePoint(0x263E), reading: "ゲツ" },
  { year: 6000, cp: 0x9741, sym: String.fromCodePoint(0x9741), reading: "ライ" },
  { year: 6100, cp: 0x0905, sym: String.fromCodePoint(0x0905), reading: "ヒン" },
  { year: 6200, cp: 0x1700, sym: String.fromCodePoint(0x1700), reading: "バイ" },
  { year: 6300, cp: 0x10000, sym: String.fromCodePoint(0x10000), reading: "ミケ" },
  { year: 6400, cp: 0xA800, sym: String.fromCodePoint(0xA800), reading: "シロ" },
  { year: 6500, cp: 0x1B001, sym: String.fromCodePoint(0x1B001), reading: "イェ" },
  { year: 6600, cp: 0x130C0, sym: String.fromCodePoint(0x130C0), reading: "ベー" },
  { year: 6700, cp: 0x2756, sym: String.fromCodePoint(0x2756), reading: "ヤツ" },
  { year: 6800, cp: 0x0294, sym: String.fromCodePoint(0x0294), reading: "グロ" },
  { year: 6900, cp: 0x17F07, sym: String.fromCodePoint(0x17F07), reading: "セイ" },
  { year: 7000, cp: 0x260A, sym: String.fromCodePoint(0x260A), reading: "ノード" },
  { year: 7100, cp: 0x169B, sym: String.fromCodePoint(0x169B), reading: "オガ" },
  { year: 7200, cp: 0x309F, sym: String.fromCodePoint(0x309F), reading: "ヨリ" },
  { year: 7300, cp: 0x521D, sym: String.fromCodePoint(0x521D), reading: "ショ" },
  { year: 7400, cp: 0x3091, sym: String.fromCodePoint(0x3091), reading: "ヱ" },
  { year: 7500, cp: 0xAC00, sym: String.fromCodePoint(0xAC00), reading: "カ" },
  { year: 7600, cp: 0x221E, sym: String.fromCodePoint(0x221E), reading: "ムゲン" },
  { year: 7700, cp: 0xA66E, sym: String.fromCodePoint(0xA66E), reading: "オク" },
];
/** Issue #87: the six years whose symbol is FIXED to that year's building opportunity. In such a year the fixed symbol is what is built; the ordinary symbols not yet used are not lost (they go on from the next ordinary opportunity). A fixed symbol whose year was
 *  passed without building is not carried to another year (it is that year's opportunity) -- decided here because the owner left this detail to the implementation; no route is ever removed by it. */
export const FIXED_YEARS: Readonly<Record<number, string>> = Object.freeze(Object.fromEntries(SPECIALS60.filter((d) => [2200, 3300, 4400, 5500, 6600, 7700].includes(d.year!)).map((d) => [d.year!, d.sym])));
const FIXED_SYMS = new Set(Object.values(FIXED_YEARS));
/** For a later feature (not built: the owner has not decided it): years whose first two digits repeat (2200, 3300 ...) and years of four equal digits (2222, 3333 ...). */
export const isDoubleCenturyYear = (y: number) => y >= 1100 && y % 100 === 0 && Math.floor(y / 1000) === Math.floor(y / 100) % 10;
export const isQuadYear = (y: number) => y >= 1111 && y <= 9999 && y % 1111 === 0;
export const SPECIALS: readonly SpecialDef[] = SPECIALS60;
const listOf = (sim: Pick<SimState, "special60">): readonly SpecialDef[] => (sim.special60 ? SPECIALS60 : SPECIALS13);
export const SPECIAL_SYMS = [...new Set([...SPECIALS60, ...SPECIALS13].map((s) => s.sym))];
export const symsOf = (sim: Pick<SimState, "special60">) => listOf(sim).map((s) => s.sym);
export const isSpecialSym = (s: unknown): s is string => typeof s === "string" && SPECIAL_SYMS.includes(s);
/** Which symbols the display can draw; the default (tests, tools) says all. The app installs a real check at start. */
let glyphOk: (sym: string) => boolean = () => true;
export const setGlyphCheck = (f: ((sym: string) => boolean) | null) => { glyphOk = f ?? (() => true); };
export const readingOf = (sym: string) => (SPECIALS60.find((s) => s.sym === sym) ?? SPECIALS13.find((s) => s.sym === sym))?.reading ?? "";
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
const yearNow = (sim: SimState) => sim.startYear + Math.floor(sim.month / 12);
/** The symbol the next new special route takes, for a route made in `year`: in a fixed year its fixed symbol (if not used yet); otherwise the first symbol of the game's list, in order, that no route carries -- the six fixed ones are never given out in another year. */
export const nextSpecial = (sim: SimState, year = yearNow(sim)): string | null => {
  const have = specialRoutes(sim), list = symsOf(sim);
  if (sim.special60) { const fx = FIXED_YEARS[year]; if (fx && !have[fx]) return fx; return list.find((s) => !have[s] && !FIXED_SYMS.has(s)) ?? null; }
  return list.find((s) => !have[s]) ?? null;
};
/** The special route made last (the one that must be complete before another is begun): by the month it was made, the numbered 国道1号 first of all. */
export function lastSpecial(sim: SimState): SimRoute | null {
  const made = (r: SimRoute) => (r.history?.length ? Math.min(...r.history.map((h) => h.month)) : 0); let best: SimRoute | null = null;
  for (const r of Object.values(specialRoutes(sim))) if (!best || made(r) > made(best) || (made(r) === made(best) && r.id > best.id)) best = r; return best;
}
/** COMPLETE = built through: the route exists and every one of its sections has been finished (built to 100%). A section that was finished and later closed, or fell into disuse a century on, does not un-complete the route -- "完成" is about the construction, not about today's traffic. */
export function routeComplete(sim: SimState, r: SimRoute): boolean {
  if (!r.edges.length) return false;
  return r.edges.every((ref) => { const e = sim.edges[ref.edgeId]; return !!e && e.built >= 1; });
}
export interface Gate { ok: boolean; sym: string | null; reason: string }
/** May the next special route be made now? (The first symbol needs nothing before it; every later one needs the previous to be complete.) */
export function canBuildNext(sim: SimState, year = yearNow(sim)): Gate {
  const sym = nextSpecial(sim, year); if (!sym) return { ok: false, sym: null, reason: "特殊路線の記号はすべて使われています" };
  const prev = lastSpecial(sim); if (!prev) return { ok: true, sym, reason: "" };
  const pn = specialFullName(prev.special ?? String(prev.number));
  if (!routeComplete(sim, prev)) return { ok: false, sym, reason: `前の特殊路線(${pn})が完成していません(全区間の工事が終わっていることが条件です)` };
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
  const order = eulerOrder([...r.edges.map((x) => x.edgeId), ...newEdgeIds].map((id) => sim.edges[id]).filter((e): e is SimEdge => !!e), sim.edges[r.edges[0]?.edgeId]?.a); if (!order) return { ok: false, reason: "一筆書きの順に並べられません" };
  r.edges.splice(0, r.edges.length, ...order);   // the sections are kept as ONE walk over the whole line (each section once), which is what a route is everywhere else in the game
  r.history.push({ month, grade: r.grade, number: r.number, text: `${specialFullName(sym)}を${newEdgeIds.length}区間延長`, scope: r.scope });
  return { ok: true, reason: "" };
}

/** One walk over every section exactly once (Hierholzer): from an end when the line has two, else from `prefer` (a loop). null when there is none (strokeCheck says why). */
export function eulerOrder(edges: SimEdge[], prefer?: string): { edgeId: string; dir: 1 | -1 }[] | null {
  if (!strokeCheck(edges).ok) return null;
  const adj = new Map<string, { id: string; to: string; dir: 1 | -1 }[]>(), deg = new Map<string, number>();
  for (const e of edges) { (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push({ id: e.id, to: e.b, dir: 1 }); (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push({ id: e.id, to: e.a, dir: -1 }); deg.set(e.a, (deg.get(e.a) ?? 0) + 1); deg.set(e.b, (deg.get(e.b) ?? 0) + 1); }
  const odd = [...deg].filter(([, d]) => d % 2).map(([n]) => n).sort(), start = odd.length ? (prefer && odd.includes(prefer) ? prefer : odd[0]) : prefer && adj.has(prefer) ? prefer : edges[0].a;
  const used = new Set<string>(), stack: { node: string; via: { edgeId: string; dir: 1 | -1 } | null }[] = [{ node: start, via: null }], out: { edgeId: string; dir: 1 | -1 }[] = [];
  while (stack.length) { const top = stack[stack.length - 1], list = adj.get(top.node)!; let nx; while ((nx = list.pop()) && used.has(nx.id)); if (nx && !used.has(nx.id)) { used.add(nx.id); stack.push({ node: nx.to, via: { edgeId: nx.id, dir: nx.dir } }); } else { stack.pop(); if (top.via) out.push(top.via); } }
  return out.length === edges.length ? out.reverse() : null;
}
