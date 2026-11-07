/** Stage 36: data this version cannot load is listed as 旧版のデータ with a reason, and is never deleted. */
import { expect, test } from "@playwright/test";
test.setTimeout(240000);
test("old data is listed with a reason and kept", async ({ page }) => {
  const errs: string[] = []; page.on("pageerror", (x) => errs.push(String(x)));
  await page.goto("/?nointro"); await page.waitForFunction(() => (window as any).__kfm?.world, null, { timeout: 90000 });
  await page.evaluate(() => new Promise<void>(async (res) => { const name = (await indexedDB.databases()).map((d) => d.name!).find((n) => n.startsWith("kfm-stage1"))!; const r = indexedDB.open(name, 1); r.onsuccess = () => { const t = r.result.transaction("saves", "readwrite"); const s = t.objectStore("saves"); s.put("{ not json", "s3:slot3"); s.put(JSON.stringify({ savedAt: 5, reason: "旧版の地図(49府県)の道路データ", sim: {} }), "s3:auto:quarantine"); t.oncomplete = () => res(); }; }));
  await page.evaluate(() => (window as any).__kfm.openSheet?.("menu"));
  const ok = await page.evaluate(async () => { const a = (window as any).__kfm; const d = document.createElement("div"); await a.buildMenuInner(d); const o = d.querySelector("#old-data"); return o ? o.textContent : null; });
  expect(ok).toContain("旧版のデータ"); expect(ok).toContain("セーブ3"); expect(ok).toContain("49府県");
  const kept = await page.evaluate(async () => { const name = (await indexedDB.databases()).map((d) => d.name!).find((n) => n.startsWith("kfm-stage1"))!; return new Promise<string | undefined>((res) => { const r = indexedDB.open(name, 1); r.onsuccess = () => { const g = r.result.transaction("saves").objectStore("saves").get("s3:slot3"); g.onsuccess = () => res(g.result); }; }); });
  expect(kept).toBe("{ not json"); expect(errs).toEqual([]);
});
