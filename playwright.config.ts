import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e", timeout: 120000, workers: 1,
  use: { baseURL: "http://localhost:4173/", ...devices["Pixel 7"], launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] } },
  webServer: { command: "npm run build && npx vite preview --port 4173", url: "http://localhost:4173/", reuseExistingServer: !process.env.CI, timeout: 180000 },
});
