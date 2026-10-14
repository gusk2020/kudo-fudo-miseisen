import { stepMonthGen } from "./engine";
import type { SimState } from "./types";
import type { World } from "./world";

/**
 * Drives the simulation in short slices. Each `pump` runs atoms of the month generator until its time budget is spent,
 * so the main thread is never held for a whole simulated year (the cause of the freezes in Issue #7).
 * The sequence of operations is identical to running the months straight through, so determinism is unaffected.
 */
export class SimRunner {
  private gen: Generator<void> | null = null; private m0 = 0; pending = 0; dropped = 0;
  constructor(public sim: SimState, public w: World) {}
  /** Ask for more months. Anything beyond `cap` is dropped (the clock falls behind instead of building a backlog). */
  request(n: number, cap = 24) { const want = this.pending + n; if (want > cap) { this.dropped += want - cap; this.pending = cap; } else this.pending = want; }
  get idle() { return this.gen === null; }
  /** Run until `budgetMs` has elapsed; returns the number of months completed. */
  pump(budgetMs: number): number {
    const t0 = performance.now(); let done = 0;
    while (performance.now() - t0 < budgetMs) {
      if (!this.gen) { if (this.pending <= 0) break; if (this.sim.policy?.pending) { this.pending = 0; break; } this.pending--; this.m0 = this.sim.month; this.gen = stepMonthGen(this.sim, this.w); }
      if (this.gen.next().done) { this.gen = null; if (this.sim.month !== this.m0) done++; else { this.pending = 0; break; } }   // a month that did not advance was blocked at a policy window
    }
    return done;
  }
  /** Finish the month in progress so the state is consistent (before saving). */
  settle() { if (this.gen) { while (!this.gen.next().done); this.gen = null; } }
}
