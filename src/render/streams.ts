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
