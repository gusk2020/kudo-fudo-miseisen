/**
 * Stage 24: the legend as a narrow vertical strip on the left or the right edge of the map: one column, its own scroll, each entry a line sample with its words UNDER it.
 * Three axes -- kind (6), tier (3: how thick), state (4: what kind of line) -- one sample per value, not one per combination: a thick dashed blue line is a main-tier line that is planned.
 * Display only: nothing here reads or changes the game.
 */
import { h } from "./app";
import { legendItems } from "../render/legendSamples";

const SVG = (inner: string) => `<svg viewBox="0 0 64 16" width="100%" height="16" preserveAspectRatio="none" aria-hidden="true">${inner}</svg>`;
/** The strip: a head (left/right switch, filters, close) and the entries. */
export function buildLegendStrip(opts: { side: "left" | "right"; swap: () => void; close: () => void; filters: () => void }): HTMLElement {
  const root = h("aside", { id: "legend-side", class: "legend-strip " + opts.side, "aria-label": "凡例" });
  const head = h("div", { class: "lg-head" },
    h("button", { id: "lg-swap", type: "button", title: opts.side === "left" ? "右へ移す" : "左へ移す", onclick: opts.swap }, opts.side === "left" ? "▶" : "◀"),
    h("button", { id: "lg-filters", type: "button", title: "表示の切替", onclick: opts.filters }, "切替"),
    h("button", { id: "lg-close", type: "button", title: "閉じる", onclick: opts.close }, "×"));
  const body = h("div", { class: "lg-body", id: "legend-side-body" });
  let group = "";
  for (const { group: gr, caption, svg } of legendItems()) {   // (the samples come from the same style table the map draws with: render/style24.ts)
    if (gr !== group) { group = gr; body.append(h("div", { class: "lg-title" }, gr)); }
    const it = h("div", { class: "lg-item" }); it.innerHTML = `${SVG(svg)}<span class="lg-cap">${caption}</span>`; body.append(it);
  }
  root.append(head, body); return root;
}
