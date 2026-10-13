import { fetchDem } from "./demLoad";
import { generateTerrain, type TerrainResult } from "./terrain";
import type { ProjectState } from "./types";

/** Runs generation in a Worker (UI stays responsive); a newer request cancels the older one. */
export class TerrainClient {
  private worker: Worker | null = null;
  private reject: ((e: unknown) => void) | null = null;
  constructor(private demUrl: string, private makeWorker?: () => Worker) {}
  cancel() { this.worker?.terminate(); this.worker = null; this.reject?.(new Error("cancelled")); this.reject = null; }
  generate(state: ProjectState, onProgress: (p: number, msg: string) => void): Promise<TerrainResult> {
    this.cancel();
    if (!this.makeWorker) return this.inline(state, onProgress);
    return new Promise((resolve, reject) => {
      let w: Worker;
      try { w = this.makeWorker!(); } catch { this.inline(state, onProgress).then(resolve, reject); return; }
      this.worker = w; this.reject = reject;
      w.onmessage = (e) => {
        if (e.data.type === "progress") onProgress(e.data.p, e.data.msg);
        else if (e.data.type === "done") { this.worker = null; this.reject = null; w.terminate(); resolve(e.data.result); }
        else if (e.data.type === "error") { this.worker = null; this.reject = null; w.terminate(); reject(new Error(e.data.message)); }
      };
      w.onerror = (ev) => { this.worker = null; this.reject = null; reject(new Error(ev.message || "worker error")); };
      w.postMessage({ type: "generate", state, demUrl: this.demUrl });
    });
  }
  private async inline(state: ProjectState, onProgress: (p: number, msg: string) => void) {
    return generateTerrain(state, await fetchDem(this.demUrl), onProgress);
  }
}
