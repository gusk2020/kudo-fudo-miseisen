import { defineConfig } from "vite";
export default defineConfig({
  base: process.env.BASE_PATH ?? "./",
  worker: { format: "es" },
  build: { target: "es2022" },
  test: { include: ["tests/unit/**/*.test.ts"] },
} as any);
