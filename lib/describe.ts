import type { Hold } from "./geo/hold.ts";

const ZAGREB_CLOCK = new Intl.DateTimeFormat("hr-HR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zagreb" });

/** Clock time in Zagreb, "13:30", whatever time zone the device is in. */
export const clockText = (date: Date): string => ZAGREB_CLOCK.format(date);

/** "25 min", "about 1 h", "about 1 h 40 min". Rounded down, so it never promises more. */
export function durationText(minutes: number): string {
  if (minutes < 10) return `${minutes} min`;
  if (minutes < 60) return `${Math.floor(minutes / 5) * 5} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.floor((minutes % 60) / 10) * 10;
  return rest === 0 ? `about ${hours} h` : `about ${hours} h ${rest} min`;
}

/**
 * The headline for a place: "Sun until 13:30", "Shade until sunset",
 * "Sun until at least 17:10" when the sun then gets too low for the map to settle it.
 */
export function holdText(hold: Hold, at: Date): string {
  if (hold.light === "unknown") return "Sun too low to tell here";
  const light = hold.light === "sun" ? "Sun" : "Shade";
  if (hold.until === "sunset") return `${light} until sunset`;
  const end = clockText(new Date(at.getTime() + hold.minutes * 60_000));
  return hold.until === "edge" ? `${light} until at least ${end}` : `${light} until ${end}`;
}

export function distanceText(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres / 10) * 10} m`;
}

/**
 * The line under the headline: how long the light lasts and how far it is. `walk` comes
 * from the routing service; without it the line gives the straight-line distance and says so.
 */
export function whyText(hold: Hold, walk: { minutes: number; distanceM: number } | null, straightLineM: number): string {
  const lasts = hold.light === "unknown" ? null : `${durationText(hold.minutes)} left`;
  const far = walk
    ? `${Math.max(1, Math.round(walk.minutes))} min walk, ${distanceText(walk.distanceM)}`
    : `${distanceText(straightLineM)} in a straight line`;
  return lasts ? `${lasts}, ${far}` : far;
}

/**
 * Says where distances are measured from when it is not where the person stands.
 * `awayM` is how far the person is from the middle of the mapped area, when known.
 */
export function originNote(location: "locating" | "found" | "denied" | "unavailable", insideBox: boolean, awayM: number | null): string | null {
  if (location === "locating") return "Finding where you are. Until then, distances are from the middle of the mapped area.";
  if (location !== "found") return "Your location is not available, so distances are from the middle of the mapped area.";
  if (insideBox) return null;
  if (awayM !== null && awayM > 5000) return `You are about ${Math.round(awayM / 1000)} km from the mapped part of Zagreb. Distances are from its middle.`;
  return "You are just outside the mapped part of Zagreb. Distances are from its middle.";
}

/** Minutes from `now` to the next 09:00 on a Zagreb clock. */
export function minutesToNextMorning(now: Date): number {
  const [hours, minutes] = clockText(now).split(":").map(Number);
  const untilNine = (9 * 60 - (hours * 60 + minutes) + 24 * 60) % (24 * 60);
  return untilNine === 0 ? 24 * 60 : untilNine;
}
