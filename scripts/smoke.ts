// Starts the built app and checks it in a real browser, with the clock fixed and no map
// reachable: the pick and the words under it, the time control, and every state in which
// the app cannot answer.
// Run with: npm run build && npm run smoke
//
// Needs Playwright's Chromium (npx playwright install chromium), or CHROMIUM_EXECUTABLE
// pointing at one.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium, type Browser, type BrowserContextOptions, type Page } from "playwright";
import { holdText, whyText } from "../lib/describe.ts";
import { toLocal } from "../lib/geo/frame.ts";
import { rank, scorePlaces, type Scored } from "../lib/pick.ts";
import { placesFrom, type Category } from "../lib/places.ts";
import { readCity } from "../tests/support.ts";

const PORT = 4319;
const URL = `http://127.0.0.1:${PORT}`;
const START = new Date("2026-06-21T09:00:00Z"); // 11:00 in Zagreb
const LATER_MINUTES = 180;
const LATER = new Date(START.getTime() + LATER_MINUTES * 60_000);
const ON_THE_SQUARE = { latitude: 45.8131, longitude: 15.9772 }; // inside the box
const IN_SPLIT = { latitude: 43.5081, longitude: 16.4402 }; // about 260 km away
const PHONE = { width: 390, height: 844 };

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

// What the page should say, worked out here from the same data.
const city = readCity();
const { places } = placesFrom(JSON.parse(readFileSync("data/osm/places.json", "utf8")).places, city);
const [squareX, squareY] = toLocal(ON_THE_SQUARE.longitude, ON_THE_SQUARE.latitude);
const ranking = (time: Date, want: "sun" | "shade", category: Category, from = { x: squareX, y: squareY }) =>
  rank(scorePlaces(city, places, time, from), want, category);

async function open(browser: Browser, options: BrowserContextOptions): Promise<{ page: Page; errors: string[] }> {
  const context = await browser.newContext({ viewport: PHONE, timezoneId: "Europe/Zagreb", ...options });
  // Nothing here may depend on Mapbox being reachable or on a token being set, so its
  // requests are cut off: the app runs as it does with no map and no routing service.
  await context.route(/mapbox\.com/, (route) => route.abort());
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.clock.setFixedTime(START);
  return { page, errors };
}

const text = (page: Page, id: string) => page.getByTestId(id).innerText();
const shows = (page: Page, id: string, expected: string) =>
  page.waitForFunction(([testId, value]) => document.querySelector(`[data-testid=${testId}]`)?.textContent === value, [id, expected]);
async function expectPick(page: Page, name: string, expected: Scored, time: Date): Promise<void> {
  await shows(page, "pick-name", expected.place.name);
  const headline = holdText(expected.hold, time);
  const detail = whyText(expected.hold, null, expected.distanceM);
  await shows(page, "pick-headline", headline);
  check(name, (await text(page, "pick-detail")) === detail, `${expected.place.name}: ${headline}; ${detail}`);
}

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT), "-H", "127.0.0.1"], { stdio: "ignore" });
try {
  for (let attempt = 0; ; attempt++) {
    const up = await fetch(URL).then((r) => r.ok, () => false);
    if (up) break;
    if (attempt === 60) throw new Error("the app did not start; run npm run build first");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });

  // 1. A person on the main square, at 11:00 on the longest day.
  {
    const { page, errors } = await open(browser, { geolocation: ON_THE_SQUARE, permissions: ["geolocation"] });
    await page.goto(`${URL}/map`);
    check("/map leads to the front page", new globalThis.URL(page.url()).pathname === "/");
    const sunButton = page.getByRole("button", { name: "Sun", exact: true });
    await sunButton.waitFor({ timeout: 20_000 });
    check("clock shows the fixed time", (await text(page, "clock")) === "11:00");
    check("a person inside the box gets no note about distances", (await page.getByTestId("origin-note").count()) === 0);

    // Every control is big enough for a thumb.
    const small = await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .filter((b) => b.offsetParent !== null)
        .map((b) => ({ label: b.getAttribute("aria-label") ?? b.textContent ?? "", box: b.getBoundingClientRect() }))
        .filter(({ box }) => box.height < 44 || box.width < 44)
        .map(({ label }) => label.trim()),
    );
    check("every button is at least 44 px", small.length === 0, small.join(", "));

    // One tap gives the answer.
    const sunCafes = ranking(START, "sun", "cafe");
    await sunButton.click();
    await expectPick(page, "one tap on Sun gives the top-ranked cafe", sunCafes[0], START);
    await page.getByRole("button", { name: "Another one" }).click();
    await expectPick(page, "another one is the second-ranked cafe", sunCafes[1], START);

    // Three hours later the shadows and the ranking have moved.
    await page.getByRole("button", { name: "Change the time" }).click();
    await page.getByRole("slider", { name: "Time of day" }).fill(String(LATER_MINUTES));
    await shows(page, "clock", "14:00");
    const laterCafes = ranking(LATER, "sun", "cafe").filter((s) => s.place.id !== sunCafes[0].place.id);
    await expectPick(page, "the pick follows the clock", laterCafes[0], LATER);
    await page.getByRole("button", { name: "Close the time control" }).click();

    await page.getByRole("button", { name: "Shade instead" }).click();
    await expectPick(page, "Shade instead gives the top-ranked shaded cafe", ranking(LATER, "shade", "cafe")[0], LATER);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Bench" }).click();
    await page.getByRole("button", { name: "Sun", exact: true }).click();
    await expectPick(page, "the bench switch changes what is picked", ranking(LATER, "sun", "bench")[0], LATER);

    // Night: no answer, and a way to a time that has one.
    await page.getByRole("button", { name: "Change the time" }).click();
    await page.getByRole("slider", { name: "Time of day" }).fill("720");
    await page.getByText("The sun is down.").waitFor();
    check("night offers no pick", (await page.getByTestId("pick").count()) === 0);
    await page.getByRole("button", { name: "See tomorrow at 9:00" }).click();
    await shows(page, "clock", "09:00");
    check("the night button moves the clock to 9:00 tomorrow", true);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check("no sideways scroll at 390 px", overflow <= 0, `${overflow} px`);
    check("no errors on the page", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }

  // 2. Location refused: the page says so and measures from the middle of the box.
  {
    const { page, errors } = await open(browser, {});
    await page.goto(URL);
    await page.getByRole("button", { name: "Sun", exact: true }).click();
    const fromMiddle = ranking(START, "sun", "cafe", { x: 0, y: 0 });
    await expectPick(page, "without a location the pick is measured from the middle of the box", fromMiddle[0], START);
    check("and the page says the location is not available", (await page.getByText("Your location is not available").count()) > 0);
    check("no errors without a location", errors.length === 0, errors.join(" | "));
    await page.context().close();
  }

  // 3. A person far from Zagreb.
  {
    const { page } = await open(browser, { geolocation: IN_SPLIT, permissions: ["geolocation"] });
    await page.goto(URL);
    await page.getByText(/You are about 2\d\d km from the mapped part of Zagreb/).waitFor();
    check("a person in Split is told how far the mapped area is", true, await text(page, "origin-note"));
    await page.context().close();
  }

  // 4. The buildings do not load: no answer, and the page says why.
  {
    const { page } = await open(browser, { geolocation: ON_THE_SQUARE, permissions: ["geolocation"] });
    await page.route("**/data/buildings.bin.gz", (route) => route.abort());
    await page.goto(URL);
    await page.getByText("The building data did not load").waitFor();
    check("a failed download is reported", await page.getByRole("button", { name: "Sun", exact: true }).isDisabled());
    await page.context().close();
  }

  // 5. Desktop width.
  {
    const { page, errors } = await open(browser, { viewport: { width: 1440, height: 900 }, geolocation: ON_THE_SQUARE, permissions: ["geolocation"] });
    await page.goto(URL);
    await page.getByRole("button", { name: "Shade", exact: true }).click();
    await expectPick(page, "desktop gives the same answer as the phone", ranking(START, "shade", "cafe")[0], START);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check("no sideways scroll at 1440 px", overflow <= 0 && errors.length === 0, `${overflow} px`);
    await page.context().close();
  }

  await browser.close();
} finally {
  server.kill();
}

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`);
  process.exit(1);
}
