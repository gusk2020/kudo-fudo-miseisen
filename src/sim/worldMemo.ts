/** Stage 34: every memo keyed on a World is made here, so the land changing under a running game (reclamation) can drop them all at once. Kept in a module of its own with no imports, so the many modules that make a memo when they load never wait on a circular import. */
import type { World } from "./world";
const MEMOS: WeakMap<World, unknown>[] = [];
export function worldMemo<V>(): WeakMap<World, V> { const m = new WeakMap<World, V>(); MEMOS.push(m as WeakMap<World, unknown>); return m; }
export function resetWorldCaches(w: World) { for (const m of MEMOS) m.delete(w); }
