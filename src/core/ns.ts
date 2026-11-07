/** Storage namespace. Browser storage (IndexedDB, localStorage) belongs to an ORIGIN, not to a path: every GitHub Pages project site of one account (`<owner>.github.io/<repo-a>/`, `<owner>.github.io/<repo-b>/`) shares one.
 *  A playtest build published beside the real game would therefore read and overwrite the real game's saves. A build made with `VITE_SAVE_NS=<name>` keeps its own database and its own localStorage keys; without it (the normal build) every name is exactly what it always was. */
export const SAVE_NS: string = ((import.meta.env.VITE_SAVE_NS as string | undefined) ?? "").replace(/[^A-Za-z0-9_-]/g, "");
/** the IndexedDB database name */
export const dbName = (base: string) => (SAVE_NS ? `${base}-${SAVE_NS}` : base);
/** a localStorage key such as `kfm.bg` */
export const lsKey = (name: string) => (SAVE_NS ? `kfm-${SAVE_NS}.${name}` : `kfm.${name}`);
