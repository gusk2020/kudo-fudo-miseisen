# Stage 30A

## A. Autosave checkpoints by world and timeline
- A new game gets `sim.wid` (world) and `sim.tl` (timeline) once (`ensureIdentity`); saves carry them (validated in `sanitizeSim`), so numbered slots restore identity.
- Checkpoint keys/entries include wid+tl (`s3:cp:<wid>:<tl>:<year>:<kind>`): same-year checkpoints of different worlds no longer overwrite each other.
- The menu lists only the current game's history (`inHistory`): its own timeline plus ancestors up to the year it left them. Legacy (id-less) entries are never mixed in; they sit in a folded "出所不明の旧データ" group. A legacy save loaded becomes a world of its own.
- Branching: loading a save earlier than a later checkpoint of the same timeline starts a new timeline (`assignBranch`, `anc` = parent timelines + branch year). Nothing is deleted by branching.
- Capacity: per world 8 entries / 48 MB over all its timelines (entries outside the current history go first, then oldest 50-year, then oldest relocation; the newest is kept); across worlds at most 4 worlds (least recently written goes whole). Write read-back verification and failure notice unchanged.
- Cadence unchanged (50 years, right after relocation). `adopt` still zeroes `lastWallMs` (no catch-up after a load).

## B. Mountain ranges (`src/core/ranges.ts`)
Ten ranges, rough crest lines: 日高山脈(北海道) 奥羽山脈(東北) 関東山地(関東) 北アルプス・中央アルプス・南アルプス(中部) 紀伊山地(近畿) 中国山地(中国) 四国山地(四国) 九州山地(九州). Add a row to `RANGES` to add one.
- State: `rangeEdits[id]` = factor on relief above the plain-equivalent ground (2 m + 0.4 m/km inland, the land's own floor). 1 = DEM (not stored), 0 = plain, max 2, step 0.1 (additive so 0 is reachable; Fuji's height uses ×1.1 within 0.5–1.3). Cap 4900 m (Fuji's allowed maximum).
- Applied in `generateTerrain` before drawn ridges / Fuji / Biwa: weight 1 in the core, smoothstep to 0 at the edge; only the relief is scaled so DEM detail and noise stay. Land cells only (sea, coast, islands untouched). Raised ranges also raise the construction barrier (like Fuji's foot).
- Terrain hash and map hash change only when edits exist; old saves = standard state. Edits are possible only before the first road (as Fuji/Biwa), so a started game's terrain cannot drift.
- UI: 山脈 button → list (touch 44 px) or tap the map; yellow band; 減衰 / 増強 / 標準. The former 山脈 (draw tools) is labelled 稜線.

## C. Map switch in the terrain tab
`#edit-bg` (道路図/地形図) in the terrain editor; selection, outline and levels are untouched.

## D. Performance
Simulation code untouched (only checkpoint identity). Terrain generation ≈150 ms with or without ten edits (unit-test timing). Identity checks run only at save/load. Pixel 7a real-device speed unconfirmed.

## Tests
`tests/unit/stage30a.test.ts` (11), E2E "Stage 30A" in `real.spec.ts`.
