import "./style.css";
import { App } from "./ui/app";
App.start(document.getElementById("stage")!).catch((e) => {
  console.error(e);
  const t = document.getElementById("step-title"); if (t) t.textContent = "起動に失敗しました: " + String(e?.message ?? e);
});
