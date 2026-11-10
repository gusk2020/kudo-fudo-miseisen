/** Stage 36: a save from before the 1800 start (the live game) is never lost -- a permanent copy is kept the first time it would be overwritten. */
import { expect, test } from "@playwright/test";
test.setTimeout(240000);
const idb = (page: any, f: string, arg?: unknown) => page.evaluate(`(async () => { const name = (await indexedDB.databases()).map((d) => d.name).find((n) => n.startsWith("kfm-stage1")); return new Promise((res) => { const r = indexedDB.open(name, 1); r.onsuccess = () => { const s = r.result.transaction("saves", "readwrite").objectStore("saves"); (${f})(s, res, ${JSON.stringify(arg ?? null)}); }; }); })()`);
test("an older save is copied to :pre-1800 before the new version can overwrite it, and nothing is deleted", async ({ page }) => {
  const errs: string[] = []; page.on("pageerror", (x) => errs.push(String(x)));
  await page.goto("/?nointro"); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 });
  await page.evaluate(() => (window as any).__kfm.persist(true)); await page.waitForTimeout(300);
  await idb(page, "(s, res) => { const g = s.get('s3:auto'); g.onsuccess = () => { const j = JSON.parse(g.result); j.save.sim = { stage3: true, rec34: true, marker: 'live-old-game' }; s.put(JSON.stringify(j), 's3:auto').onsuccess = () => res(1); }; }");
  await page.reload(); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 });
  await page.evaluate(() => (window as any).__kfm.persist(true));
  await page.waitForTimeout(500);
  const kept = await idb(page, "(s, res) => { const g = s.get('s3:auto:pre-1800'); g.onsuccess = () => res(g.result ?? null); }");
  expect(kept).not.toBeNull(); expect(String(kept)).toContain("live-old-game");
  const any = await idb(page, "(s, res) => { const g = s.getAllKeys(); g.onsuccess = () => res(g.result.map(String)); }");
  expect(any.some((k: string) => k.startsWith("s3:auto"))).toBe(true); expect(errs).toEqual([]);
});
