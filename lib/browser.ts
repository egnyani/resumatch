import { existsSync } from "fs";

import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

export function getLocalBrowserExecutable() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ].filter(Boolean) as string[];

  return candidates.find((p) => existsSync(p)) || null;
}

export async function launchHeadlessBrowser() {
  const localBrowser = !process.env.VERCEL ? getLocalBrowserExecutable() : null;

  if (!localBrowser) {
    // Disable WebGL / graphics stack — not needed for PDF rendering.
    chromium.setGraphicsMode = false;
  }

  return puppeteer.launch({
    args: localBrowser ? ["--no-sandbox", "--disable-setuid-sandbox"] : chromium.args,
    executablePath: localBrowser || (await chromium.executablePath()),
    headless: true,
  });
}
