/**
 * Break-up and privatisation of the national railway, on the world lines where it happens (平成 in 1987 as in real history, 修文 earlier
 * as a fictional variant; 正化 never). Lines are handed to area successor companies, thin short lines go to a regional third-sector
 * operator, and the thinnest are closed. The line numbers change with the operator and the old number is retired, never reused.
 */
import { eraKeyOf, type EraKey } from "./eras";
import { ev, issueNumber, prefName, routeOfficial } from "./engine";
import { pushHist, setEdgeState } from "./network";
import type { Grade, Operator, SimEdge, SimRoute, SimState } from "./types";
import type { World } from "./world";

export const PRIVATIZE_YEAR: Partial<Record<EraKey, number>> = { heisei: 1987, shubun: 1973 };
/** Island ids follow ISLAND_IDS (1 honshu, 2 hokkaido, 3 kyushu, 4 shikoku); Honshu is cut into three by longitude (east of Tokyo / Nagoya side / Kansai and west). */
const areaOf = (w: World, e: SimEdge): string => {
  const k = e.cells[Math.floor(e.cells.length / 2)], isl = w.t.island[k], x = w.cellPos(k)[0];
  if (isl === 2) return "北海道"; if (isl === 3) return "九州"; if (isl === 4) return "四国";
  return x >= 140 ? "東日本" : x >= -90 ? "中日本" : "西日本";
};
export function reformJnr(sim: SimState, w: World, y: number): void {
  const jnr = Object.values(sim.routes).filter((r) => r.active && r.op === "jnr" && r.mode === "rail"); if (!jnr.length) return;
  const successors = new Map<string, Operator>(), tertiary = new Map<string, Operator>();
  const succ = (area: string) => { const id = `jr.${area}`; if (!successors.has(id)) { const o: Operator = { id, name: `${area}旅客鉄道`, kind: "private", since: y, note: "国鉄の承継会社(架空の名称)" }; successors.set(id, o); sim.operators[id] = o; } return successors.get(id)!; };
  const third = (pref: string) => { const id = `t.${pref}`; if (!tertiary.has(id)) { const o: Operator = { id, name: `${prefName(pref)}地方鉄道(第三セクター)`, kind: "tertiary", since: y, note: "廃止対象だった国鉄線を地域が引き継いだ(架空の名称)" }; tertiary.set(id, o); sim.operators[id] = o; } return tertiary.get(id)!; };
  let toSucc = 0, toThird = 0, closed = 0;
  const info = jnr.map((r) => { const es = r.edges.map((x) => sim.edges[x.edgeId]).filter(Boolean), km = es.reduce((s, e) => s + e.lengthKm, 0) || 1; return { r, es, km, mean: es.reduce((s, e) => s + (e.through + e.local + e.freight * 0.4) * e.lengthKm, 0) / km }; });
  const limit = Math.max(1, Math.floor(info.length * 0.15));
  const weakest = [...info].sort((a, b) => a.mean - b.mean || (a.r.id < b.r.id ? -1 : 1));
  for (const { r, es, km, mean } of weakest) {
    const before = routeOfficial(r), small = km < 110;
    if (small && mean < 300 && closed < limit) {
      for (const e of es) if (e.state === "open" || e.state === "dormant") setEdgeState(sim, e, "closed", "国鉄改革で廃止対象に");
      r.active = false; r.history.push({ month: sim.month, grade: r.grade, number: r.number, text: "国鉄改革で廃止" }); closed++; continue;
    }
    const op = small && mean < 1500 ? third(es[0].region === "JP" ? "JP-13" : es[0].region) : succ(areaOf(w, es[Math.floor(es.length / 2)]));
    const g: Grade = "priv", num = issueNumber(sim, g, op.id);
    r.grade = g; r.scope = op.id; r.op = op.id; r.opName = op.name; r.number = num; r.name = `${op.name}${num}号線`;
    for (const e of es) { e.op = op.id; pushHist(sim, e, `管理主体が国鉄から${op.name}に変更`); }
    r.history.push({ month: sim.month, grade: g, number: num, text: `国鉄から${op.name}へ。旧番号「${before}」は欠番として再利用しない` });
    if (op.kind === "tertiary") toThird++; else toSucc++;
  }
  if (sim.operators.jnr) sim.operators.jnr.until = y;
  ev(sim, "reform", `国鉄を分割・民営化(${eraKeyOf(sim.era) === "heisei" ? "史実に沿う" : "架空の世界線"}): ${toSucc}路線を${successors.size}社へ、${toThird}路線を第三セクターへ、${closed}路線を廃止`, "累積赤字と政治判断。路線番号は管理主体ごとに振り直し、旧番号は再利用しない", {});
}
export type { SimRoute };
