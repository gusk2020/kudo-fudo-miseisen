/** Binary min-heap of (key, value) pairs backed by typed arrays; ties break on insertion order for determinism. */
export class MinHeap {
  private k: Float64Array; private v: Int32Array; private s: Float64Array; private n = 0; private seq = 0;
  constructor(cap = 1024) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.s = new Float64Array(cap); }
  get size() { return this.n; }
  private less(a: number, b: number) { return this.k[a] < this.k[b] || (this.k[a] === this.k[b] && this.s[a] < this.s[b]); }
  private swap(a: number, b: number) {
    const tk = this.k[a], tv = this.v[a], ts = this.s[a];
    this.k[a] = this.k[b]; this.v[a] = this.v[b]; this.s[a] = this.s[b];
    this.k[b] = tk; this.v[b] = tv; this.s[b] = ts;
  }
  push(key: number, val: number) {
    if (this.n === this.k.length) {
      const nk = new Float64Array(this.n * 2), nv = new Int32Array(this.n * 2), ns = new Float64Array(this.n * 2);
      nk.set(this.k); nv.set(this.v); ns.set(this.s); this.k = nk; this.v = nv; this.s = ns;
    }
    let i = this.n++; this.k[i] = key; this.v[i] = val; this.s[i] = this.seq++;
    while (i > 0) { const p = (i - 1) >> 1; if (this.less(i, p)) { this.swap(i, p); i = p; } else break; }
  }
  pop(): { key: number; val: number } {
    const key = this.k[0], val = this.v[0]; this.n--;
    if (this.n > 0) {
      this.k[0] = this.k[this.n]; this.v[0] = this.v[this.n]; this.s[0] = this.s[this.n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < this.n && this.less(l, m)) m = l;
        if (r < this.n && this.less(r, m)) m = r;
        if (m === i) break; this.swap(i, m); i = m;
      }
    }
    return { key, val };
  }
}
