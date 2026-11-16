# Stage 41 #2: night view (夜景モード)

Status: implemented; unit + Chromium-emulation E2E pass. **Not verified on a real Pixel 7a** (performance and look on the real GPU are unknown; software-renderer cost of one light update: ~11 ms).

## What the player sees
- A moon button (☾) at the right end of the title bar, and a checkbox in レイヤー. On/off at any time; remembered on the phone (`localStorage`), never saved in the game.
- On: the map goes dark; the road/rail drawing is hidden (data and tap hit-testing untouched, city cards still open); labels stay. Lights are drawn as one additive sprite.
- 1800 start: completely dark (electrification 0 until 1850). ~1900 faint scatter around cities, 1950 corridors visible, 2000 clear: metropolises blaze, the 東海道 belt and trunk lines glow, Hokkaido/Tohoku stay sparse as the simulation made them.

## What shines (src/sim/night41.ts, pure function of the game)
- City: log-scale population (`lightOf`: 500 people = 0, 12 M = 1) ^1.4 × work (city12 migration advantage) × small port/airport factor; glow radius grows with size. Declining cities dim (tested).
- Settlements (villages/towns): faint scatter.
- Roads/railways: only **in service** (open, built, not lost, not a ferry), by log traffic (through+local) relative to the busiest edge × size of the places joined. Closed/dormant/lost/unbuilt/planned = dark (tested). Empty roads between tiny places ≈ dark.
- Sea routes and air routes are never lit (ferry edges skipped); ports/airports only through their city.
- `electrification(year)` = ((year-1850)/150)^2.2 → 0.09 in 1900, 0.41 in 1950, 1 from 2000. This curve is a **design choice**, not fitted to history.
- Tone: 1 - exp(-1.9 x); sea cells always 0.

## Cost / safety
- Light recomputed on switch-on, then once per game year or when the number of lines/airports changes; not per frame. Display only: sim state, saves, terrain, coastlines unchanged (E2E checks the sim keeps running state).
- Light colour: warm orange → amber → pale white (`nightColour`).

## Not done / open
- No real-device check; the 0.9-alpha dark sheet may need tuning on the Pixel 7a's screen brightness.
- No time-lapse; no per-city "light-out" events beyond what pop/edge state already gives.
- Electrification does not yet depend on the era stance or on the simulated power policy (none exists).
