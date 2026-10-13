# データ出典
| データ | 出典 | ライセンス |
|---|---|---|
| 日本の輪郭(本州・北海道・九州・四国・沖縄本島)、都道府県、都市、琵琶湖 | Natural Earth 1:10m (admin_0 countries / admin_1 / populated places / lakes) https://www.naturalearthdata.com/ | パブリックドメイン |
| 標高(日本周辺の切出し) | GEBCO_2026 Grid (ice surface), 4096x2048 に縮約済みのものを world-viewer リポジトリ経由で使用。https://www.gebco.net/ | GEBCOの利用条件（無償・帰属表示: GEBCO Compilation Group） |
| 北海道3県の県庁(札幌・函館・根室)座標 | 公知の都市座標（手入力） | — |

加工: 輪郭は Douglas-Peucker で簡略化(自己交差が出ないよう許容誤差を自動調整)。再生成は `tools/build_data.py`。
注意: 簡略化済みの暫定データであり、測量用途の正確さはない。
