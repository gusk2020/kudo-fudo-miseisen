/**
 * Stage 29: the water colours, in one place: the sea (shallow to deep, by depth), lakes, brackish lakes, rivers and the shore line. They are told apart but none is dark: rivers are a light blue (lighter than the
 * sea they flow into, so a river mouth fades into the sea instead of ending in a dark line), lakes a clear light blue, brackish lakes a greener blue, and the shore a soft darker blue.
 */
export const WATER = { lake: 0x72aee0, brackish: 0x7cc2cf, river: 0x5da3e0, shore: 0x3f78b0 } as const;
/** The sea by depth (metres, positive down): 0 = shallow coast colour, 600 and more = the deep colour. */
export const seaRgb = (depthM: number): [number, number, number] => { const d = Math.max(0, Math.min(1, depthM / 600)); return [40 - 22 * d, 110 - 50 * d, 160 - 55 * d]; };
