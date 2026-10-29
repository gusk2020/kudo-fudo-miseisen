/**
 * Stage 25: ONE table for how a line is drawn -- the map (roads.ts) and the legend (legend24.ts) both read it, so a sample in the legend cannot differ from the line on the map.
 *
 * Few colours: one hue per kind of traffic (six), the greys and black/white that edge and join them, and ONE highlight colour that nothing else uses.
 * Everything else is told by something other than a hue:
 *   - condition (良 / 可 / 悪 / 荒廃): NOT shown on the map (Stage 26) -- the game keeps the quality number and uses it; a line's colour is its kind's, whatever its state of repair;
 *   - tier (メイン / サブ / ローカル): how thick;
 *   - state (供用中 / 計画 / 廃線 / 未成): the kind of line -- solid, dashed, dotted;
 *   - bridge / tunnel: the edging and the cross-lines (the structure's own drawing, in the map's black and white).
 * Display only: nothing here reads or changes the game.
 */
export type Kind = "road" | "hwy" | "rail" | "hsr" | "maglev" | "sea";
export type Tier = "main" | "sub" | "local";
/** open = 供用中 (dormant = open but resting), planned = 計画 (concept, planned, building, suspended), unbuilt = 未成, closed / lost = 廃線. */
export type LineState = "open" | "dormant" | "planned" | "unbuilt" | "closed" | "lost";

/** The hue of each kind: the only colours the lines carry. */
export const KIND_COLOUR: Record<Kind, number> = { road: 0xe39b4a, hwy: 0x4fa874, rail: 0x4a5f8c, hsr: 0x5b9be6, maglev: 0xb98ad8, sea: 0x6bbfd0 };   // Stage 27: softer hues
export const KIND_LABEL: Record<Kind, string> = { road: "道路", hwy: "高速道路", rail: "鉄道", hsr: "新幹線", maglev: "リニア", sea: "海路(国内)" };
/** The neutrals: the edge of a road, the grey of a line that is gone, and the white and black of bridges, centre lines and the highlight's frame. */
export const INK = 0x1a1a1a, PAPER = 0xffffff, ROAD_EDGE = 0x7a6a5a, GONE_GREY = 0x7d838a;
/** The one colour of "the line you chose". It is in no other style. */
export const HIGHLIGHT_COLOUR = 0xff00d4;

/** Condition steps, best first: the quality at which each begins, and how far the hue is paled toward white. */
export const QUALITY_STEPS = [{ min: 70, label: "良", pale: 0 }, { min: 40, label: "可", pale: 0.3 }, { min: 15, label: "悪", pale: 0.55 }, { min: 0, label: "荒廃", pale: 0.74 }] as const;
export const qualityStep = (q: number): number => QUALITY_STEPS.findIndex((s) => q >= s.min);
export const mix = (a: number, b: number, t: number): number => { const f = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t); return (f(16) << 16) | (f(8) << 8) | f(0); };
export const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");
export const shade = (kind: Kind, q: number): number => mix(KIND_COLOUR[kind], PAPER, QUALITY_STEPS[Math.max(0, qualityStep(q))].pale);

export const TIER_OF = { rural: "local", standard: "sub", highgrade: "main" } as const;
export const TIER_LABEL: Record<Tier, string> = { main: "メイン", sub: "サブ", local: "ローカル" };
/** Line widths by tier (px), for a road and for a railway. */
export const ROAD_WIDTH: Record<Tier, number> = { local: 1.6, sub: 2.8, main: 4.6 }, RAIL_WIDTH_T: Record<Tier, number> = { local: 1.7, sub: 2.5, main: 4 };
export const widthOf = (kind: Kind, tier: Tier) => (kind === "road" || kind === "hwy" ? ROAD_WIDTH[tier] : RAIL_WIDTH_T[tier]);
/** What the map tells of a line's state (Stage 27): 供用中 (including a resting line), 計画・未成, 廃線・廃道. The game keeps its finer states; this is only how they are drawn. */
export type ViewState = "open" | "planned" | "abolished";
export const viewState = (s: LineState): ViewState => (s === "open" || s === "dormant" ? "open" : s === "planned" || s === "unbuilt" ? "planned" : "abolished");
export const VIEW_STATE_LABEL: Record<ViewState, string> = { open: "供用中", planned: "計画・未成", abolished: "廃線・廃道" };
/** Stage 28: no line on the normal map is dashed or dotted -- every state is a continuous line. A planned line is an outline of its kind's hue with a pale core, a gone line a thin pale line of that hue; an open line is the plain solid one. */

export interface Stroke { colour: number; width: number; alpha: number; dash?: number[]; cap: "round" | "butt" }
/** What one edge is drawn with, bottom to top: the casing (if any), the body, a centre line (if any) and rail ties (if any). */
export interface EdgeStyle { casing?: Stroke; body: Stroke; centre?: Stroke; ties?: Stroke }
export interface StyleOpts { thin?: boolean; tunnel?: boolean; old?: boolean; bypass?: boolean; undesignated?: boolean }

const stroke = (colour: number, width: number, alpha = 1, dash?: number[], cap: "round" | "butt" = "round"): Stroke => ({ colour, width, alpha, ...(dash ? { dash } : {}), cap });
/** The style of an edge of this kind, tier, state and quality. The ONE place that decides it. */
const MEMO = new Map<string, EdgeStyle>();
/** (memoised: the same few hundred styles are asked for tens of thousands of times a redraw; callers must not modify what they get) */
export function edgeStyle(kind: Kind, tier: Tier, state: LineState, quality: number, o: StyleOpts = {}): EdgeStyle {
  const key = `${kind}${tier}${state}${qualityStep(quality)}${o.thin ? 1 : 0}${o.tunnel ? 1 : 0}${o.old ? 1 : 0}${o.bypass ? 1 : 0}${o.undesignated ? 1 : 0}`;
  let r = MEMO.get(key); if (!r) { r = build(kind, tier, state, quality, o); MEMO.set(key, r); } return r;
}
function build(kind: Kind, tier: Tier, state: LineState, quality: number, o: StyleOpts): EdgeStyle {
  const thin = o.thin ? 0.6 : 1, wd = widthOf(kind, tier) * (kind === "road" || kind === "hwy" ? (o.undesignated ? 0.8 : 1) : 1) * thin, base = KIND_COLOUR[kind];
  if (kind === "sea") {   // a sea route is a thin solid line in the sea colour: the state changes only how strong it is
    const v = viewState(state), alpha = v === "open" ? 0.95 : v === "planned" ? 0.6 : 0.4;
    return { body: stroke(v === "abolished" ? mix(base, PAPER, 0.4) : base, 2.4, alpha, undefined, "round") };
  }
  const vs = viewState(state);
  if (vs === "abolished") return { body: stroke(mix(base, PAPER, 0.55), 1.4, 0.9, undefined, "round") };   // a gone line: the kind's own hue, pale and thin -- a road and a railway still differ
  if (vs === "planned") return { casing: stroke(base, 3.6, 0.9, undefined, "round"), body: stroke(mix(base, PAPER, 0.8), 1.6, 1, undefined, "round") };   // a plan: the kind's hue as an outline round a pale core
  const body = base, tun = o.tunnel ? 0.5 : 1;
  if (kind === "road") return { casing: stroke(ROAD_EDGE, wd + 2.4, o.tunnel ? 0.4 : 0.85), body: stroke(body, wd, tun) };
  if (kind === "hwy") return { casing: stroke(mix(base, INK, 0.45), wd + 3.4, o.tunnel ? 0.4 : 0.9), body: stroke(body, wd, tun), centre: stroke(PAPER, 1, 0.9) };
  const casing = stroke(PAPER, wd + (thin < 1 ? 1.2 : 2.2), (thin < 1 ? 0.7 : 0.92) * (o.tunnel ? 0.45 : 1)), big = kind === "rail" ? 1 : 1.15;
  const out: EdgeStyle = { casing, body: stroke(body, wd * big, tun) };
  if (kind === "hsr" || kind === "maglev") out.centre = stroke(PAPER, 1.2, 0.95);   // (a 新幹線 and a リニア look alike on the map and share one legend entry; the game keeps them apart)
  return out;
}
/** The progress of a line being built: drawn solid over the dashes. */
export const buildProgressStroke = (kind: Kind): Stroke => stroke(KIND_COLOUR[kind], 3, 1);
/** A bridge: black edges, a white deck, girders (the road or rail itself runs on top). A tunnel: two thin dark edges. */
export const BRIDGE = { edge: (wd: number): Stroke => stroke(INK, wd + 8, 1, undefined, "butt"), deck: (wd: number): Stroke => stroke(PAPER, wd + 4.6, 0.97, undefined, "butt"), girder: stroke(INK, 1.5, 1), girderStep: 6 } as const;
export const TUNNEL = { edge: stroke(INK, 1.2, 0.8, undefined, "butt") } as const;
/** The chosen line: white halo, black edge, the highlight colour, a white core. */
export const HIGHLIGHT_LAYERS = [{ colour: PAPER, extra: 16, alpha: 0.85 }, { colour: INK, extra: 11, alpha: 1 }, { colour: HIGHLIGHT_COLOUR, extra: 7, alpha: 1 }, { colour: PAPER, extra: 2, alpha: 1 }] as const;

/** Every colour the line styles can produce, for the test that counts them. */
export function allStyleColours(): Set<number> {
  const out = new Set<number>(); const add = (s?: Stroke) => { if (s) out.add(s.colour); };
  for (const kind of Object.keys(KIND_COLOUR) as Kind[]) for (const tier of ["main", "sub", "local"] as Tier[]) for (const state of ["open", "dormant", "planned", "unbuilt", "closed", "lost"] as LineState[]) for (const q of [90, 50, 20, 5]) for (const o of [{}, { old: true, bypass: true, tunnel: true, thin: true }] as StyleOpts[]) { const s = edgeStyle(kind, tier, state, q, o); add(s.casing); add(s.body); add(s.centre); add(s.ties); }
  add(buildProgressStroke("road")); add(AIR_STYLE.casing); add(AIR_STYLE.body); add(BRIDGE.edge(3)); add(BRIDGE.deck(3)); add(BRIDGE.girder); add(TUNNEL.edge); for (const l of HIGHLIGHT_LAYERS) out.add(l.colour);
  return out;
}

/** A domestic flight (Stage 27): a pale blue-grey line drawn as a gentle arc between its two airports, on a faint white under-stroke -- light enough not to hide roads and names, and told from a road (solid, kind hue), a sea route and a gone line by being a thin curve. */
export const AIR_STYLE: EdgeStyle = { casing: stroke(PAPER, 3.4, 0.5, undefined, "round"), body: stroke(0x9fb0c8, 1.5, 0.85, undefined, "round") };
/** The arc of a flight: a quadratic curve from `a` to `b` (both end points exactly), bulging by 18% of the distance (at most 70 km, so a long flight is not a huge loop), always toward the north (toward the east for a flight that runs north-south), so two flights never bulge into each other. Display only. */
export const AIR_BULGE = 0.18, AIR_BULGE_MAX_KM = 70, AIR_SEGMENTS = 12;
export function airArc(a: readonly [number, number], b: readonly [number, number], segments = AIR_SEGMENTS): [number, number][] {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy); if (len < 1e-6) return [[a[0], a[1]], [b[0], b[1]]];
  let nx = -dy / len, ny = dx / len; if (Math.abs(ny) < 0.2 ? nx < 0 : ny < 0) { nx = -nx; ny = -ny; }
  const h = Math.min(AIR_BULGE * len, AIR_BULGE_MAX_KM), cx = (a[0] + b[0]) / 2 + nx * h * 2, cy = (a[1] + b[1]) / 2 + ny * h * 2, out: [number, number][] = [];   // (a control point at 2h puts the curve's own middle h off the chord)
  for (let i = 0; i <= segments; i++) { const t = i / segments, u = 1 - t; out.push([u * u * a[0] + 2 * u * t * cx + t * t * b[0], u * u * a[1] + 2 * u * t * cy + t * t * b[1]]); }
  out[0] = [a[0], a[1]]; out[segments] = [b[0], b[1]]; return out;
}
