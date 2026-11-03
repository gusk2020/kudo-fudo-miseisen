import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH }), p = await b.newPage();
p.on("pageerror", (e) => console.log("PAGEERR", String(e).slice(0, 400))); p.on("console", (m) => m.type() === "error" && console.log("CONSOLE", m.text().slice(0, 300)));
await p.goto("http://localhost:4173/?legacy=1"); await p.waitForTimeout(6000); console.log("kfm", await p.evaluate(() => !!window.__kfm)); await b.close();
