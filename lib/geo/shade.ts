import { forEachEdge, type City } from "./city.ts";
import { distanceToBoxEdge } from "./frame.ts";
import type { Sun } from "./sun.ts";

/**
 * "unknown" means no building in the data blocks the sun, but the data ends too close
 * to say that nothing beyond it does.
 */
export type Light = "sun" | "shade" | "unknown";

/**
 * A building just outside the mapped box is assumed to stand no taller than this above
 * the point. 99% of the buildings inside the box are lower.
 */
export const EDGE_HEIGHT_M = 30;

/** Index of the building whose footprint contains the point, or -1. */
export function buildingAt(city: City, x: number, y: number): number {
  for (const b of city.index.search(x, y, x, y)) {
    let crossings = 0;
    forEachEdge(city, b, x, y, (x1, y1, x2, y2) => {
      if (y1 > 0 !== y2 > 0 && x1 + ((x2 - x1) * y1) / (y1 - y2) >= 0) crossings++;
    });
    if (crossings % 2 === 1) return b;
  }
  return -1;
}

/** Ground level at a point: the three nearest buildings' ground, weighted by distance. */
export function groundAt(city: City, x: number, y: number): number {
  const nearest = city.index.neighbors(x, y, 3);
  let sum = 0, weight = 0;
  for (const b of nearest) {
    const d2 = (city.centre[2 * b] - x) ** 2 + (city.centre[2 * b + 1] - y) ** 2;
    const w = 1 / (d2 + 1);
    sum += w * city.ground[b];
    weight += w;
  }
  return weight > 0 ? sum / weight : 0;
}

/**
 * Does one building block the ray from the point toward the sun?
 * `reach` is how far along the ray the building's roof is still above the ray.
 * A point under the roof is blocked.
 */
function blocks(city: City, building: number, x: number, y: number, sun: Sun, reach: number): boolean {
  let crossings = 0;
  let nearest = Infinity;
  forEachEdge(city, building, x, y, (x1, y1, x2, y2) => {
    // Rotate so the ray is the positive `along` axis; `across` changes sign where an edge crosses it.
    const across1 = x1 * sun.north - y1 * sun.east;
    const across2 = x2 * sun.north - y2 * sun.east;
    if (across1 > 0 === across2 > 0) return;
    const along1 = x1 * sun.east + y1 * sun.north;
    const along2 = x2 * sun.east + y2 * sun.north;
    const along = along1 + ((along2 - along1) * across1) / (across1 - across2);
    if (along < 0) return;
    crossings++;
    if (along < nearest) nearest = along;
  });
  if (crossings % 2 === 1) return true;
  return nearest < reach;
}

/**
 * Sun or shade at a point on the ground, from the buildings alone.
 * Each building is a flat-roofed prism from the ground up to its highest point.
 */
export function lightAt(city: City, x: number, y: number, sun: Sun, ground: number = groundAt(city, x, y)): Light {
  if (sun.elevation <= 0) return "shade";
  const rise = Math.tan(sun.elevation);
  const maxReach = Math.max(0, (city.maxTop - ground) / rise);
  const endX = x + sun.east * maxReach, endY = y + sun.north * maxReach;
  const candidates = city.index.search(Math.min(x, endX), Math.min(y, endY), Math.max(x, endX), Math.max(y, endY));
  for (const b of candidates) {
    const height = city.top[b] - ground;
    if (height <= 0) continue;
    if (blocks(city, b, x, y, sun, height / rise)) return "shade";
  }
  const toEdge = distanceToBoxEdge(x, y, sun.east, sun.north);
  return toEdge * rise < EDGE_HEIGHT_M ? "unknown" : "sun";
}
