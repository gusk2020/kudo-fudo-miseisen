/**
 * Stage 25: ONE table for how a line is drawn -- the map (roads.ts) and the legend (legend24.ts) both read it, so a sample in the legend cannot differ from the line on the map.
 *
 * Few colours: one hue per kind of traffic (six), the greys and black/white that edge and join them, and ONE highlight colour that nothing else uses.
 * Everything else is told by something other than a hue:
 *   - condition (良 / 可 / 悪 / 荒廃): the SHADE of the kind's own hue -- the worse, the paler (the game keeps the quality number; this is only how it shows);
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
export const KIND_COLOUR: Record<Kind, number> = { road: 0xd9822b, hwy: 0x138a4a, rail: 0x1c2f55, hsr: 0x1e6fd9, maglev: 0xa52fd0, sea: 0x2a9db8 };
export const KIND_LABEL: Record<Kind, string> = { road: "道路", hwy: "高速道路", rail: "鉄道", hsr: "新幹線", maglev: "リニア", sea: "海路(国内)" };
/** The neutrals: the edge of a road, the grey of a line that is gone, and the white and black of bridges, centre lines and the highlight's frame. */
export const INK = 0x1a1a1a, PAPER = 0xffffff, ROAD_EDGE = 0x3d3d3d, GONE_GREY = 0x7d838a;
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
/** The dash of each state (px; null = solid). */
export const STATE_DASH: Record<LineState, number[] | null> = { open: null, dormant: [10, 6], planned: [7, 4], unbuilt: [1, 6], closed: [5, 4], lost: [2, 5] };
export const STATE_LABEL: Record<"open" | "planned" | "abolished" | "unbuilt", string> = { open: "供用中", planned: "計画", abolished: "廃線", unbuilt: "未成" };
export const OLD_ROAD_DASH = [9, 3, 2, 3];   // 旧道: the stretch a bypass took the traffic from

export interface Stroke { colour: number; width: number; alpha: number; dash?: number[]; cap: "round" | "butt" }
/** What one edge is drawn with, bottom to top: the casing (if any), the body, a centre line (if any) and rail ties (if any). */
export interface EdgeStyle { casing?: Stroke; body: Stroke; centre?: Stroke; ties?: Stroke }
export interface StyleOpts { thin?: boolean; tunnel?: boolean; old?: boolean; bypass?: boolean; undesignated?: boolean }

const stroke = (colour: number, width: number, alpha = 1, dash?: number[], cap: "round" | "butt" = "round"): Stroke => ({ colour, width, alpha, ...(dash ? { dash } : {}), cap });
/** The style of an edge of this kind, tier, state and quality. The ONE place that decides it. */
export function edgeStyle(kind: Kind, tier: Tier, state: LineState, quality: number, o: StyleOpts = {}): EdgeStyle {
  const thin = o.thin ? 0.6 : 1, wd = widthOf(kind, tier) * (kind === "road" || kind === "hwy" ? (o.undesignated ? 0.8 : 1) : 1) * thin, base = KIND_COLOUR[kind];
  if (kind === "sea") {   // a sea route is always dashed (it is not a road): state changes only how strong it is
    const alpha = state === "open" ? 0.95 : state === "dormant" ? 0.6 : 0.35;
    return { body: stroke(base, 3, alpha, [7, 5], "butt") };
  }
  if (state === "closed") return { body: stroke(GONE_GREY, 1.6, 0.95, STATE_DASH.closed!, "butt") };
  if (state === "lost") return { body: stroke(GONE_GREY, 1.2, 0.85, STATE_DASH.lost!, "butt") };
  if (state === "planned") return { body: stroke(base, 2.2, 0.95, STATE_DASH.planned!, "butt") };
  if (state === "unbuilt") return { body: stroke(base, 2.2, 0.95, STATE_DASH.unbuilt!, "round") };
  const body = shade(kind, quality), tun = o.tunnel ? 0.5 : 1;
  if (state === "dormant") return { body: stroke(body, wd * 0.9, 0.9, STATE_DASH.dormant!, "butt") };
  if (kind === "road") return { casing: stroke(ROAD_EDGE, wd + 2.4, o.tunnel ? 0.4 : 0.95), body: stroke(body, wd, tun, o.old ? OLD_ROAD_DASH : undefined, o.old ? "butt" : "round"), ...(o.bypass ? { centre: stroke(PAPER, 1, 0.9) } : {}) };
  if (kind === "hwy") return { casing: stroke(mix(base, INK, 0.45), wd + 3.4, o.tunnel ? 0.4 : 0.95), body: stroke(body, wd, tun, o.old ? OLD_ROAD_DASH : undefined, o.old ? "butt" : "round"), centre: stroke(PAPER, 1, 0.9) };
  const casing = stroke(PAPER, wd + (thin < 1 ? 1.2 : 2.2), (thin < 1 ? 0.7 : 0.92) * (o.tunnel ? 0.45 : 1)), big = kind === "rail" ? 1 : 1.15;
  const out: EdgeStyle = { casing, body: stroke(body, wd * big, tun) };
  if (kind === "rail") out.ties = stroke(PAPER, wd * 0.7, 0.95, [4, 5], "butt");
  else if (kind === "hsr") out.centre = stroke(PAPER, 1.2, 0.95);
  else out.centre = stroke(PAPER, 1.6, 0.95, [6, 4], "butt");
  return out;
}
/** The progress of a line being built: drawn solid over the dashes. */
export const buildProgressStroke = (kind: Kind): Stroke => stroke(KIND_COLOUR[kind], 3, 1);
/** A bridge: black edges, a white deck, girders (the road or rail itself runs on top). A tunnel: two dashed dark edges. */
export const BRIDGE = { edge: (wd: number): Stroke => stroke(INK, wd + 8, 1, undefined, "butt"), deck: (wd: number): Stroke => stroke(PAPER, wd + 4.6, 0.97, undefined, "butt"), girder: stroke(INK, 1.5, 1), girderStep: 6 } as const;
export const TUNNEL = { edge: stroke(INK, 1.7, 0.95, [4, 3], "butt") } as const;
/** The chosen line: white halo, black edge, the highlight colour, a white core. */
export const HIGHLIGHT_LAYERS = [{ colour: PAPER, extra: 16, alpha: 0.85 }, { colour: INK, extra: 11, alpha: 1 }, { colour: HIGHLIGHT_COLOUR, extra: 7, alpha: 1 }, { colour: PAPER, extra: 2, alpha: 1 }] as const;

/** Every colour the line styles can produce, for the test that counts them. */
export function allStyleColours(): Set<number> {
  const out = new Set<number>(); const add = (s?: Stroke) => { if (s) out.add(s.colour); };
  for (const kind of Object.keys(KIND_COLOUR) as Kind[]) for (const tier of ["main", "sub", "local"] as Tier[]) for (const state of ["open", "dormant", "planned", "unbuilt", "closed", "lost"] as LineState[]) for (const q of [90, 50, 20, 5]) for (const o of [{}, { old: true, bypass: true, tunnel: true, thin: true }] as StyleOpts[]) { const s = edgeStyle(kind, tier, state, q, o); add(s.casing); add(s.body); add(s.centre); add(s.ties); }
  add(buildProgressStroke("road")); add(BRIDGE.edge(3)); add(BRIDGE.deck(3)); add(BRIDGE.girder); add(TUNNEL.edge); for (const l of HIGHLIGHT_LAYERS) out.add(l.colour);
  return out;
}

/** A domestic flight: a thin grey line between its two airports (not a road: no edging, no states). */
export const AIR_LINE = { colour: GONE_GREY, width: 1.1, alpha: 0.7 } as const;
/** The overlay of "compared with year N": the line got better (or is new) / worse. Two colours, shown only while comparing. */
export const COMPARE = { good: 0x39a0ff, bad: 0xff3b3b } as const;
