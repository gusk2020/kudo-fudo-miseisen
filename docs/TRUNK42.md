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
