# Stage 1 引継ぎ記録（地図生成・編集）

最終更新: 2026-10-13 / 作業ブランチ: `claude/stage1-map-generator`（ローカルのみ）

## 0. 重要: GitHubへは未反映
`gusk2020/kudo-fudo-miseisen` の作成を試みたが **403 (Resource not accessible by integration)**。権限不足のため push / Draft PR / Pages 設定は未実施。
コードは `/home/user/kudo-fudo-miseisen`（ローカルgit、全コミット済み）にある。リポジトリ作成後に `git remote add origin … && git push -u origin claude/stage1-map-generator`、Draft PR、Settings→Pages→Source=GitHub Actions を行えば `.github/workflows/{ci,pages}.yml` がそのまま動く想定（未検証）。world-viewer には一切変更なし。

## 1. 完了工程（すべて「プロトタイプ水準」）
| 工程 | 内容 | 主なファイル |
|---|---|---|
| 1A | 縦画面UI、実日本輪郭の初期表示、ピンチ/パン/ホイール、レイヤー切替(7種)、工程状態管理(6工程) | `ui/app.ts` `ui/gestures.ts` `render/renderer.ts` |
| 1B | 本州の引っ張り/膨張/凹み/移動/回転/拡縮、取り消し/やり直し、自己交差・折り返し・ねじれ・縮退・細長さ喪失の検出 | `core/warp.ts` `core/validate.ts` |
| 1C | 北海道→九州→四国の配置と制約判定(本州の局所長軸基準)、島の重なり検出 | `core/constraints.ts` |
| 1D | 琵琶湖・富士山(形状・サイズ固定、回転可)、面積1.2倍(線形√1.2)判定、手描き山脈(南西/北東)、点の編集、標準山脈の自動提案 | `core/constraints.ts` `core/suggest.ts` |
| 1E | 標高・河川・平野・49府県・都市(Worker実行、決定論) | `core/terrain.ts` `core/terrain.worker.ts` |
| 1F | 工程前後移動、再検証、警告一覧、IndexedDBセーブ(3スロット+自動)、JSON入出力、最終確定、安定ID＋座標変換API | `core/save.ts` `core/geoid.ts` |

## 2. 技術判断（簡単な代替案との比較）
- **変形**: 「操作列(ops)を元形状に順に適用」方式。元データ(rest)は不変、undoは操作列/スナップショット、決定論。代替(メッシュ頂点を直接編集)は破壊的で却下。Gaussian風の `(1-t²)²` 減衰、1操作あたり引っ張り量 ≤0.6r に制限し単独操作で折り返さない。複数操作の折り返しはヤコビアン(det≤0.05)で検出。
- **回転/拡縮/移動**は `place`（剛体変換）として ops と分離。変形操作の中心は「直前までの変形後・島ローカル座標」で保持。
- **座標**: 内部は km 平面（経度137/緯度37基準の等距円筒、y上）。画面座標とは分離（Rendererのみがy反転）。
- **本州の南西/北東判定**: 本州外周の主成分分析で長軸を求め、本州の配置回転に追従して向きを決定（`axisFrame`）。画面の上下左右は不使用。テストで90°回転しても整合することを確認。
- **解釈した仕様（要確認）**:
  - 北海道「北東半分より北東側」= 北海道中心の軸射影 t ≥ 0.5、九州 t ≤ 0.5（`HOKKAIDO_MIN_T`/`KYUSHU_MAX_T`）。より厳しく(t≥1など)する場合は定数変更のみ。
  - 四国/琵琶湖/富士山の「北海道・九州中心を結ぶ軸方向の範囲」= 中心の射影パラメータ u∈[0,1]（横方向の制限なし）。
  - 49府県 = 本州34 + 四国4 + 九州7 + 北海道3 + 沖縄1。**沖縄は九州の付属パーツ**（九州の変形・配置に追従、独立編集なし）として扱った。
- **標高**: world-viewer に commit 済みの GEBCO_2026(4096x2048)から日本周辺を切出し(≈9km/px)、変形メッシュにスプラットして追従。細部はseed付き fbm ノイズで補う。山脈は手描き線からの減衰加算、富士山は円錐＋不規則形。
- **河川**: priority-flood で窪地を解消し排水木を作るので登り流路は構造的に発生しない。河道は下流で標高が増えないよう掘り下げ(carve)。
- **府県境**: 県庁位置からの重み付き Dijkstra（急斜面・山脈・河川・湖は高コスト）なので境界は尾根・河川に沿いやすい。コストは島ごとに独立（隣接セルでも島をまたがない）。
- **グリッド**: 5km（最大700×700）。重い処理は Worker。メインスレッドの検証は数ms〜数十ms。
- **セーブ**: `schemaVersion`=1。`parseState` は例外を投げず、壊れた値は既定値に置換し問題を報告。編集途中(step含む)も保存。IndexedDB不可でもアプリは動く。
- **安定ID**: `isl.*` `pref.<ISO3166-2>` `city.*` `riv.NNN` `lake.biwa` `mtn.fuji` `range.sw/ne` `cell.<size>.<i>.<j>`。`GeoMap.toWorld(lon,lat)` / `toGeo(world)`（Newton逆変換）/ `cellId(world)`。最終確定JSONの `geo` に ID一覧・terrainHash・格子情報を保存。

## 3. 出典・ライセンス（`docs/DATA.md` 参照）
Natural Earth 1:10m（パブリックドメイン: 国境/県/都市/湖）、GEBCO_2026（GEBCOの利用条件、帰属表示）。再生成: `python3 tools/build_data.py <NEdir> <gebco4096.png>`。**実在の正確な標高データを使ったとは言えない**: 標高は約9km解像度の粗いもの＋ノイズ。

## 4. 既知の問題・限界（隠さず記録）
- 地形はプロトタイプの簡易近似。山脈は実在の位置を保持しない（手描き）。標高は粗い。
- 府県の形は重み付き距離の産物で現実とは異なる。北海道3県の重みは任意値(190/120/170)。県庁位置20県は Natural Earth の県ラベル点で代用（`seedApprox`、データ上フラグ付き）。
- 府県境は5kmセルの階段状（平滑化なし）。海峡幅<5kmの島間（関門など）はセルが接するため島IDで分離して処理。
- 小島（佐渡・淡路・対馬・伊豆諸島等）は省略。
- 琵琶湖は5kmセルで約26セル（形は粗い）。富士山の円錐は合成。
- 変形プレビュー中は検証しない（確定時に検証・赤表示）。
- 標準山脈の提案は単純で、湾曲の強い本州では不自然な線になる場合がある（編集前提）。
- 実機(Pixel 7a)・GitHub Pages・CIは未検証（Chromium swiftshader で Pixel 7 エミュレーションまで）。

## 5. テスト結果
- Vitest 28件 全通過（データ/変形/幾何/制約/決定論/保存/アンドゥ/地形/座標API）。
- Playwright(Pixel 7 エミュレーション) 7件 全通過: スクロール不発・touch-action、引っ張り→取消、**ピンチ中は変形が起きない**(CDP 2点タッチ)、全工程→最終確定→エクスポート、前工程編集で確定解除と再検証、画面回転・リロード・破損セーブ(IndexedDB)、レイヤー、山脈描画。
- 実行: `npm test` / `CHROMIUM_PATH=<chrome> npm run test:e2e` / `npm run build`。

## 6. 次の作業
1. GitHubリポジトリ作成後に push・Draft PR・CI/Pages確認。
2. 実機(Pixel 7a)で操作感確認（指の太さに対する選択半径、ツール配置）。
3. 府県境の平滑化、県庁位置の実座標化、小島の取り込み。
4. Stage 2（道路・鉄道）は `GeoMap` と `cell.*`/`pref.*` ID を土台にする。

## 7. 再開に必要な情報
- 構成: `src/core`(純粋ロジック・DOM/描画なし) / `src/render`(PixiJS) / `src/ui`(DOM・ジェスチャ) / `src/data/japan.json`(生成物) / `public/japan-dem.bin`。
- 開発: `npm ci && npm run dev`。E2E用フック `window.__kfm`（App）。
- 制約判定(`validate.ts`/`constraints.ts`)は描画に依存しない。地形生成は `generateTerrain(state, dem)` の純関数（同一state→同一hash）。
- Opus監査推奨: 制約の解釈(§2)、ヤコビアン閾値(`validate.ts`)、府県生成アルゴリズムと重み、地形の現実性、座標逆変換の収束条件。
