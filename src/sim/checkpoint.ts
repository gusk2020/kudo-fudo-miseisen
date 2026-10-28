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
export interface CpEntry { /** 2 = taken after the relocation event (Stage 27); absent = taken just before it (Stage 26) */ v?: number; key: string; year: number; kind: CpKind; n?: number; bytes: number; gz: boolean; savedAt: number; capital: string; sub: string }
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

export const cpKey = (d: CpDue) => `${CP_PREFIX}${d.year}:${d.kind}`;
/** Which stored checkpoints to delete so that at most `maxCount` remain and their total is within `maxBytes`. Oldest 50-year ones go first, then the oldest pre-relocation ones; the newest write is never removed. */
export function planPrune(entries: CpEntry[], maxCount = CP_MAX_COUNT, maxBytes = CP_MAX_BYTES): string[] {
  if (!entries.length) return [];
  const newest = entries.reduce((a, b) => (b.savedAt >= a.savedAt ? b : a)), order = [...entries.filter((e) => e.kind === "50y").sort((a, b) => a.year - b.year), ...entries.filter((e) => e.kind === "reloc").sort((a, b) => a.year - b.year)].filter((e) => e.key !== newest.key);
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
  return Array.isArray(j) ? (j as CpEntry[]).filter((e) => e && typeof e.key === "string" && e.key.startsWith(CP_PREFIX) && Number.isInteger(e.year) && (e.kind === "50y" || e.kind === "reloc") && typeof e.bytes === "number") : [];
}
/**
 * Writes one checkpoint. Order matters for safety: the new blob first, then the index that names it, and only then the deletions the prune rule asks for -- a failure at any step leaves every earlier checkpoint
 * listed and readable. `json` is the already-serialised save (serialised by the caller in the same breath as marking, so the saved game is the one at the boundary). Never throws.
 */
export async function writeCheckpoint(store: CpStore, json: string, due: CpDue, meta: { capital: string; sub: string }, now = Date.now()): Promise<{ ok: true; entry: CpEntry; pruned: string[] } | { ok: false; error: string }> {
  try {
    const index = await readIndex(store);   // (a failed read aborts here: an index must never be rewritten from a guess)
    const enc = await encodeSave(json), key = cpKey(due), entry: CpEntry = { v: 2, key, year: due.year, kind: due.kind, ...(due.n ? { n: due.n } : {}), bytes: bytesOf(enc.data), gz: enc.gz, savedAt: now, capital: meta.capital, sub: meta.sub };
    await store.put(key, enc.data);
    const next = [...index.filter((e) => e.key !== key), entry], pruned = planPrune(next);
    const kept = next.filter((e) => !pruned.includes(e.key));
    await store.put(CP_INDEX, JSON.stringify(kept));
    for (const k of pruned) { try { await store.del(k); } catch { /* a blob left behind is harmless: it is no longer listed */ } }
    return { ok: true, entry, pruned };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message || e.name : String(e) }; }
}
export const listCheckpoints = async (store: CpStore): Promise<CpEntry[]> => { try { return (await readIndex(store)).sort((a, b) => b.year - a.year || b.savedAt - a.savedAt); } catch { return []; } };
/** The saved game's JSON text, or null if it cannot be read. */
export async function readCheckpoint(store: CpStore, e: CpEntry): Promise<string | null> { try { const d = await store.get(e.key); return d === undefined ? null : await decodeSave(d, e.gz); } catch { return null; } }
