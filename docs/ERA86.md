# Issue #86: era names and policy chosen apart (implemented on `claude/s42-era86`)

Status: implemented for **new 1800-start games** (`sim.kaigen.era86`); unit + Chromium-emulation E2E pass. Not verified on a real Pixel 7a. Games made before (and the 1950-start mode) keep their eras, names and rules untouched.

## What the player gets
- **Start (1800)**: 元号 (5 names, 大正時候補) and, apart from it, 交通方針 (均衡/道路/鉄道/海路/空路), 都市 (集中/分散), 地域 (太平洋側/日本海側/中立).
- **Ordinary era change (every 20–40 years, unchanged cadence)**: a list of names + a policy row + 「この元号と方針で決定」. Automatic modes keep the policy in force (or the simple mode's kept transport answer).
- **Relocation**: the pool of the year, each name labelled with its origin; policy was already separate there.
- A name that cannot be chosen stays in the list with a mark and the reason: `済` used in this world, `漢` first kanji repeats within the last three eras, `ロ` romaji initial repeats, `読` reading not verified.

## Pools (`src/sim/era86.ts` `HIST_POOL`)
| group | names | reading status |
|---|---|---|
| 大正時候補 (1912) → start of an 1800 game | 天興 てんこう, 興化 こうか, 永安 えいあん, 乾徳 けんとく, 昭徳 しょうとく | as recorded in the game since Stage 22 (`CAND_2200`) |
| 昭和時候補 (1926) → relocation of the 1900s | 宮内省案 神化 元化 神和 同和 継明 順明 明保 寛安 元安; 内閣案 立成 定業 光文 章明 協中 | **names verified** (NDL column, gendai.media/井上寿一 on 倉富日記, zatsuneta) — **readings NOT found in any source reached** (2 searches, 2026-11-17; meitou.info and tanken.com are outside this session's network). Listed, marked 読, not selectable. |
| 平成時候補 (1989) → 2000s | 修文 しゅうぶん, 正化 せいか | names verified (toyokeizai); the **initial S of both is verified** (的場順三's testimony that both begin with S like 昭和); the full kana are the commonly given readings, not found spelled out in a source reached |
| 令和時候補 (2019) → 2000s | 英弘 えいこう, 久化 きゅうか, 広至 こうし, 万和 ばんな, 万保 ばんぽう | Issue #86 comment (nikkansports, 国文学研究資料館) |
Not used: 明治's candidates (none verifiable), 佳桜・桜花・知道 (side proposals, owner's decision). Never offered: any name history adopted (`REAL_ERAS_USED`).
From 2100 the pool is all four groups minus what this world used.

## Rules as built
- **4-era rule** (`fourEraBlock`): candidate + previous three eras must differ in first kanji (after old/new form folding) and, separately, in the Hepburn initial of the reading (し S, ち C, つ T, ふ F, じ J). A fifth era may repeat. A previous era with no known reading is compared by kanji only.
- **Fallback when no pool name can be chosen**: if every verified historical name has been used → **前/中/後** forms (2nd use 前X ぜん…, 3rd 中X ちゅう…, 4th 後X こう…; the game's own fiction, each form a name of its own under the 4-era rule; a fifth use is not offered); otherwise, or if those are all blocked → the game's generated names (いろは+干支), labelled ゲーム生成, with the game's own readings (iroha kana + on-reading of the stem/branch).
- **Consequence to know**: while the 昭和 readings are unverified, the relocation of the 1900s has no selectable historical name and offers generated names. Supplying a source for the 14 readings (one line each in `HIST_POOL`) turns them on.
- Ordinary changes use generated names only (the owner left their pool open; historical names are kept for the start and the relocations).
- Same-year ordinary change + relocation: the ordinary one is settled first, the relocation names its own; names never repeat (tested).
- Saves: `EraEntry.yomi/o86`, `KaigenState.era86`; older saves lack them and are not rewritten.
Tests: `tests/unit/era86.test.ts` (8), `tests/e2e/era86.spec.ts`.

## Correction (2026-11-17, second session): the 昭和時候補 are offered again
The first version made the 14 昭和時候補 unselectable (no verified reading), so the 1900 relocation offered only generated names — **against the owner's rule** ("1900 = only the 14 昭和 candidates"). Now:
- each 昭和 name carries a **provisional reading** (`yomiSrc: "provisional"`): the usual on-reading of each character — 神化 しんか, 元化 げんか, 神和 しんわ, 同和 どうわ, 継明 けいめい, 順明 じゅんめい, 明保 めいほ, 寛安 かんあん, 元安 げんあん, 立成 りっせい, 定業 ていぎょう, 光文 こうぶん, 章明 しょうめい, 協中 きょうちゅう. 修文 しゅうぶん / 正化 せいか likewise (their S initial IS sourced).
- they are **shown as 「仮の読み」** in the relocation list, and a block decided by a provisional initial says 「(仮の読みによる判定)」. Readings with a source (大正, 令和) are `yomiSrc: "source"`.
- Search this session (2026-11-17): the names and the 宮内省/内閣 split are confirmed again (NDL column 6, gendai.media on 倉富日記, zatsuneta); only 元化(げんか) appeared spelled out, on an aggregator page (not a reliable source). No source with all 14 readings was reached; ja.wikipedia and several sites are outside this session's network.
- Result: at 1900 the list has exactly the 14 names; with an 1800 start most are selectable (the rest blocked by the 4-era rule, with the reason).

### Options left for the owner (recorded, not decided here)
| option | effect | risk |
|---|---|---|
| A (current) | provisional on-readings, marked 仮, used by the 4-era rule | a real reading could differ (e.g. 神 = じん), which could flip an S/J initial |
| B | judge 昭和 names by kanji only until a reading is sourced | the romaji rule is skipped for them |
| C | owner supplies sources/readings | best; one line per name in `HIST_POOL` |

## 決定（2026-11-17）
- 昭和の未採用候補14件の読みは **案A（現状のまま・仮の読みとして判定、画面に「仮の読み」と明示）** で確定。オーナー承認済み。
- 将来オーナーが読みを指定する場合は案Cへ移行できる（`yomiSrc` を "source" に変えるだけ）。
