import { readFileSync } from "node:fs";
export function loadDem(): Int16Array {
  const b = readFileSync(new URL("../../public/japan-dem.bin", import.meta.url));
  return new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}
