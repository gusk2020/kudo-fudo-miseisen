/**
 * Stage 22: the year 2200 -- 遷都と復興. Once in a game (made from Stage 3 on, with the era timeline), at the start of 2200, the player may
 *   - put the capital, the sub-capital and the palace anywhere again (a prefecture, or a point on the map that becomes its 県庁所在地, as at the start),
 *   - choose a new era name among the names put forward beside 大正 in 1912 (CAND_2200), and
 *   - choose the reconstruction policy freely: transport (road / rail / sea / air / balanced), coast (日本海側 / 太平洋側 / 中立) and focus (一極集中 / 地方分散) -- in 2200 the policy is NOT tied to the name.
 * Then a new 国道0号 may be drawn between the new capital and sub-capital, laid along existing, old and abandoned roads where it can (ceremony.ts).
 * Nothing is removed: the old seats stay as cities with their people, and people move only through the yearly settling (no one is moved in a day). The game waits for the player in EVERY mode (Stage 23: 完全自動 and an absent player included); keeping everything as it is (現状維持) is a choice the player makes with its own button, never a default. The event is recorded in `sim.e2200` and never fires twice; a game that jumps past 2200 still gets it at the first year boundary after.
 */
import { RELOC_STEP, eraKey, futureInterval, relocGroup, relocYear, usedKeys, type RelocGroup, type Recon } from "./kaigen";
import { composeDials, type EraKey } from "./eras";
import { setActiveTimeline, type SimState } from "./types";
import { ev, yearOf } from "./engine";
import type { Vec } from "../core/types";
import type { World } from "./world";

export const E2200_YEAR = 2200;
export interface Choice2200 { era: number; stance: EraKey; coast: Recon["coast"]; focus: Recon["focus"]; capital?: string; sub?: string; palace?: string; capitalPos?: Vec; subPos?: Vec; palacePos?: Vec }
export interface Road0Info { routeId: string; reusedKm: number; restoredKm: number; newKm: number; costBu: number; spurs: number }
export interface E2200 { /** Stage 25: this is the n-th (0-based) relocation event; it came due in `sched` (2200 + 150n) */ n?: number; sched?: number; year: number; state: "pending" | "road0" | "done"; era?: string; stance?: EraKey; recon?: Recon; moved?: string[]; kept?: true; auto?: true; skipped?: true; road0?: Road0Info }
export const TRANSPORT_LABEL: Record<string, string> = { shubun: "道路重視", shoka: "鉄道重視", kairo: "海路重視", kuuro: "空路重視", heisei: "均衡" };
/** The game waits for the player while the event is open: choosing the era / seats / policy is not the end of it -- 国道0号 is drawn and opened, or given up (見送る), explicitly. */
export const waiting2200 = (sim: Pick<SimState, "e2200">) => sim.e2200?.state === "pending" || sim.e2200?.state === "road0";
/** Stage 25: the event repeats every 150 years (2200, 2350, 2500, ...). `sim.e2200` is the latest one; the earlier ones are kept, in order, in `sim.e2200hist`. */
export const E2200_STEP = RELOC_STEP;
export const eventsOpened = (sim: Pick<SimState, "e2200" | "e2200hist">) => (sim.e2200hist?.length ?? 0) + (sim.e2200 ? 1 : 0);
export const nextYear2200 = (sim: Pick<SimState, "e2200" | "e2200hist">) => relocYear(eventsOpened(sim));
/** Due at a year boundary on or after the next scheduled year in a timeline game, once the previous event is over. The schedule counts events, not the year they happened to open in, so it cannot drift or fire twice. */
export const due2200 = (sim: SimState) => !!sim.stage3 && !!sim.kaigen && (!sim.e2200 || sim.e2200.state === "done") && yearOf(sim) >= nextYear2200(sim);
export function open2200(sim: SimState) {
  const n = eventsOpened(sim), k = sim.kaigen!; if (sim.e2200) (sim.e2200hist ??= []).push(sim.e2200);
  sim.e2200 = { year: yearOf(sim), state: "pending", n, sched: relocYear(n) }; (k.reloc ??= [])[n] = relocGroup(k, n, yearOf(sim));
  ev(sim, "kaigen", `${yearOf(sim)}年: 遷都と復興の時を迎えた(第${n + 1}回)`, "首都・副首都・皇居、元号、復興方針を選び直せます(選ばなければ今のまま)", {});
}
/** The candidates put to the player at the open event (built now for a game saved before they were recorded). */
export function groupOf2200(sim: SimState): RelocGroup | null {
  const e = sim.e2200, k = sim.kaigen; if (!e || !k) return null; const n = e.n ?? Math.max(0, (sim.e2200hist?.length ?? 0));
  return (k.reloc ??= [])[n] ??= relocGroup(k, n, e.year);
}
/** The choice is applied. `null` = keep everything as it is (the player pressed 今のまま続ける). Returns the seat moves that change the world (the app rebuilds it with them). */
export function apply2200(sim: SimState, ch: Choice2200 | null, auto = false, seatPos?: (pref: string) => Vec | null): boolean {
  const e = sim.e2200, k = sim.kaigen; if (!e || e.state !== "pending" || !k) return false; const y = e.year;
  if (!ch) { e.state = "done"; e.kept = true; if (auto) e.auto = true; ev(sim, "kaigen", `${y}年: 遷都・改元は行わず、今の首都・元号・方針を続ける${auto ? "【自動】" : ""}`, "選択されなかったため現状を維持", {}); return false; }
  const g = groupOf2200(sim)!, used = usedKeys(k); let ci = Math.max(0, Math.min(g.cands.length - 1, Math.floor(ch.era)));
  if (used.has(eraKey(g.cands[ci].name))) ci = Math.max(0, g.cands.findIndex((x) => !used.has(eraKey(x.name))));   // (a name already adopted is never adopted again)
  const c = { ...g.cands[ci], yomi: g.cands[ci].yomi ?? "" };
  if (!used.has(eraKey(c.name))) { k.eras.push({ name: c.name, start: y, stance: ch.stance, real: c.real, picked: ci, of: g.cands.length, auto }); g.chosen = c.name; }
  k.pending = null; k.next = y + futureInterval(sim.seed, k.nextIdx); k.nextIdx++;
  k.recon = { coast: ch.coast, focus: ch.focus, since: y };
  // seats: prefecture ids; a point on the map becomes that prefecture's 県庁所在地 (as at the start); a seat with no point stands at its prefecture's 県庁所在地
  const moved: string[] = [];
  const set = (role: "capital" | "sub" | "palace", pref: string | undefined, pos: Vec | undefined) => {
    if (!pref) return;
    if (role === "capital") { if (sim.capital !== pref || pos) moved.push(role); sim.capital = pref; if (pos) sim.capitalPos = pos; else delete sim.capitalPos; }
    else if (role === "sub") { if (sim.subCapital !== pref || pos) moved.push(role); sim.subCapital = pref; if (pos) sim.subPos = pos; else delete sim.subPos; }
    else { if (sim.palace?.pref !== pref || pos) moved.push(role); const same = sim.palace?.pref === pref; sim.palace = { pref, pos: pos ?? (same ? sim.palace!.pos : seatPos?.(pref) ?? sim.palace?.pos ?? [0, 0]) }; }   // Stage 27: a palace moved to another prefecture stands at THAT prefecture's 県庁所在地 (it used to keep the old coordinates: the name changed, the place did not)
    if (pos && sim.isl20 && !(sim.moves20 ?? []).some((m) => m.pref === pref && Math.hypot(m.pos[0] - pos[0], m.pos[1] - pos[1]) < 0.5)) { const list = (sim.moves20 ??= []).filter((m) => !(m.pref === pref && (m as { since?: number }).since === y)); list.push({ pref, pos: [pos[0], pos[1]], by: role, since: y } as (typeof list)[number]); sim.moves20 = list; }
  };
  if (ch.capital && ch.sub && ch.capital === ch.sub) ch = { ...ch, sub: undefined, subPos: undefined };
  set("capital", ch.capital, ch.capitalPos); set("sub", ch.sub, ch.subPos); set("palace", ch.palace, ch.palacePos);
  e.state = "road0"; e.era = c.name; e.stance = ch.stance; e.recon = { ...k.recon }; e.moved = moved;
  setActiveTimeline(k.eras); sim.dials = composeDials(sim, y);
  ev(sim, "kaigen", `改元・遷都: ${c.name}${c.yomi ? `(${c.yomi})` : ""}元年(${y}年)${c.real ? "" : "【架空の名】"}`, `方針は元号と切り離して選択: ${TRANSPORT_LABEL[ch.stance] ?? ch.stance}・${ch.coast === "pacific" ? "太平洋側重視" : ch.coast === "japansea" ? "日本海側重視" : "海側は中立"}・${ch.focus === "concentrate" ? "一極集中" : "地方分散"}${moved.length ? `。${moved.map((r) => ({ capital: "首都", sub: "副首都", palace: "皇居" })[r]).join("・")}を移した(旧所在地の都市と住民はそのまま)` : ""}`, {});
  return moved.length > 0;
}
/** After the world was rebuilt with a new 県庁所在地: the city that appeared gets its people from the old 県庁所在地 of its prefecture (a small slice, as at the start; nobody is created). */
export function adoptWorld(sim: SimState, w: World): void {
  for (const c of w.cities) {
    if (sim.cities[c.id]) continue;
    const from = w.cities.find((x) => x.pref === c.pref && x.id !== c.id && x.former && sim.cities[x.id]) ?? w.cities.find((x) => x.pref === c.pref && x.id !== c.id && sim.cities[x.id]);
    const src = from ? sim.cities[from.id] : null, take = src ? Math.max(0, Math.min(src.pop - 2000, Math.round(Math.max(2000, Math.min(c.capPop ?? Infinity, 0.01 * src.pop))))) : 0;
    if (src) src.pop -= take;
    sim.cities[c.id] = { pop: Math.max(take, 0), popSource: "synthetic", lowAccessYears: 0, industry: src?.industry ?? 0.3 };
    if (sim.pot17) sim.pot17.shown[c.id] = yearOf(sim);
  }
}
/** The 国道0号 is done (opened, or the player chose not to draw it): the event is over. */
/** The event ends: 国道0号 opened (`road0` given) or given up (none: recorded as `skipped`). */
export function close2200(sim: SimState, road0?: Road0Info) { if (sim.e2200) { sim.e2200.state = "done"; if (road0) sim.e2200.road0 = road0; else sim.e2200.skipped = true; } }

/** Stage 27: after the world was rebuilt with the new seats, a palace chosen without a map point stands at its prefecture's (current) 県庁所在地; a palace point lying outside its own prefecture (a game saved by the version that kept the old coordinates) is put there too. */
export function placePalace(sim: SimState, w: World, onlyIfOutside = false): boolean {
  const pl = sim.palace; if (!pl) return false; const seat = w.cities.find((c) => c.pref === pl.pref && c.kind === "capital"); if (!seat) return false;
  if (onlyIfOutside) { if (!sim.e2200 || sim.moves20?.some((m) => m.by === "palace" && m.pref === pl.pref)) return false; const k = w.cellOf(pl.pos);   // (only after a relocation, and never for a palace the player put on the map himself, an island's included)
    if (k >= 0 && w.prefOf(k) === pl.pref) return false; }
  if (Math.hypot(pl.pos[0] - seat.pos[0], pl.pos[1] - seat.pos[1]) < 1e-6) return false; sim.palace = { pref: pl.pref, pos: [seat.pos[0], seat.pos[1]] }; return true;
}
