import "./style.css";
import { App } from "./ui/app";
// Stage 3 (real Japan) is the default; the Stage 1/2 hand-edited-map flow stays reachable at ?legacy=1 with its own saves.
const legacy = new URLSearchParams(location.search).has("legacy");
App.start(document.getElementById("stage")!, !legacy).catch((e) => {
  console.error(e);
  const t = document.getElementById("step-title"); if (t) t.textContent = "起動に失敗しました: " + String(e?.message ?? e);
});
