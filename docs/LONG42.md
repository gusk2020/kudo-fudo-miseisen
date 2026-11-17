# Long runs and the decade mode (Issue #88-4/5)

## Decade mode 「10年⏩」 (implemented, `claude/s42-fast`)
- A fifth speed button. Every month is computed in full, in the same order as at any other speed — **the same game, nothing approximated**, so no 「簡略計算」 label is needed. What is dropped: the pacing by the clock (it runs as many months as fit in 26 ms of each frame) and the redrawing between decades (map and top line redrawn at each decade, or every 2.5 s).
- Stops by itself wherever the game waits for the player (policy window, era change, relocation); goes on by itself after the choice. In the automatic modes those decisions are taken as always and keep their 判断直前 save points. Not saved with the game (a reload starts at the speed saved, ×20 at most). Any other speed button switches it off.
- Measured (Chromium, software GL, 412×915): **2.4 game-years per second** vs 0.33 at ×20 (≈7×). Not measured on a Pixel 7a.
- E2E `tests/e2e/turbo88.spec.ts`: stops at the 1810 window, waits, goes on after 「点を使わず決定」; 40 automatic years with every decade's policy window on record and era changes on the way; ×0 stops it.

## Long-run measurement (node, no drawing; `tests/unit/long42.probe.test.ts`, data `docs/data/long42-seed7.json`)
Fully automatic 1800 game, seed 7, per century. The run reached **2800** (1000 years) before a worker restart cut it.
| year | seconds per century | save size | edges | events kept |
|---|---|---|---|---|
| 1900 | 10.7 | 1.4 MB | 1408 | 1050 |
| 2000 | 19.0 | 2.3 MB | 2113 | 1071 |
| 2300 | 25.5 | 2.9 MB | 2557 | 1076 |
| 2600 | 38.8 | 3.6 MB | 2875 | 1099 |
| 2800 | 39.4 | 4.6 MB | 2996 | 1080 |
- 1000 years ≈ **5 minutes in node**; in the browser the decade mode adds little on top (no per-month drawing). A phone is maybe 2–4× slower (estimate, not measured).
- Events are already capped (~1100 kept). The growing parts: `edges` (2.1 MB at 2800, grows with the network), and **`numreg` (the route-number register) which grows faster than anything else: 0.45 MB at 2600 → 0.93 MB at 2700 → 1.27 MB at 2800**. That is the first thing to compact (its per-number history) before 2000-year runs; the save would otherwise pass ~10 MB around 3500 by extrapolation (not measured).
- Not yet audited: number types near year 9999 (years are plain numbers; `month` is a count of months since 1800 — 8 000 years ≈ 96 000, far inside safe integers), IndexedDB quota on Android for saves of 5–10 MB × slots.
