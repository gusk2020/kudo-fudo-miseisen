/**
 * Stage 25: the legend's line samples, made from the SAME style table the map draws with (style24.ts). Each entry carries the style it was made from (`ref`) so a test can check, entry by entry, that the sample is
 * the line the map draws; nothing here has a colour or a width of its own. Pure data and strings: no DOM, no three.js.
 */
import { AIR_STYLE, BRIDGE, HIGHLIGHT_LAYERS, KIND_LABEL, STATE_LABEL, TIER_LABEL, TUNNEL, edgeStyle, hex, type EdgeStyle, type Kind, type LineState, type Stroke, type Tier } from "./style24";

export interface LegendRef { kind?: Kind; tier?: Tier; state?: LineState; quality?: number; also?: Kind; what?: "bridge" | "tunnel" | "shared" | "highlight" | "air" | "rings" }
export interface LegendItem { group: string; caption: string; svg: string; ref: LegendRef }
const Y = 8, X0 = 3, X1 = 61;
/** One style stroke as an SVG line (width and dash exactly as the map draws them; the sample is 64 units wide). */
export const svgStroke = (s: Stroke, y = Y, extra = ""): string => `<line x1="${X0}" y1="${y}" x2="${X1}" y2="${y}" stroke="${hex(s.colour)}" stroke-width="${s.width}"${s.alpha < 1 ? ` stroke-opacity="${s.alpha}"` : ""}${s.dash ? ` stroke-dasharray="${s.dash.join(" ")}"` : ""} stroke-linecap="${s.cap}" ${extra}/>`;
export const svgOfStyle = (st: EdgeStyle, y = Y): string => [st.casing, st.body, st.centre, st.ties].filter(Boolean).map((s) => svgStroke(s!, y)).join("");
const KINDS: Kind[] = ["road", "hwy", "rail", "sea"];
const KIND_CAPTION: Partial<Record<Kind, string>> = { sea: "海路(国内) 青緑の破線" };
const BRIDGE_W = 3.5;

export function legendItems(): LegendItem[] {
  const out: LegendItem[] = [], add = (group: string, caption: string, svg: string, ref: LegendRef) => out.push({ group, caption, svg, ref });
  for (const k of KINDS) add("交通種別", KIND_CAPTION[k] ?? KIND_LABEL[k], svgOfStyle(edgeStyle(k, "sub", "open", 90)), { kind: k, tier: "sub", state: "open", quality: 90 });
  add("交通種別", "新幹線・リニア 青／紫+白線", svgOfStyle(edgeStyle("hsr", "sub", "open", 90), 5) + svgOfStyle(edgeStyle("maglev", "sub", "open", 90), 11), { kind: "hsr", tier: "sub", state: "open", quality: 90, also: "maglev" });
  add("交通種別", "空路(国内) 黒の鎖線", svgOfStyle(AIR_STYLE), { what: "air" });
  for (const t of ["main", "sub", "local"] as Tier[]) add("階層(太さ)", TIER_LABEL[t], svgOfStyle(edgeStyle("road", t, "open", 90)), { kind: "road", tier: t, state: "open", quality: 90 });
  const S: [LineState, string][] = [["open", `${STATE_LABEL.open} 実線`], ["dormant", `${STATE_LABEL.open}(休止) 長い破線`], ["planned", `${STATE_LABEL.planned} 短い破線`], ["unbuilt", `${STATE_LABEL.unbuilt} 細かい点`], ["closed", `${STATE_LABEL.abolished}(閉鎖) 灰色の破線`], ["lost", `${STATE_LABEL.abolished}(消失) 灰色の点線`]];
  for (const [s, c] of S) add("状態(線種)", c, svgOfStyle(edgeStyle("road", "sub", s, 90)), { kind: "road", tier: "sub", state: s, quality: 90 });
  const wd = BRIDGE_W, girders = [10, 22, 34, 46, 58].map((x) => `<line x1="${x}" y1="1" x2="${x}" y2="15" stroke="${hex(BRIDGE.girder.colour)}" stroke-width="${BRIDGE.girder.width}"/>`).join("");
  add("橋・トンネル", "橋 白い帯と横線", svgStroke(BRIDGE.edge(wd)) + svgStroke(BRIDGE.deck(wd)) + svgStroke(edgeStyle("road", "sub", "open", 90).body) + girders, { what: "bridge" });
  add("橋・トンネル", "トンネル 黒い破線", [1, -1].map((sg) => svgStroke(TUNNEL.edge, Y + sg * 5)).join("") + svgOfStyle(edgeStyle("road", "sub", "open", 90, { tunnel: true })), { what: "tunnel" });
  add("橋・トンネル", "共用は2本並ぶ", svgOfStyle(edgeStyle("road", "sub", "open", 90), 5) + svgOfStyle(edgeStyle("rail", "sub", "open", 90), 11), { what: "shared" });
  add("そのほか", "選んだ路線", [...HIGHLIGHT_LAYERS].map((l) => svgStroke({ colour: l.colour, width: 3 + l.extra, alpha: l.alpha, cap: "round" })).join(""), { what: "highlight" });
  add("そのほか", "紫の輪 政令市/特区", '<circle cx="20" cy="8" r="5.5" fill="none" stroke="#3b1f6e" stroke-width="2.4"/><circle cx="44" cy="8" r="5.5" fill="none" stroke="#7a4fb5" stroke-width="1.4"/>', { what: "rings" });
  return out;
}
