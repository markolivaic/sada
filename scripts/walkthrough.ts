// Records the walkthrough in docs/walkthrough: an MP4, an animated WebP for the README and a
// poster. Run with: npm run walkthrough (builds first; needs NEXT_PUBLIC_MAPBOX_TOKEN set).
//
// The page clock is fixed and the person stands on the main square, so the recording does
// not depend on when it is made. Walking routes are served from scripts/walkthrough-routes.json,
// answers the routing service gave once; `npm run walkthrough -- --record-routes` asks again
// and saves them. Map tiles come from Mapbox as usual.
//
// Needs ffmpeg and ffprobe on the PATH, and Playwright's Chromium or CHROMIUM_EXECUTABLE.
// Chromium has to draw with the graphics card: in software the map stutters, so the script
// stops if it finds a software renderer.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const PORT = 4330;
const URL = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 880, height: 600 };
const START = new Date("2026-09-19T11:00:00Z"); // 13:00 in Zagreb
const DRAG_TO_MINUTES = 120;
const DRAG_STEP_MINUTES = 5;
const DRAG_STEP_MS = 160;
const PERSON = { latitude: 45.8131, longitude: 15.9772 }; // on the main square
const OUT = "docs/walkthrough";
const ROUTES = "scripts/walkthrough-routes.json";
const WEBP_LIMIT = 5 * 1024 * 1024;

const recordRoutes = process.argv.includes("--record-routes");
const run = (cmd: string, args: string[]) => execFileSync(cmd, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function videoSeconds(file: string): number {
  const probed = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).trim();
  if (probed && probed !== "N/A") return Number(probed);
  // WebM from the browser often carries no duration; decode it to find out.
  const log = execFileSync("ffmpeg", ["-hide_banner", "-i", file, "-f", "null", "-"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const times = [...log.matchAll(/time=(\d+):(\d+):([\d.]+)/g)];
  const [, h, m, s] = times[times.length - 1];
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

// Routes are keyed by the two ends only; the request's token is never stored.
const routeKey = (url: string) => decodeURIComponent(new globalThis.URL(url).pathname.split("/").pop() ?? "");
const routes: Record<string, unknown> = recordRoutes || !existsSync(ROUTES) ? {} : JSON.parse(readFileSync(ROUTES, "utf8"));

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT), "-H", "127.0.0.1"], { stdio: "ignore" });
const scratch = mkdtempSync(join(tmpdir(), "sada-walkthrough-"));
try {
  for (let attempt = 0; ; attempt++) {
    if (await fetch(URL).then((r) => r.ok, () => false)) break;
    if (attempt === 60) throw new Error("the app did not start; run npm run build first");
    await pause(500);
  }

  const gpu = process.platform === "win32" ? ["--use-angle=d3d11"] : [];
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, args: [...gpu, "--ignore-gpu-blocklist", "--enable-gpu"] });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    geolocation: PERSON,
    permissions: ["geolocation"],
    timezoneId: "Europe/Zagreb",
    recordVideo: { dir: scratch, size: VIEWPORT },
  });
  await context.route(/api\.mapbox\.com\/directions\//, async (route) => {
    const key = routeKey(route.request().url());
    if (recordRoutes) {
      const response = await route.fetch();
      routes[key] = await response.json();
      await route.fulfill({ response });
    } else if (routes[key]) {
      await route.fulfill({ json: routes[key] });
    } else {
      throw new Error(`no saved route for ${key}; run npm run walkthrough -- --record-routes`);
    }
  });

  const page = await context.newPage();
  const pageAt = Date.now();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.clock.setFixedTime(START);

  const renderer = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return info ? String(gl!.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown";
  });
  if (/swiftshader|llvmpipe|software/i.test(renderer)) throw new Error(`Chromium is drawing in software (${renderer}); the map would stutter`);

  await page.goto(URL);
  const sun = page.getByRole("button", { name: "Sun", exact: true });
  await sun.waitFor({ timeout: 30_000 });
  if (await page.getByTestId("map-missing").count()) throw new Error("the build has no map; set NEXT_PUBLIC_MAPBOX_TOKEN and build again");
  // Let the tiles and the buildings come in before the part that is kept.
  await pause(4000);
  const keptFrom = Date.now();

  await pause(1500);
  await sun.click();
  await page.getByTestId("pick-detail").waitFor({ timeout: 15_000 });
  const firstPick = await page.getByTestId("pick-name").innerText();
  await pause(3500);

  await page.getByRole("button", { name: "Change the time" }).click();
  await pause(600);
  const slider = page.getByRole("slider", { name: "Time of day" });
  for (let minutes = DRAG_STEP_MINUTES; minutes <= DRAG_TO_MINUTES; minutes += DRAG_STEP_MINUTES) {
    await slider.fill(String(minutes));
    await pause(DRAG_STEP_MS);
  }
  await pause(700);
  await page.getByRole("button", { name: "Close the time control" }).click();
  await page.getByTestId("pick-detail").waitFor({ timeout: 15_000 });
  const laterPick = await page.getByTestId("pick-name").innerText();
  await pause(3000);
  const keptTo = Date.now();

  if (errors.length) throw new Error(`the page reported errors: ${errors.join(" | ")}`);
  // The recording ends when the context closes, so count back from there to where it is kept.
  const closedAt = Date.now();
  await context.close();
  await browser.close();
  if (recordRoutes) writeFileSync(ROUTES, JSON.stringify(routes, null, 1) + "\n");

  const raw = join(scratch, readdirSync(scratch).find((name) => name.endsWith(".webm"))!);
  const length = (keptTo - keptFrom) / 1000;
  // The recording starts with the page, and runs on a little after the context closes, so the
  // kept part is counted from the start, not back from the end.
  const recorded = videoSeconds(raw);
  const start = (keptFrom - pageAt) / 1000;
  if (start + length > recorded) throw new Error(`the recording is ${recorded.toFixed(2)} s, shorter than expected`);
  console.log(`recorded ${recorded.toFixed(2)} s, page open ${((closedAt - pageAt) / 1000).toFixed(2)} s, kept from ${start.toFixed(2)} s for ${length.toFixed(2)} s`);
  mkdirSync(OUT, { recursive: true });
  const mp4 = join(OUT, "app-walkthrough.mp4");
  const webp = join(OUT, "app-walkthrough.webp");
  const poster = join(OUT, "app-walkthrough-poster.jpg");

  run("ffmpeg", ["-ss", start.toFixed(2), "-i", raw, "-t", length.toFixed(2), "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mp4]);
  run("ffmpeg", ["-sseof", "-0.3", "-i", mp4, "-frames:v", "1", "-q:v", "2", poster]);
  for (const quality of [70, 60, 50, 40, 30]) {
    run("ffmpeg", ["-i", mp4, "-vf", "fps=12", "-c:v", "libwebp_anim", "-lossless", "0", "-q:v", String(quality), "-compression_level", "6", "-loop", "0", "-an", webp]);
    if (statSync(webp).size < WEBP_LIMIT) break;
  }
  if (statSync(webp).size >= WEBP_LIMIT) throw new Error("the WebP is still over 5 MB at the lowest quality tried");

  console.log(`picks: ${firstPick} at 13:00, ${laterPick} at 15:00`);
  for (const file of [mp4, webp, poster]) console.log(`${file}: ${statSync(file).size} bytes`);
} finally {
  server.kill();
  rmSync(scratch, { recursive: true, force: true });
}
