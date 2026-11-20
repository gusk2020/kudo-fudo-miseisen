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
A NEW road (new line, bypass, shortcut) whose new part runs through mountains (≥500 m) counts the separate roads crossing transects (±12 km, every 3 cells) of its mountain stretch; at a median of 3 the corridor is full: no new road (a bypass becomes an improvement). An expressway may be the one more where the corridor has none. Plains are never checked; upgrades/restoration are never blocked.

## A3/A5 — airports and flights (`hubs.ts`)
- Airport spacing 80 km (a city of 3 M may have its own at 40 km); an island without an airport may have one at 25 km.
- `remoteAirports`: a place ≥110 km from every airport with 15,000 people (an island without an airport: 5,000) gets one, remotest first, an island counting double; two a year under 空路重視 or 地方分散.
- An airport no route reaches gets a LOCAL route to its best pair (threshold 120, or 40 for an island/remote one) instead of the trunk threshold 300; `HubRoute.local`.
- **Audit (A5)**: internally every airport already had flights in the old rules too (2200: 62 of 62 airports with a route, 245 domestic flights) — the map showed at most 30 (14 nationwide, 8 light). The "airports without flights" were a DRAWING limit, not a missing network. Now drawn by tier with their own budgets (trunk 40/80, local 40/120; light 12/10); `r.roads.airDrawn` reports drawn vs open.

## B — layers, tiers, night
- Flights: trunk = not opened as local and ≥600/day (thick darker arc), local = the rest (thin pale dashed arc). Sea routes (ferries): trunk ≥300 through/day (thick solid), local (thin dashed). Constants in `style24.ts`.
- Layer window (real game): folding groups 地形 / 交通 / その他; transport has eight rows (高速道路・一般道路・新幹線/リニア・一般鉄道・空路幹線・空路地方・海路幹線・海路地方), each "checkbox · name · sample" drawn from the map's own style constants; states under 交通. Old settings carry over (a whole-mode switch that was off shows its rows off).
- Night view: off the layer window; the moon button toggles it and a vertical grain slider appears under it only while on. All lights are one daylight white (`NIGHT_WHITE` 255,250,244), brightness only.

## C — decade mode speed
Measured in the browser (Chromium, software GL, Pixel 7 profile), same game from 1950, 30 s: **0.65 → 2.76 game-years per second (×4.2)**. What changed: while the decade mode runs the stage is drawn only when something visible changes (each decade's redraw, a pan or zoom), and 40 ms instead of 26 ms of simulation per frame. **The simulation itself is unchanged** — the same months in the same order, so results are identical to the normal speeds (no approximation, nothing to label). On a phone the drawing share is smaller than in software GL, so the gain will be smaller: **not measured on a Pixel 7a**. Node profile of the simulation (2100–2130, 313 ms/year): demand analysis 27 %, monthly step 15 %, population update 10 %, crossings/island links ~11 %; the next step if more is needed is the demand analysis.

## D — special routes
A new special route need not start at the capital nor end at a sub-capital: a line that passes within 20 km (= `SEAT_NEAR_KM`) of the capital and of a sub-capital (either of two) is enough; the part between them is built as before and the parts outside are added as extensions of the same route in drawing order — one stroke, a line that comes back closes a loop. A line that would run over itself is refused with the one-stroke reason; nothing is built when refused (tried on a copy). `specialDraw41.ts` (`splitFree` / `checkFree` / `performFree`), tests `specialFree43.test.ts`.

## E — phone UI
- E1: the speed panel folds to a chip at the bottom left (「▶ ×5 ▲」/「⏸ 停止中 ▲」); one tap opens it; remembered on the phone (open until first folded). It stays open while a drawing tool / 国道0号 is active.
- E2: while a game runs, the title bar is gone and the information line sits at the top edge; the first pill is the policy in one line 「方針(初期/現在) 空路/鉄道・分散/分散・中立/中立」.
- E3: 均衡 (transport) and 中立 (region) in the simple intervention.

## Measurements (seed 7, 1800 start, capital 東京, automatic; `tests/unit/s43.probe.test.ts`, data `docs/data/s43-*.json`)
See the table at the end (filled from the data files).
