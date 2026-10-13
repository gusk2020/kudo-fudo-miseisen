import { fetchDem } from "./demLoad";
import { generateTerrain } from "./terrain";

let dem: Int16Array | null = null;
self.onmessage = async (e: MessageEvent) => {
  if (e.data.type !== "generate") return;
  try {
    if (!dem) dem = await fetchDem(e.data.demUrl);
    const result = generateTerrain(e.data.state, dem, (p, msg) => (self as any).postMessage({ type: "progress", p, msg }));
    const r: any = result;
    (self as any).postMessage({ type: "done", result }, [r.land.buffer, r.island.buffer, r.elev.buffer, r.pref.buffer, r.plains.buffer, r.ridge.buffer, r.streams.buffer, r.borders.buffer]);
  } catch (err: any) { (self as any).postMessage({ type: "error", message: String(err?.message ?? err) }); }
};
