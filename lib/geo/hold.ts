import type { City } from "./city.ts";
import { groundAt, lightAt, type Light } from "./shade.ts";
import { sunAt } from "./sun.ts";

/**
 * How long a point keeps the light it has now.
 * `until` says what ends it: the light changes, the sun sets, or the sun gets so low
 * that the mapped box no longer settles the answer.
 */
export interface Hold {
  light: Light;
  minutes: number;
  until: "change" | "sunset" | "edge";
}

const MINUTE_MS = 60_000;
const DAY_MINUTES = 24 * 60;

/** Scans forward one minute at a time from `start`. */
export function holdAt(city: City, x: number, y: number, start: Date): Hold {
  const ground = groundAt(city, x, y);
  const light = lightAt(city, x, y, sunAt(start), ground);
  if (light === "unknown") return { light, minutes: 0, until: "edge" };
  for (let minutes = 1; minutes <= DAY_MINUTES; minutes++) {
    const sun = sunAt(new Date(start.getTime() + minutes * MINUTE_MS));
    if (sun.elevation <= 0) return { light, minutes, until: "sunset" };
    const next = lightAt(city, x, y, sun, ground);
    if (next === light) continue;
    return { light, minutes, until: next === "unknown" ? "edge" : "change" };
  }
  return { light, minutes: DAY_MINUTES, until: "sunset" };
}
