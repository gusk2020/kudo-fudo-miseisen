/**
 * Stage 26: 自動セーブポイント. In place of the year-by-year snapshots and the look-at-a-past-year view (gone), the game writes a COMPLETE save at a few fixed moments:
 *   - every 50 years (2000, 2050, ...), at the first year boundary on or after the multiple;
 *   - just AFTER each 150-year relocation event (2200, 2350, ...) -- seats, era name and policy decided, 国道0号 built or given up -- when that is also a 50-year mark it is one save, not two.
 * A checkpoint is an ordinary save (map, whole simulation: random state, event state, era history, seats, network, people), so loading one continues the game exactly as it would have gone on from there.
 * They live under their own keys, apart from the numbered slots and the running autosave, and are pruned by a fixed rule (below): this file touches nothing else.
 * Pure logic plus a small storage interface (the app plugs in IndexedDB, a test plugs in a Map).
 */
import { yearOf } from "./engine";
import { due2200, eventsOpened } from "./event2200";
import type { SimState } from "./types";

export const CP_EVERY_YEARS = 50, CP_MAX_COUNT = 8, CP_MAX_BYTES = 48 * 1024 * 1024;
export const CP_PREFIX = "s3:cp:", CP_INDEX = "s3:cp:index";
export type CpKind = "50y" | "reloc";
export interface CpDue { kind: CpKind; year: number; /** for "reloc": the number of the event just finished (1-based) */ n?: number }
export interface CpEntry { /** Stage 30A: the world and timeline this save belongs to (absent = taken before Stage 30A, origin unknown) */ wid?: string; tl?: string; /** 2 = taken after the relocation event (Stage 27); absent = taken just before it (Stage 26) */ v?: number; key: string; year: number; kind: CpKind; n?: number; bytes: number; gz: boolean; savedAt: number; capital: string; sub: string }
export interface CpStore { put(key: string, data: Uint8Array | string): Promise<void>; get(key: string): Promise<Uint8Array | string | undefined>; del(key: string): Promise<void>; keys(): Promise<string[]> }

/**
 * Is a checkpoint due at this month boundary? (Only the app's clock asks; the plain stepping used by tests and tools never writes one.)
 * Stage 27: the checkpoint of a relocation is taken just AFTER the event -- when the capital, sub-capital, palace, era name and policy are decided and 国道0号 is built or explicitly given up (state "done") --
 * so loading it does not ask for the choices again. A 50-year mark that falls on a relocation (2200, 2350, ...) is that one save, taken after the event; while an event is due or open no 50-year save is taken.
 */
export function checkpointDue(sim: SimState): CpDue | null {
  if (!sim.ceremonyDone || sim.month % 12 !== 0) return null;
  const n = eventsOpened(sim), e = sim.e2200;
  if (e && e.state === "done" && (sim.cp?.reloc ?? 0) < n) return { kind: "reloc", year: e.year, n };
  if (e && e.state !== "done") return null;     // an event is open: nothing is saved in the middle of it
  if (due2200(sim)) return null;                // an event is about to open (the 50-year save waits for it)
  const y = yearOf(sim), mark = Math.floor(y / CP_EVERY_YEARS) * CP_EVERY_YEARS;
  if (mark > (sim.cp?.y50 ?? Math.floor(sim.startYear / CP_EVERY_YEARS) * CP_EVERY_YEARS)) return { kind: "50y", year: y };
  return null;
}
/** Records in the game that this checkpoint is being taken (done BEFORE it is serialised, so a game loaded from it does not take it again). */
export function markCheckpoint(sim: SimState, d: CpDue) { sim.cp = { y50: Math.max(sim.cp?.y50 ?? 0, Math.floor(d.year / CP_EVERY_YEARS) * CP_EVERY_YEARS), reloc: d.kind === "reloc" ? d.n! : sim.cp?.reloc ?? 0 }; }

/** Stage 30A: the key names the world and timeline too -- two histories that reach the same year no longer overwrite each other. Old (identity-less) saves keep the old key form. */
export const cpKey = (d: CpDue, id?: Identity) => id ? `${CP_PREFIX}${id.wid}:${id.tl}:${d.year}:${d.kind}` : `${CP_PREFIX}${d.year}:${d.kind}`;

/**
 * Stage 30A: world and timeline identity. `wid` is issued once at the start of a new game and never changes; `tl` names one line of play within it. Loading a save made EARLIER than a checkpoint of the same timeline
 * starts a new timeline (a branch): its `anc` lists the timelines it came from with the year it left each, so the list shows the past it shares and none of the futures it does not.
 */
export interface Identity { wid: string; tl: string; anc?: { tl: string; y: number }[] }
export const identityOf = (sim: SimState): Identity | null => sim.wid && sim.tl ? { wid: sim.wid, tl: sim.tl, ...(sim.anc?.length ? { anc: sim.anc } : {}) } : null;
const rnd = () => Math.random().toString(36).slice(2, 8);
export const newWorldId = () => `w${Date.now().toString(36)}${rnd()}`;
export const newTimelineId = () => `t${Date.now().toString(36)}${rnd()}`;
/** Gives a game without an identity a fresh one (a new game; or a save from before Stage 30A, whose history cannot be known -- it becomes a world of its own). */
export function ensureIdentity(sim: SimState): boolean { if (sim.wid && sim.tl) return false; sim.wid = newWorldId(); sim.tl = newTimelineId(); delete sim.anc; return true; }
/** Called when a save is loaded on the player's request: if the same timeline already holds a later checkpoint, the game goes on as a new branch. Returns true when it branched. */
export function assignBranch(sim: SimState, index: CpEntry[]): boolean {
  if (ensureIdentity(sim)) return false;
  const y = yearOf(sim); if (!index.some((e) => e.wid === sim.wid && e.tl === sim.tl && e.year > y)) return false;
  sim.anc = [...(sim.anc ?? []), { tl: sim.tl!, y }].slice(-12); sim.tl = newTimelineId(); return true;
}
/** Does entry `e` belong to the history of this game: its own timeline up to now, or an ancestor's up to the year the game left it? */
export function inHistory(e: CpEntry, id: Identity): boolean {
  if (e.wid !== id.wid) return false;
  if (e.tl === id.tl) return true;
  const a = id.anc?.find((x) => x.tl === e.tl); return !!a && e.year <= a.y;
}
/** Stage 30A: capacity. The limits below apply PER WORLD (all its timelines together): at most CP_MAX_COUNT entries and CP_MAX_BYTES. Across worlds, at most CP_WORLDS_MAX worlds are kept (the one least recently written goes whole), so branches and
 *  new games cannot make the store grow without bound. Nothing is ever pruned by branching itself. */
export const CP_WORLDS_MAX = 4;
/** Which stored checkpoints to delete so that at most `maxCount` remain and their total is within `maxBytes`. Oldest 50-year ones go first, then the oldest pre-relocation ones; the newest write is never removed. */
export function planPrune(entries: CpEntry[], maxCount = CP_MAX_COUNT, maxBytes = CP_MAX_BYTES, current?: Identity | null): string[] {
  if (!entries.length) return [];
  if (current !== undefined) {   // Stage 30A: per-world limits; worlds beyond CP_WORLDS_MAX go oldest first
    const wids = [...new Set(entries.map((e) => e.wid ?? "?"))], last = (w: string) => Math.max(...entries.filter((e) => (e.wid ?? "?") === w).map((e) => e.savedAt));
    const drop = wids.filter((w) => w !== current?.wid).sort((a, b) => last(a) - last(b)).slice(0, Math.max(0, wids.length - CP_WORLDS_MAX)), out: string[] = entries.filter((e) => drop.includes(e.wid ?? "?")).map((e) => e.key);
    for (const w of wids.filter((x) => !drop.includes(x))) { const mine = entries.filter((e) => (e.wid ?? "?") === w);
      // entries outside the current game's history (other branches) go before the ones inside it
      const off = (e: CpEntry) => current && w === current.wid && !inHistory(e, current) ? 0 : 1;
      out.push(...planPruneWorld(mine, maxCount, maxBytes, off)); }
    return out;
  }
  return planPruneWorld(entries, maxCount, maxBytes, () => 1);
}
function planPruneWorld(entries: CpEntry[], maxCount: number, maxBytes: number, rank: (e: CpEntry) => number): string[] {
  if (!entries.length) return [];
  const newest = entries.reduce((a, b) => (b.savedAt >= a.savedAt ? b : a)), order = [...entries.filter((e) => e.kind === "50y").sort((a, b) => rank(a) - rank(b) || a.year - b.year), ...entries.filter((e) => e.kind === "reloc").sort((a, b) => rank(a) - rank(b) || a.year - b.year)].filter((e) => e.key !== newest.key).sort((a, b) => rank(a) - rank(b));
  let count = entries.length, bytes = entries.reduce((s, e) => s + e.bytes, 0); const out: string[] = [];
  for (const e of order) { if (count <= maxCount && bytes <= maxBytes) break; out.push(e.key); count--; bytes -= e.bytes; }
  return out;
}

async function pipe(data: Uint8Array | string, T: typeof CompressionStream | typeof DecompressionStream, format: "gzip"): Promise<Uint8Array> {
  const src = typeof data === "string" ? new TextEncoder().encode(data) : data, stream = new Blob([src as BlobPart]).stream().pipeThrough(new T(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
/** gzip when the browser can (a save is ~10x smaller), plain text when it cannot. */
export async function encodeSave(json: string): Promise<{ data: Uint8Array | string; gz: boolean }> {
  if (typeof CompressionStream === "undefined") return { data: json, gz: false };
  try { return { data: await pipe(json, CompressionStream, "gzip"), gz: true }; } catch { return { data: json, gz: false }; }
}
export async function decodeSave(data: Uint8Array | string, gz: boolean): Promise<string> {
  if (typeof data === "string") return data;
  if (!gz) return new TextDecoder().decode(data);
  return new TextDecoder().decode(await pipe(data, DecompressionStream, "gzip"));
}
const bytesOf = (d: Uint8Array | string) => (typeof d === "string" ? d.length * 2 : d.byteLength);

export async function readIndex(store: CpStore): Promise<CpEntry[]> {
  const raw = await store.get(CP_INDEX); if (raw === undefined) return [];
  const j = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
  return Array.isArray(j) ? (j as CpEntry[]).filter((e) => e && typeof e.key === "string" && e.key.startsWith(CP_PREFIX) && (e.wid === undefined || typeof e.wid === "string") && (e.tl === undefined || typeof e.tl === "string") && Number.isInteger(e.year) && (e.kind === "50y" || e.kind === "reloc") && typeof e.bytes === "number") : [];
}
/**
 * Writes one checkpoint. Order matters for safety: the new blob first, then the index that names it, and only then the deletions the prune rule asks for -- a failure at any step leaves every earlier checkpoint
 * listed and readable. `json` is the already-serialised save (serialised by the caller in the same breath as marking, so the saved game is the one at the boundary). Never throws.
 */
export async function writeCheckpoint(store: CpStore, json: string, due: CpDue, meta: { capital: string; sub: string; id?: Identity | null }, now = Date.now()): Promise<{ ok: true; entry: CpEntry; pruned: string[] } | { ok: false; error: string }> {
  try {
    const index = await readIndex(store);   // (a failed read aborts here: an index must never be rewritten from a guess)
    const enc = await encodeSave(json), key = cpKey(due, meta.id ?? undefined), entry: CpEntry = { v: 2, ...(meta.id ? { wid: meta.id.wid, tl: meta.id.tl } : {}), key, year: due.year, kind: due.kind, ...(due.n ? { n: due.n } : {}), bytes: bytesOf(enc.data), gz: enc.gz, savedAt: now, capital: meta.capital, sub: meta.sub };
    await store.put(key, enc.data);
    const next = [...index.filter((e) => e.key !== key), entry], pruned = planPrune(next, CP_MAX_COUNT, CP_MAX_BYTES, meta.id ?? null);
    const kept = next.filter((e) => !pruned.includes(e.key));
    await store.put(CP_INDEX, JSON.stringify(kept));
    // Stage 29: success is announced only after the write is READ BACK -- the blob is there at the size written and the index names it. A store that accepts a put and loses it is a failure, not a save.
    const back = await store.get(key), listed = (await readIndex(store)).some((e) => e.key === key && e.year === due.year);
    if (back === undefined || bytesOf(back) !== entry.bytes || !listed) { try { await store.put(CP_INDEX, JSON.stringify(index)); } catch { /* the earlier index stays as it was if this also fails */ } return { ok: false, error: "書き込みを確認できませんでした" }; }
    for (const k of pruned) { try { await store.del(k); } catch { /* a blob left behind is harmless: it is no longer listed */ } }
    return { ok: true, entry, pruned };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message || e.name : String(e) }; }
}
export const listCheckpoints = async (store: CpStore): Promise<CpEntry[]> => { try { return (await readIndex(store)).sort((a, b) => b.year - a.year || b.savedAt - a.savedAt); } catch { return []; } };
/** The saved game's JSON text, or null if it cannot be read. */
export async function readCheckpoint(store: CpStore, e: CpEntry): Promise<string | null> { try { const d = await store.get(e.key); return d === undefined ? null : await decodeSave(d, e.gz); } catch { return null; } }
