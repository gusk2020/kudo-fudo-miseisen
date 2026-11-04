import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("storage namespace (playtest builds must not share saves with the real game)", () => {
  it("without VITE_SAVE_NS every name is exactly what it always was", async () => {
    const m = await import("../../src/core/ns"); expect(m.SAVE_NS).toBe(""); expect(m.dbName("kfm-stage1")).toBe("kfm-stage1"); expect(m.lsKey("bg")).toBe("kfm.bg"); expect(m.lsKey("run")).toBe("kfm.run");
  });
  it("with it, the database and every localStorage key are renamed together, and odd characters are dropped", async () => {
    const { vi } = await import("vitest"); vi.stubEnv("VITE_SAVE_NS", "play test/1"); vi.resetModules();
    const m = await import("../../src/core/ns"); expect(m.SAVE_NS).toBe("playtest1"); expect(m.dbName("kfm-stage1")).toBe("kfm-stage1-playtest1"); expect(m.lsKey("bg")).toBe("kfm-playtest1.bg"); vi.unstubAllEnvs(); vi.resetModules();
  });
  it("no storage name is written out literally anywhere else in the app (so none can be missed)", () => {
    const files = ["src/ui/app.ts", "src/core/save.ts", "src/core/save2.ts", "src/main.ts"];
    for (const f of files) { const t = readFileSync(f, "utf8"); expect(t.match(/["']kfm\.\w+["']/g), f).toBeNull(); expect(t.match(/["']kfm-stage1["']/g)?.length ?? 0, f).toBeLessThanOrEqual(f === "src/core/save.ts" || f === "src/core/save2.ts" ? 1 : 0); }
  });
});
