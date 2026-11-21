# Stage 43 — overhaul after the 4800-year playtest (Draft; not published)

Branch `claude/s43-overhaul`, based on the published Stage 42 trial (`claude/s42-playtest-package` = PR #98 head `163f079`), with PR #96 (樺太) and PR #99 (千島) merged in (the original branches/PRs are untouched). PR #93's Fuji population fix is NOT included (the 「バカボンモード」 behaviour stays). main, Pages, the Stage 41 / Stage 42 sites and saves are not touched.

**Every rule that changes how a game develops is gated by `sim.s43`** (set only for new 1800-start games, next to `trunk42` / `north41`). Older saves keep their rules exactly. Display-only changes (layers, night colours, speed panel, top line) apply to everyone.

## The root cause found first (A)
The 1800-start games (Issue #86 era lists) never had `pot17.c18`, so `stance18()` returned null for them: **none of the 空路重視 / 海路重視 rules ever applied** — no water-tunnel limit, no railway restraint, no airport/port appetite shift. The owner's 空路重視・地方分散 game therefore built bridges, tunnels and railways like every other world. Measured on the probe: `stance18` = null under 空路重視 before, `"air"` after. Fix: `stance18` also answers for `sim.s43` games (policy18.ts).

## A1 — fixed links follow the policy
- `islandlink37.ts`: under 空路重視/海路重視 an island link uses the "realistic" drive with no boom/dispersal multipliers (perYear 1, at most 1 at a time, bar ×8), and an island that already has an airport or a port of its own is linked only across ≤4 km (its airport/port is its link).
- `crossing.ts`: replacing a ferry by a bridge/tunnel is ×0.3 as eager under 空路重視 (×0.5 under 海路重視). Road/rail/balanced worlds are unchanged.
- Nothing built is removed; a running project keeps going.

## A2 — mountain corridors (`corridor43.ts`)
A NEW road (new line, bypass, shortcut) whose new part runs through mountains (≥500 m) counts the separate roads crossing transects (±22 km, every 3 cells) of its mountain stretch; at a median of 3 the corridor is full: no new road (a bypass becomes an improvement). An expressway may be the one more where the corridor has none. Plains are never checked; upgrades/restoration are never blocked.

## A3/A5 — airports and flights (`hubs.ts`)
- Airport spacing 60 km (a city of 3 M may have its own at 45 km); an island without an airport may have one at 25 km. (A first try at 80 km cut airports and flights below the old rules — 56 vs 81 airports at 4800 — so it was loosened.)
- `remoteAirports`: a place ≥90 km from every airport with 12,000 people (an island without an airport: 5,000) gets one, remotest first, an island counting double; two a year under 空路重視 or 地方分散.
- An airport no route reaches gets a LOCAL route to its best pair (threshold 120, or 40 for an island/remote one) instead of the trunk threshold 300; `HubRoute.local`.
- **Audit (A5)**: internally every airport already had flights in the old rules too (2200: 62 of 62 airports with a route, 245 domestic flights) — the map showed at most 30 (14 nationwide, 8 light). The "airports without flights" were a DRAWING limit, not a missing network. Now drawn by tier with their own budgets (trunk 40/80, local 40/120; light 12/10); `r.roads.airDrawn` reports drawn vs open.

## A3 follow-up — two demand bugs found by the trial check (fixed, new Stage 43 games only)
The /stage43/ feature check (`tools/stage43-trial-check.mjs`) found 11 of 56 airports without a flight at 2000 and the lifeline rule opening **0** routes. Three causes, all fixed for `sim.s43` games only:
1. **The lifeline rule counted unopened pairs as served** (`hubs.ts`). Any pair in the wish list, even one below its threshold, and suspended routes made an airport look served. Now only an open domestic flight, or one that opens this year, counts.
2. **An airport pair's demand was overwritten, not summed** (`demand.ts`, pre-existing). The last city pair counted replaced the rest, so an airport serving many towns showed one town's demand. Older games keep the old behaviour.
3. **Towns with no land link had no flight demand at all** (`demand.ts`, pre-existing). Examples: 樺太, islands without a ferry. Now such a pair is a flight: about 2 h of access plus the distance at 500 km/h. It counts only where the game's own air-share rule allows flying, so the "no scheduled flights before 1920" rule still holds.

Result, seed 7, 空路重視・地方分散:

| year | airports with a flight | airports | domestic flights | fixed links | tunnels |
| --- | --- | --- | --- | --- | --- |
| 2000 | 52 | 52 | 238 | 18 | 6 |
| 2500 | 56 | 56 | 247 | 55 | 13 |

Before these fixes: 2000 had 50 of 52 with a flight (豊原 and 根室 none since 1951) and 2500 had 56 of 56; there were 230 and 241 domestic flights. With demand counted properly, every airport clears the normal threshold, so the lifeline rule rarely has anything left to do; it stays as the safety net. In the browser game (islets, 日本海側) at 2000: **56 of 56** airports with a flight and 276 domestic flights. The earlier figures were 45 and 198.

## B — layers, tiers, night
- Flights: trunk = not opened as local and ≥600/day (thick darker arc), local = the rest (thin pale dashed arc). Sea routes (ferries): trunk ≥300 through/day (thick solid), local (thin dashed). Constants in `style24.ts`.
- Layer window (real game): folding groups 地形 / 交通 / その他; transport has eight rows (高速道路・一般道路・新幹線/リニア・一般鉄道・空路幹線・空路地方・海路幹線・海路地方), each "checkbox · name · sample" drawn from the map's own style constants; states under 交通. Old settings carry over (a whole-mode switch that was off shows its rows off).
- Night view: off the layer window; the moon button toggles it and a vertical grain slider appears under it only while on. All lights are one daylight white (`NIGHT_WHITE` 255,250,244), brightness only.

## E follow-up — three phone-screen faults found through CI (fixed)
The phone-size E2E tests `names67`, `mobile67` and `real.spec` Stage 26 failed on several CI runs of this PR and never on the base. Reproduced locally only with the CI browser (Playwright's headless shell) and 6× CPU throttling: Stage 43 failed, Stage 42 passed. Causes:
1. **The open speed panel grew by a row** (126 → 172 px over the map on a 412×915 screen). The fold button had been added as a row of its own, and the panel then reached the spot where the city card's × sits. The fold button now sits at the end of the speed row: **126 px, exactly as Stage 42**, measured. With this fix the throttled test closes the card with one tap.
2. **A sheet whose content loads asynchronously (保存) was only its padding for a moment.** Its × then sat under the dock. Sheets now keep a minimum height in the real game.
3. **Rebuilding the 保存 sheet emptied it before the new list was read.** That made an empty sheet in between. It now keeps the shown list until the new one replaces it.

## C — decade mode speed
Measured in the browser (Chromium, software GL, Pixel 7 profile), same game from 1950, 30 s: **0.65 → 2.76 game-years per second (×4.2)**. What changed: while the decade mode runs the stage is drawn only when something visible changes (each decade's redraw, a pan or zoom), and 40 ms instead of 26 ms of simulation per frame. **The simulation itself is unchanged** — the same months in the same order, so results are identical to the normal speeds (no approximation, nothing to label). On a phone the drawing share is smaller than in software GL, so the gain will be smaller: **not measured on a Pixel 7a**. Node profile of the simulation (2100–2130, 313 ms/year): demand analysis 27 %, monthly step 15 %, population update 10 %, crossings/island links ~11 %; the next step if more is needed is the demand analysis.

## D — special routes
A new special route need not start at the capital nor end at a sub-capital: a line that passes within 20 km (= `SEAT_NEAR_KM`) of the capital and of a sub-capital (either of two) is enough; the part between them is built as before and the parts outside are added as extensions of the same route in drawing order — one stroke, a line that comes back closes a loop. A line that would run over itself is refused with the one-stroke reason; nothing is built when refused (tried on a copy). `specialDraw41.ts` (`splitFree` / `checkFree` / `performFree`), tests `specialFree43.test.ts`.

## E — phone UI
- E1: the speed panel folds to a chip at the bottom left (「▶ ×5 ▲」/「⏸ 停止中 ▲」); one tap opens it; remembered on the phone (open until first folded). It stays open while a drawing tool / 国道0号 is active.
- E2: while a game runs, the title bar is gone and the information line sits at the top edge; the first pill is the policy in one line 「方針(初期/現在) 空路/鉄道・分散/分散・中立/中立」.
- E3: 均衡 (transport) and 中立 (region) in the simple intervention.

## Measurements (seed 7, 1800 start, capital 東京, automatic; `tests/unit/s43.probe.test.ts`, data `docs/data/s43-*.json`)
OFF = the same code with `sim.s43` removed (= the rules before this change). 空路重視・地方分散 unless noted.

| measure (seed 7) | 2500 OFF | 2500 ON | 4800 OFF | 4800 ON |
| --- | --- | --- | --- | --- |
| fixed links (bridges/tunnels to islands, sea crossings) | 130 (3805 km) | 52 (1323 km) | 134 | 60 |
| of which tunnels | 71 | 15 | 76 | 15 |
| railway km | 6108 | 3307 | 7217 | 4829 |
| mountain road edges with 4+ roads side by side | 6 | 1 | 2 | 1 |

Under 道路重視 (shubun) ON keeps 146 fixed links and under 均衡 (heisei) 141 at 2500 — the policies keep their character.

Airports (seed 7, `docs/data/s43-3000-*-v2.json`):

| year 2000 / 2500 / 3000 | ON | OFF |
| --- | --- | --- |
| airports | 52 / 55 / 56 | 52 / 70 / 73 |
| populated islands with an airport (of 7) | 7 / 7 / 7 | 4 / 5 / 7 |
| towns more than 50 km from an airport | 5 / 1 / 0 | 6 / 2 / 1 |
| domestic flights (all drawn now, by tier) | 171 / 174 / 293 | 210 / 288 / 467 |

Fewer airports (no clusters) but better coverage: islands are served decades earlier and no town is left far away. Fewer domestic flights follow from fewer airport pairs; every airport has at least one flight.

Other seeds, 2500 (`docs/data/s43-2500-*-seeds11-23.json`): seed 11 ON/OFF airports 54/70, islands served 7/5 of 7, fixed links 51/127, tunnels 12/81, rail 2493/6495 km; seed 23 airports 56/69, islands 7/5, fixed links 51/126, tunnels 10/74, rail 3197/6408 km. Same direction on all three seeds.

Decade mode: 0.65 → 2.76 game-years/s in the browser (×4.2, software GL; simulation unchanged, so results are identical, not just similar).

## Checks
- Unit: all pass (see PR). E2E: 107 passed + the 5 that needed updating for the new layer window / top line, re-run and passing. Compat (Stage 41 dist → this build): 16/16.
- Not checked on a Pixel 7a. Not published.

## Known / left open
- Population grows without limit in long runs in BOTH rule sets (pre-existing, not from Stage 43).
- Northern Hokkaido grows only through the remote-airport rule and the north towns (#96/#99); no extra development rule was added.
- 4800-year runs use the earlier 80 km airport spacing (`s43-4800-on-kuuro.json`); the shipped spacing is 60 km (re-measured to 3000).
- Phone speed gain of the decade mode will be smaller than ×4.2 (drawing is a smaller share on a GPU) — measure on the device.
