import { defineConfig } from "vite";
export default defineConfig({
  base: process.env.BASE_PATH ?? "./",
  worker: { format: "es" },
  build: { target: "es2022" },
  test: { include: process.env.STUDY ? ["tests/study/**/*.test.ts"] : ["tests/unit/**/*.test.ts"], testTimeout: 120000 },
} as any);
