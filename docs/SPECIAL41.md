# Stage 41 #8: special routes (特殊路線)

Status: **core rules implemented and unit-tested; two parts not done** (see bottom). Not verified on a real Pixel 7a.

## Rules implemented (src/sim/special41.ts)
- Order (fixed, as agreed): 1号 イチ → 0号 ゼロ → A号 エー → 元号 ゲン → 始号 シ → ㄅ号 ボ → ᚠ号 フェ → Ⰰ号 アズ → ꀀ号 イ → ᚛号 ベイ → 𓃀号 ベー → ⌘号 コマ → ꙮ号 オク. Test asserts the table verbatim.
- **Build order, not calendar.** A relocation event may build the next symbol; a skipped relocation builds nothing and the same symbol waits. 国道1号 and 国道0号 keep their labels (国道1号 / 国道0号) and are special routes by their number; the first new-style symbol is **A号**, shown as `A号`.
- **Previous must be complete**: in service, every section open and built (`routeComplete`). Otherwise `performRoad0` refuses and the wizard says why (`canBuildNext().reason`); the player can still skip and confirm the relocation.
- **Own identity**: a new-style route has `route.special = <symbol>` and `gen` = year (which already keeps it out of the number register, `numreg.ts`); its `number` is 0 but the integrity key is `special:<symbol>`, so it never collides with a numbered route or the old dated 国道0号. Display and saves use the same symbol.
- **Games**: only games made after this change (`sim.special41 = true`). A game saved before keeps the old rule (every relocation makes another dated 国道0号, Stage 25); `repairRoad0Years` (PR #77) still repairs old saves.
- **One-stroke rule** (`strokeCheck`): whole-line graph check — connected, 0 odd vertices (loop) or 2 (path). A place passed twice is one vertex. Unit-tested: path, loop, side branch (refused), separate pieces (refused), star (refused), two loops meeting (accepted).
- **Extension** (`canExtend`/`extendSpecial`): new sections must join the route and keep it one stroke (loop closing allowed, unrelated branch or separate piece refused). Number/symbol unchanged; history entry added.
- **Capital / sub-capital / palace** (`seatsPass`): both are required; the palace counts for the capital when the line runs within 20 km of it. The existing drawing preview already forces the line to start near the capital and end near the sub-capital.
- **Font safety** (`src/ui/glyph41.ts`, `shownSymbol`): at start the app draws each symbol on a canvas and compares it with the pictures the device makes for unassigned code points (tofu) and for blank; symbols that fail are **shown by their katakana reading** (`フェ号`). Key, saved data and meaning never depend on the font. No font file is added; no external service.

## Not done (honest)
1. **Drawing UI for extensions** and for free start/end/loops. The relocation wizard still draws a line from the capital to the sub-capital (existing `previewNational`), so a loop or detour drawn by the player is not yet possible; the engine functions (`canExtend`, `extendSpecial`, `strokeCheck`) exist and are tested but nothing in the UI calls them yet.
2. **SVG drawing** of the symbols on map signs: the fallback is text (reading) only. The glyph detection itself is unit-untested in node (needs a canvas) and has not been run on a real Pixel 7a; headless Chromium may report most rare glyphs as undrawable — which is the safe direction.
3. The old unit/E2E flows that name the relocation line "国道0号" still apply to the first relocation; later relocations in new games now produce A号 etc. (`tests/unit/save41.test.ts` sets `delete sim.special41` to model the old rule).

## Second round (2026-11-17, on `claude/s41-integration`): drawing from the screen — DONE for extension and loop
- **"Complete" redefined**: every section built to 100% (`routeComplete`). A section that was finished and later closed or abandoned does not un-complete the route. (The first version required every section to be in service today, which would have blocked the next symbol whenever a century-old road had decayed — found by the old Stage 22 test.)
- **Relocation wizard, road stage** (games with `special41`): a row `新規: <next symbol>` / `延長: 国道1号` / `延長: 国道0号` / `延長: A号` …, with one line of help.
  - 新規: as before (capital → sub-capital, detours follow the drawing). **Loop**: a line that comes back to the capital after passing the sub-capital is split (`splitLoop`): the outward part is the normal route, the way back is joined on (`performLoop`).
  - 延長: `previewExtension` — starts at the nearest end of the route (or anywhere on it), runs where drawn on the same land mass, ends where the finger stops or back on the route (closing a loop). No new symbol is used; the previous-route-complete gate does not apply.
  - Every drawing is tried on a **copy of the game** first (`checkExtension` / `checkLoop`); a line that breaks the one-stroke rule is refused in the preview with the reason and the real game is never half-changed.
  - `extendSpecial` re-orders the sections into one Euler walk (`eulerOrder`, Hierholzer), which is what the game's integrity check requires of every route (a branchy append failed it — found by test).
- Tests: `tests/unit/specialDraw41.test.ts` (extension accepted and saved/loaded; branch refused, nothing laid; far / sea-crossing / missing route refused; loop → 0 odd places), `tests/e2e/mobile35.spec.ts` "Stage 41 #8" (touch: extend 国道1号 at a relocation, reload), `tests/e2e/integration41.spec.ts` (国道0号 at 1900, A号 at 2000).
- **Still not done**: SVG glyphs on map signs (fallback stays the katakana reading); an extension cannot cross the sea; a loop drawn in one stroke that does not pass the sub-capital is not offered; extension outside a relocation event is not offered (special routes are made at relocations only).
