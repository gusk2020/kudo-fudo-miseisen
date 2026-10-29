/**
 * Stage 26: river fragments. The terrain's stream list (flow lines from the DEM, [x1 y1 x2 y2 weight] per 5 km cell step) holds a few pieces that connect to nothing -- a 5 or 10 km stub ending at the coast
 * (one sits on the 日向灘 coast between 宮崎 and 大分). Drawn, they read as a stray blue line. Pieces whose whole connected stream is shorter than `minKm` are not drawn; nothing else changes, and the data is untouched.
 */
export function streamKeep(streams: ArrayLike<number>, minKm = 30): boolean[] {
  const n = Math.floor(streams.length / 5), par = Array.from({ length: n }, (_, i) => i), at = new Map<string, number>();
  const find = (x: number): number => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; }, key = (x: number, y: number) => `${Math.round(x * 10)},${Math.round(y * 10)}`;
  for (let i = 0; i < n; i++) for (const k of [key(streams[5 * i], streams[5 * i + 1]), key(streams[5 * i + 2], streams[5 * i + 3])]) { const j = at.get(k); if (j === undefined) at.set(k, i); else par[find(i)] = find(j); }
  const len = new Map<number, number>(); for (let i = 0; i < n; i++) { const r = find(i); len.set(r, (len.get(r) ?? 0) + Math.hypot(streams[5 * i] - streams[5 * i + 2], streams[5 * i + 1] - streams[5 * i + 3])); }
  return Array.from({ length: n }, (_, i) => (len.get(find(i)) ?? 0) >= minKm);
}

/**
 * Stage 29: the river pieces ([x1 y1 x2 y2 weight] per 5 km step) joined end to end into longer lines, each a list of points, so a river can be drawn as one smooth curve instead of a string of separate
 * straight bits (a stair of 5 km steps). A piece's end is the next piece's start; a line stops where it meets one already taken. `keep` is the same filter as `streamKeep`.
 * The order of the points is the flow's; nothing is added or moved, only joined.
 */
export function streamChains(streams: ArrayLike<number>, keep: boolean[]): { pts: number[]; w: number }[] {
  const n = Math.floor(streams.length / 5), key = (x: number, y: number) => `${Math.round(x * 10)},${Math.round(y * 10)}`, startAt = new Map<string, number[]>(), isEnd = new Set<string>();
  for (let i = 0; i < n; i++) { if (!keep[i]) continue; const k = key(streams[5 * i], streams[5 * i + 1]); (startAt.get(k) ?? startAt.set(k, []).get(k)!).push(i); isEnd.add(key(streams[5 * i + 2], streams[5 * i + 3])); }
  const used = new Uint8Array(n), out: { pts: number[]; w: number }[] = [];
  const run = (first: number) => {
    const pts = [streams[5 * first], streams[5 * first + 1]]; let i = first, w = streams[5 * first + 4];
    for (;;) {
      used[i] = 1; pts.push(streams[5 * i + 2], streams[5 * i + 3]); w = Math.max(w, streams[5 * i + 4]);
      const nx = (startAt.get(key(streams[5 * i + 2], streams[5 * i + 3])) ?? []).find((j) => !used[j]); if (nx === undefined) break; i = nx;
    }
    out.push({ pts, w });
  };
  for (let i = 0; i < n; i++) if (keep[i] && !used[i] && !isEnd.has(key(streams[5 * i], streams[5 * i + 1]))) run(i);   // headwaters first
  for (let i = 0; i < n; i++) if (keep[i] && !used[i]) run(i);                                                        // whatever is left (loops, the rest of a branch)
  return out;
}
/** One round of corner cutting (Chaikin): the ends stay where they are, the corners are rounded. */
export function smoothLine(pts: number[], rounds = 2): number[] {
  let p = pts; for (let r = 0; r < rounds; r++) { if (p.length < 6) return p; const o = [p[0], p[1]]; for (let i = 0; i + 3 < p.length; i += 2) { const x0 = p[i], y0 = p[i + 1], x1 = p[i + 2], y1 = p[i + 3]; o.push(0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1, 0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1); } o.push(p[p.length - 2], p[p.length - 1]); p = o; }
  return p;
}
