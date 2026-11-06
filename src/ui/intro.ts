/** Stage 31: the one startup window. Everything the player is told about what this game is, and the cautions about saving, lives here and nowhere else -- the in-game tabs carry none of it. */
export const INTRO_SECTIONS: { title: string; lines: string[] }[] = [
  { title: "この世界について", lines: [
    "このゲームの舞台は「架空の世界線の日本」です。実在の日本をもとにしていますが、史実の再現ではありません。",
    "府県は50府県を採用しています(東京は東京府、北海道は3県、樺太県を加えています)。区分や名称はゲーム内の設定です。",
    "【史実】は実際の歴史、【架空】はこの世界線だけの出来事、【予測モデル】は2027年以降の確率的な想定です。路線台帳・人口・予算・事業者名は実在のものではありません。"] },
  { title: "セーブについて", lines: [
    "進行は自動で保存され、①〜⑤の手動セーブとは別に、50年ごと(2000年〜)と遷都イベントの直後に自動セーブポイントが作られます。",
    "自動セーブポイントは、今の世界の履歴だけが一覧に出ます。1つの世界につき最大8件(48MB)で、古いものから消えます。別の世界は最大4つまで残ります。",
    "保存先はこの端末のブラウザの中です。ブラウザのデータを消す、プライベートモードで使う、端末の空きが足りない場合は保存できないことがあります。大事なデータはJSONエクスポートでも残してください。",
    "放置して長時間たった場合、復帰時に計算できる分には上限があり、超えた分は省略されます(画面上部に実際の経過時間で表示されます)。"] },
];
export function showIntro(host: HTMLElement, onClose: () => void) {
  const wrap = document.createElement("div"); wrap.id = "intro-modal"; wrap.setAttribute("role", "dialog"); wrap.setAttribute("aria-modal", "true"); wrap.setAttribute("aria-labelledby", "intro-title");
  const box = document.createElement("div"); box.className = "intro-box";
  const h1 = document.createElement("h2"); h1.id = "intro-title"; h1.textContent = "酷道・腐道・未成線"; box.append(h1);
  for (const sec of INTRO_SECTIONS) { const h3 = document.createElement("h3"); h3.textContent = sec.title; box.append(h3); for (const l of sec.lines) { const p = document.createElement("p"); p.textContent = l; box.append(p); } }
  const ok = document.createElement("button"); ok.id = "intro-ok"; ok.type = "button"; ok.textContent = "確認して始める";
  ok.onclick = () => { wrap.remove(); onClose(); }; box.append(ok); wrap.append(box); host.append(wrap); ok.focus();
}
