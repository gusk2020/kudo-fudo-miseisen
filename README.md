# 酷道・腐道・未成線

実在の日本を舞台に、道路と鉄道が 1950年から2100年まで自動で発展・衰退していくのを眺め、10年ごとに政策へ介入する遊び。Android/スマホ縦画面を最優先。

- **遊ぶ**: GitHub Pages（`https://gusk2020.github.io/kudo-fudo-miseisen/`）。世界線（平成/修文/正化）を選び、国道1号と東京府道1号をなぞって「開通の儀」。
- **旧版**（架空の日本列島を編集するStage 1/2）: URLの末尾に `?legacy=1`。
- **開発**: `npm ci && npm run dev`／`npm test`（単体）／`npm run test:e2e`（Playwright）。ビルド工程は無く、静的ファイルをそのまま公開する。

## 文書
| 文書 | 内容 |
| --- | --- |
| `docs/STAGE3_STATUS.md` | **いまの状態と再開メモ**（最初に読む） |
| `docs/STAGE3_DATA_SOURCES.md` | データの出典・利用条件・容量、史実/再構成/架空の区別 |
| `docs/STAGE3_PERF_BUDGET.md` | 性能予算と実測、段階移行計画 |
| `docs/STAGE3_ISSUE7_FREEZE.md` | Issue #7（Chrome停止）の原因と効果 |
| `docs/STAGE1_STATUS.md` / `STAGE2_*` | 旧Stage 1/2 |

## しくみの要点
- 世界線・出来事・政策はすべて `src/sim/eras.ts` の **Dials** を動かすだけ。シミュレーション側は「どの元号か」を知らない。
- 史実（平成のみ・2026年まで）/架空/予測モデルは年表に【史実】【架空】【予測モデル】と付く（`src/sim/events.ts`）。
- 人口・需要・予算・事業者名は**架空モデル**。1950年の路線網は実在の回廊を参考にした**再構成**で、路線台帳ではない。
