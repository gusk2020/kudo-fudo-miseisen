import { expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
/**
 * Stage 42 trial isolation: GitHub Pages gives every project site of one account the same origin, so a preview build (VITE_SAVE_NS) shares IndexedDB and localStorage with the real game
 * unless EVERY name goes through core/ns.ts (dbName / lsKey). Found by reading the code: one key (`kfm.polSimple`) was written bare. This guards against another one.
 */
const files = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : []; });
it("no browser-storage name is written as a bare string literal (all go through lsKey / dbName)", () => {
  const bad: string[] = [];
  for (const f of files("src")) { if (f.endsWith("core/ns.ts")) continue; const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:localStorage|sessionStorage)\s*\.\s*(?:getItem|setItem|removeItem)\(\s*(["'`])/g)) bad.push(`${f}: ${m[0]}`);
    for (const m of src.matchAll(/indexedDB\s*\.\s*open\(\s*(["'`])/g)) bad.push(`${f}: ${m[0]}`);
    for (const m of src.matchAll(/(?:localStorage|sessionStorage)\s*\[\s*(["'`])/g)) bad.push(`${f}: ${m[0]}`); }
  expect(bad, "bare storage names would be shared with the real game on the same origin").toEqual([]);
});
it("the namespace functions leave the normal build's names exactly as they were", async () => {
  const { dbName, lsKey, SAVE_NS } = await import("../../src/core/ns");
  expect(SAVE_NS, "unit tests run without VITE_SAVE_NS").toBe(""); expect(dbName("kfm-stage1")).toBe("kfm-stage1"); expect(lsKey("polSimple")).toBe("kfm.polSimple");
});
