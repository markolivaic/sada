import type { City } from "./geo/city.ts";
import { holdAt, type Hold } from "./geo/hold.ts";
import type { Light } from "./geo/shade.ts";
import type { Category, Place } from "./places.ts";

/** A place is worth walking to if it keeps its light at least this long. */
export const MIN_STAY_MINUTES = 20;

export interface Scored {
  place: Place;
  hold: Hold;
  /** Straight-line distance from the person asking, in metres. */
  distanceM: number;
}

export function scorePlaces(city: City, places: Place[], at: Date, from: { x: number; y: number }): Scored[] {
  return places.map((place) => ({
    place,
    hold: holdAt(city, place.x, place.y, at),
    distanceM: Math.hypot(place.x - from.x, place.y - from.y),
  }));
}

/**
 * The best place not in `skip`, working out "how long" only for as many places as needed:
 * the nearest one that keeps the wanted light for MIN_STAY_MINUTES, or failing that the
 * nearest one that has it now. Walks the same order as `rank`.
 */
export function nextPick(
  city: City,
  lit: { place: Place; light: Light; distanceM: number }[],
  want: "sun" | "shade",
  category: Category,
  at: Date,
  skip: ReadonlySet<string> = new Set(),
): Scored | null {
  const nearestFirst = lit
    .filter((l) => l.place.category === category && l.light === want && !skip.has(l.place.id))
    .sort((a, b) => a.distanceM - b.distanceM || (a.place.id < b.place.id ? -1 : 1));
  let fallback: Scored | null = null;
  for (const { place, distanceM } of nearestFirst) {
    const scored = { place, hold: holdAt(city, place.x, place.y, at), distanceM };
    if (scored.hold.minutes >= MIN_STAY_MINUTES) return scored;
    fallback ??= scored;
  }
  return fallback;
}

/**
 * Best first: places of the wanted kind that are in the wanted light now. Those that keep
 * it for MIN_STAY_MINUTES come before those about to lose it, and nearer comes before
 * farther. Places whose light is unknown are left out.
 */
export function rank(scored: Scored[], want: "sun" | "shade", category: Category): Scored[] {
  const lasting = (s: Scored) => s.hold.minutes >= MIN_STAY_MINUTES;
  return scored
    .filter((s) => s.place.category === category && s.hold.light === want)
    .sort((a, b) => Number(lasting(b)) - Number(lasting(a)) || a.distanceM - b.distanceM || (a.place.id < b.place.id ? -1 : 1));
}
