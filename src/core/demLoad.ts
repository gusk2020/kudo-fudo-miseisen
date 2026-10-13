import { JAPAN } from "./data";
export async function fetchDem(url: string): Promise<Int16Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`標高データを取得できません (${res.status})`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength !== JAPAN.dem.w * JAPAN.dem.h * 2) throw new Error("標高データの大きさが想定と違います");
  return new Int16Array(buf);
}
