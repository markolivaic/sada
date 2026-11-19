import { describe, expect, it } from "vitest";
import { holdAt } from "../lib/geo/hold.ts";
import { sunAt } from "../lib/geo/sun.ts";
import { blocks, rectangle } from "./support.ts";

const MINUTE_MS = 60_000;

// A wall running east to west, 12 m high and 800 m long, with its north face on y = 0.
const WALL_HEIGHT = 12;
const WALL_HALF_LENGTH = 400;
const wall = blocks({ rings: [rectangle(-WALL_HALF_LENGTH, -1, WALL_HALF_LENGTH, 0)], top: WALL_HEIGHT });

/**
 * Shade behind an east-west wall in closed form, for a point `distance` north of its middle.
 * The ray toward the sun reaches the wall line after distance / (-north) metres along the
 * ground. It is blocked if it meets the line within the wall's length and below its top.
 */
function shadedByWall(distance: number, date: Date): boolean {
  const sun = sunAt(date);
  if (sun.elevation <= 0) return true;
  if (sun.north >= 0) return false;
  const along = distance / -sun.north;
  return Math.abs(along * sun.east) <= WALL_HALF_LENGTH && along * Math.tan(sun.elevation) < WALL_HEIGHT;
}

describe("how long a point keeps its light", () => {
  // On 21 December the wall's shadow reaches 31.7 m at noon and further before and after,
  // so a point 40 m out is shaded in the morning, lit around noon and shaded again later.
  it("matches the wall formula to the minute", () => {
    let changes = 0;
    for (const distance of [20, 33, 40, 60]) {
      for (const [hour, minute] of [[8, 0], [9, 30], [10, 15], [11, 0], [12, 20]]) {
        const start = new Date(Date.UTC(2026, 11, 21, hour, minute));
        const shadeNow = shadedByWall(distance, start);
        let expected = 0;
        for (let m = 1; m <= 600 && expected === 0; m++) {
          if (shadedByWall(distance, new Date(start.getTime() + m * MINUTE_MS)) !== shadeNow) expected = m;
        }
        const hold = holdAt(wall, 0, distance, start);
        const label = `${distance} m from ${hour}:${String(minute).padStart(2, "0")}`;
        expect(hold.light, label).toBe(shadeNow ? "shade" : "sun");
        if (hold.until === "change") {
          expect(hold.minutes, label).toBe(expected);
          changes++;
        }
      }
    }
    expect(changes).toBeGreaterThanOrEqual(8);
  });

  it("finds the morning shade, the midday sun and the afternoon shade 40 m from the wall", () => {
    const morning = holdAt(wall, 0, 40, new Date(Date.UTC(2026, 11, 21, 8, 0)));
    expect(morning).toMatchObject({ light: "shade", until: "change" });
    const midday = holdAt(wall, 0, 40, new Date(Date.UTC(2026, 11, 21, 8, morning.minutes + 1)));
    expect(midday).toMatchObject({ light: "sun", until: "change" });
    const afternoon = holdAt(wall, 0, 40, new Date(Date.UTC(2026, 11, 21, 8, morning.minutes + midday.minutes + 2)));
    expect(afternoon.light).toBe("shade");
  });

  it("ends an open place's sun when the sun is too low for the box to settle it", () => {
    const hold = holdAt(blocks(), 0, 0, new Date(Date.UTC(2026, 5, 21, 11, 0)));
    expect(hold.light).toBe("sun");
    expect(hold.until).toBe("edge");
    // Solstice sunset in Zagreb is near 18:50 UTC; the answer has to stop before that.
    expect(hold.minutes).toBeGreaterThan(5 * 60);
    expect(hold.minutes).toBeLessThan(7 * 60 + 50);
  });

  it("keeps shade until sunset behind a wall that blocks the evening sun", () => {
    // A north-south wall just west of the point, on a winter afternoon.
    const west = blocks({ rings: [rectangle(-3, -400, -2, 400)], top: 30 });
    const hold = holdAt(west, 0, 0, new Date(Date.UTC(2026, 11, 21, 13, 30)));
    expect(hold).toMatchObject({ light: "shade", until: "sunset" });
  });
});
