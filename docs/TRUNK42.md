# Capital ↔ sub-capital in all four modes (Issue #88, last request) — measurement; builder NOT yet implemented

`src/sim/trunk42.ts` `trunkStatus(sim, w)`: per capital/sub-capital pair, is there a way by road, rail, sea (land access to a port, ports joined by domestic sea routes), air (same with airports)? Pure, no game change.
Probe: `tests/unit/trunk42.probe.test.ts` (only with `KFM_TRUNK=<file>`). Data: `docs/data/trunk42-baseline.json` (seed 7; 東京–大阪 and 東京–札幌; five policies; 1850/1900/1950/2000/2050). The run was cut by a worker restart after 36 rows (heisei, shubun, shoka complete; kairo partial; kuuro missing) — rerun to complete it.

## What the measurement shows (seed 7, an 1800 game)
| | road | rail | sea | air |
|---|---|---|---|---|
| 東京–大阪, 均衡 / 鉄道重視 | from the start | **only by 2000** | from the start | by 2000 |
| 東京–大阪, 道路重視 / 海路重視 | from the start | **not even in 2050** | from the start | by 2000 |
| 東京–札幌, every policy measured | from the start (ferry) | **never (to 2050)** | from the start | by 2000 |
Reading: road and sea are always there; air comes with the airports (after 1950); **rail is the gap** — under road/sea priority the trunk railway between capital and sub-capital is never completed, and across the 津軽 strait it never comes under any policy measured. That is exactly the "道路重視だから鉄道が途絶" the owner asked to avoid.

## Design of the builder (to implement next; not started)
- Once a year, for each pair and mode that `trunkStatus` reports missing, and only if the technology of that mode exists that year (rail from the railway era; air from the airport era; tunnels/bridges within `techAt` and the sea/air-priority cap of #7):
  - **rail**: find the gap between the two seats' rail components (the nearest pair of rail nodes of the two components, or the seat city itself) and give that candidate the planner's highest priority for ONE project at a time, at normal cost and duration (no free building). A strait gap uses the existing strait-link candidate (`crossing.ts`) or, while none can be built, a train ferry/sea route (counts as the multi-modal way the owner allowed).
  - **sea / air**: if a seat has no port/airport reachable by land, raise that city's port/airport demand in `hubs.ts`; if ports/airports exist on both sides but no route joins them, open a domestic route between the two best ones.
  - **road**: already always present; keep as a check.
- Policy keeps its weight everywhere else: the duty only fixes the ONE missing link per mode for these pairs; quality, speed and volume stay policy-driven.
- Acceptance: by 2000 every pair connected in all four modes for every policy and 3 seeds; no new link before its technology; Issue #66 rail audit numbers re-run.

## Builder, first part (2026-11-17, second session): the RAIL duty — implemented (`claude/s42-terrain91`)
- Games made with `sim.trunk42` (new 1800 games). While capital and sub-capital are not joined by railway, `planRailGen` gets one extra candidate (`trunkRailLeg`): the next leg from the capital's side of the rail network towards the sub-capital (≤160 km, same island), tagged `【首都幹線】`, score 60 (ahead of ordinary candidates), its own quota (one leg at a time), not switched off by `railBuild` or the sea/air hold. It still goes through path, technology and cost checks; its purse is at least 10 % of the national budget (so a road-first policy cannot starve it — it is still paid for).
- On the way, rail track that lies there closed/dormant/abandoned is **restored first** (one restore project) — the real cause of the old gap was a closed section (the path found "0 km new" yet the network was cut).
- Seats on another island: rail to the ports joined by a domestic sea route counts (rail + ship + rail), and the legs aim at those ports. The measure (`trunkStatus`) counts that as a rail way when the seats are on different islands.
- Measured (`docs/data/trunk42-after.json`, seeds 7 and 11, five policies): **東京–大阪 joined by rail by 2000 under every policy and seed** (by 1950 in 8 of 10; before: never under road/sea priority). Air by 2000 everywhere, road and sea always.
- **Still open**: 東京–札幌 has no rail way in any run (no rail+ship way formed: either the Hokkaido line does not reach a port with a route to a Honshu port reached by rail — not diagnosed yet). Sea and air duties not implemented (they were already connected in every run measured, except air before ~1950–2000 when airports did not exist).
- Unit test `tests/unit/trunk42.test.ts`: road-first policy joined by 1900 with the duty and not without; no trunk project before that game's own railway service year.
