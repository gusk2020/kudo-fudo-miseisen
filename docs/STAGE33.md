# Stage 33 — terrain editing and freshwater

**Grid: 5 km cells (344 x 447).** Everything below is in whole cells; where the plan's number cannot be represented, the nearest deterministic value is used and reported.

- **稜線 menu removed** (UI only; old saves keep their drawn ranges). 新規 (new mountain / lake) took its place.
- **Mountain range menu**: steps are 湖(×−0.05) → 平野(×0) → ×0.1 … ×2.0. 湖 turns the range's core (0.6 x its core half-width of the crest line; 5–7 km wide) into freshwater and flattens the rest. Labels: `rangeLabel`.
- **Coast rules (real map)**: validation only requires a feature's CENTRE on land. Fuji: the cone is built on land cells only, so it is cut at the shore (no sea cell is raised). Biwa: the sea wins -- a lake cell with a sea neighbour becomes land -- so one land cell always separates Biwa from the sea. Default maps are unchanged (golden terrain hash).
- **Biwa beats other lakes**: a new / range lake that touches Biwa (or lies on it) disappears entirely. A lake cell beside the sea stays land, so no inland lake joins the sea.
- **New mountains / lakes** (`src/core/creations.ts`): centre on a plain cell (land, ≤ 250 m, not a lake, not an existing creation, not the former Fuji / Biwa site once moved, not a flattened range's zone), chosen with the Stage 32 way: tap, 決定 / 微調整 (one cell) / やり直し. Up to 12. Each is selectable by tapping it, editable (− / ＋ / なくす), saved (`creations`) and in the map hash.
- **Units (effective)**: +500 m (mountain) or +5 km diameter (lake) a press, at most 3 presses (1500 m / 15 km). Mountain nominal diameter = 10 x height: 5 / 10 / 15 km. On a 5 km grid the footprint is **1 / 3 / 7 cells = 25 / 75 / 175 km²** (nominal 19.6 / 78.5 / 176.7): whole cells, nearest count. The outline is irregular (bearing-dependent radius from a seed per creation) and identical every time. A mountain adds its height at the centre falling to 40 % at the rim, capped at 4900 m, and is a construction barrier like Fuji's foot.
- **Second-class rivers**: the same flow lines at a drainage area of 550 km² (first class: 2200 km²), drawn thinner and lighter from zoom 0.8 up (the national view shows first class only). **A procedural approximation from the terrain, not a surveyed list of rivers**; not part of the terrain hash.
- **Freshwater crossings**: lakes are now judged one by one (Biwa first, then the player's lakes by size); a lake's routes carry a 【湖n】 tag. Effective minimum: a lake cell is 5 km of water (10 km between shore-cell centres); the plan's 3 km cannot be told apart on this grid. A small lake that already has its long route keeps one service (its cap); one without can still be crossed at its narrows. Biwa-only games keep exactly the crossings they had.
- **Performance**: terrain build 0.49–0.59 s with no creations, 0.57–0.67 s with twelve; `lakeCrossings` 1.7–2.2 ms. The simulation's monthly loop is untouched (×20 not re-measured separately).
- **Limits**: the lake form of a range is 5–7 km wide, the new lake's drawn shape is cell squares (visual freshwater only, no hydrology); creations are not allowed beside the sea or on high ground; a lake that touches Biwa is removed silently (it simply does not appear). Stage 34 (island enlargement, reclamation) and 35 (relocation skip) are not started.

## 修正(海岸の平野・琵琶湖接触の通知)

- 山・湖は、中心が編集可能な平野なら、輪郭が海岸に掛かっていても作れる(海岸までの距離では拒否しない)。海・湖・高地・禁止跡地の中心は従来どおり不可。
- 山は海岸で切れ、海を陸・山にしない。湖は海との間に陸を最低1マス残し、海側のマスは落とす(湖と海はつながらない)。
- 面積・直径は5kmグリッド上の近似。縮んだ場合は実効マス数・面積を選択行に表示する。
- 琵琶湖に触れた湖は従来どおり消える。地形生成が `creationReport`(key,label,wanted,cells,status)を返し、画面はそれだけを元に
  「琵琶湖との接触により湖が消滅しました」等をトースト＋地形タブの注記行(片付ける)で表示する。
  通知は地形から導くため、設定・再編集・保存/復元で必ず地形と一致する。通知は操作を妨げない。
