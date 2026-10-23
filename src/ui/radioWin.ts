/** Stage 22: the one list window for the prefectures and the era names -- a black window with white letters over the map, one column, scrolling inside;
 *  ○ / ● to the left of each name; choosing keeps it open; 閉じる or a tap outside closes it. Attached to <body> above everything (the dock included), so its foot is always tappable. */
export interface RadioItem { id: string; label: string; sub?: string; desc?: string; on: boolean; disabled?: boolean; pick: () => void }
export interface RadioGroup { head?: string; note?: string; items: RadioItem[] }
export interface RadioOpts { id: string; title: string; groups: RadioGroup[]; foot?: { id: string; label: string; act: () => void }[]; close: () => void }
const el = (tag: string, cls?: string, text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
export function closeRadio() { document.getElementById("rw-root")?.remove(); }
/** Draws (or redraws, keeping the scroll position) the window. */
export function showRadio(o: RadioOpts): HTMLElement {
  const old = document.getElementById("rw-root"), top = old?.querySelector<HTMLElement>(".rw-body")?.scrollTop ?? null, sameList = old?.dataset.list === o.id; old?.remove();
  const root = el("div"); root.id = "rw-root"; root.dataset.list = o.id;
  const back = el("div", "rw-back"); back.id = "rw-backdrop"; back.addEventListener("click", () => o.close());
  const win = el("div", "rw-win"); win.id = o.id; win.setAttribute("role", "dialog"); win.setAttribute("aria-label", o.title);
  win.append(el("div", "rw-title", o.title));
  const body = el("div", "rw-body"); body.setAttribute("role", "radiogroup");
  for (const g of o.groups) {
    if (g.head) { const hd = el("div", "rw-head", g.head); if (g.note) hd.append(el("small", "", " " + g.note)); body.append(hd); }
    for (const it of g.items) {
      const b = el("button", "rw-item" + (it.on ? " on" : "")) as HTMLButtonElement; b.type = "button"; b.id = it.id; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(it.on)); if (it.disabled) b.disabled = true;
      b.append(el("span", "rw-dot", it.on ? "●" : "○")); const txt = el("span", "rw-txt"); txt.append(el("span", "rw-label", it.label)); if (it.sub) txt.append(el("span", "rw-sub", " " + it.sub)); if (it.desc) txt.append(el("span", "rw-desc", it.desc)); b.append(txt);
      b.addEventListener("click", (e) => { e.stopPropagation(); if (!it.disabled) it.pick(); });
      body.append(b);
    }
  }
  win.append(body);
  const foot = el("div", "rw-foot"); for (const f of o.foot ?? []) { const b = el("button", "", f.label) as HTMLButtonElement; b.type = "button"; b.id = f.id; b.addEventListener("click", () => f.act()); foot.append(b); }
  const c = el("button", "", "閉じる") as HTMLButtonElement; c.type = "button"; c.id = "rw-close"; c.addEventListener("click", () => o.close()); foot.append(c); win.append(foot);
  root.append(back, win); document.body.append(root);
  if (sameList && top !== null) body.scrollTop = top;
  return win;
}
