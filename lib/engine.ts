import type { City } from "./geo/city.ts";
import { holdAt, type Hold } from "./geo/hold.ts";
import { lightAt, type Light } from "./geo/shade.ts";
import { sunAt } from "./geo/sun.ts";
import { nextPick, type Scored } from "./pick.ts";
import type { Category, Place } from "./places.ts";

/** Everything the page wants to know for one moment. */
export interface FrameRequest {
  timeMs: number;
  /** Where distances are measured from, in local metres. */
  origin: { x: number; y: number };
  ask: { want: "sun" | "shade"; category: Category } | null;
  /** Places already shown and passed over. */
  skip: string[];
  /** A place the person tapped, to describe. */
  detailId: string | null;
}

export interface FrameResult {
  timeMs: number;
  /** One code per place, in the order of the place list: index into LIGHTS. */
  lights: Uint8Array;
  pick: Scored | null;
  /** How many places of the asked kind have the asked light, skipped ones included. */
  matching: number;
  detail: { placeId: string; hold: Hold; distanceM: number } | null;
}

export const LIGHTS: Light[] = ["sun", "shade", "unknown"];

export interface Engine {
  places: Place[];
  frame(request: FrameRequest): FrameResult;
}

export function createEngine(city: City, places: Place[]): Engine {
  return {
    places,
    frame({ timeMs, origin, ask, skip, detailId }) {
      const time = new Date(timeMs);
      const sun = sunAt(time);
      const lit = places.map((place) => ({
        place,
        light: lightAt(city, place.x, place.y, sun),
        distanceM: Math.hypot(place.x - origin.x, place.y - origin.y),
      }));
      const night = sun.elevation <= 0;
      const pick = ask && !night ? nextPick(city, lit, ask.want, ask.category, time, new Set(skip)) : null;
      const matching = ask && !night ? lit.filter((l) => l.place.category === ask.category && l.light === ask.want).length : 0;
      const tapped = detailId === null ? undefined : lit.find((l) => l.place.id === detailId);
      return {
        timeMs,
        lights: Uint8Array.from(lit, (l) => LIGHTS.indexOf(l.light)),
        pick,
        matching,
        detail: tapped ? { placeId: tapped.place.id, hold: holdAt(city, tapped.place.x, tapped.place.y, time), distanceM: tapped.distanceM } : null,
      };
    },
  };
}
