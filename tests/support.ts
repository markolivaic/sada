import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { decodeBundle } from "../lib/geo/bundle.ts";
import { cityFromBuildings, forEachEdge, type City } from "../lib/geo/city.ts";
import { sunFromAngles, type Sun } from "../lib/geo/sun.ts";
import type { Manifest } from "../scripts/buildings.ts";

export const RAD = Math.PI / 180;

/** Sun given in degrees: elevation above the horizon and compass bearing. */
export const sunDeg = (elevation: number, bearing: number): Sun => sunFromAngles(elevation * RAD, bearing * RAD);

/** A city of flat-roofed blocks standing on level ground at height 0. */
export function blocks(...footprints: { rings: number[][][]; top: number }[]): City {
  return cityFromBuildings(footprints.map((f) => ({ ...f, ground: 0 })));
}

export const rectangle = (x0: number, y0: number, x1: number, y1: number): number[][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

export function readManifest(): Manifest {
  return JSON.parse(readFileSync("public/data/buildings.json", "utf8"));
}

/** The committed bundle, unpacked. */
export function readBundle(): Uint8Array {
  return gunzipSync(readFileSync("public/data/buildings.bin.gz"));
}

export function readCity(): City {
  const bin = readBundle();
  return decodeBundle(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, readManifest().bundle);
}

function inRings(city: City, building: number, x: number, y: number): boolean {
  let inside = false;
  forEachEdge(city, building, x, y, (x1, y1, x2, y2) => {
    if (y1 > 0 !== y2 > 0 && x1 + ((x2 - x1) * y1) / (y1 - y2) > 0) inside = !inside;
  });
  return inside;
}

/**
 * Is the point inside the shadow some building casts on level ground at `ground`?
 * Works forward from each building instead of back from the point: a prism's shadow is its
 * footprint swept along the shadow vector, which is the footprint, the footprint moved by
 * that vector, and the parallelogram each edge sweeps on the way. No index, every building.
 */
export function inSweptShadow(city: City, x: number, y: number, sun: Sun, ground: number): boolean {
  const rise = Math.tan(sun.elevation);
  for (let b = 0; b < city.count; b++) {
    const height = city.top[b] - ground;
    if (height <= 0) continue;
    const vx = (-sun.east * height) / rise, vy = (-sun.north * height) / rise;
    if (inRings(city, b, x, y) || inRings(city, b, x - vx, y - vy)) return true;
    let hit = false;
    forEachEdge(city, b, x, y, (x1, y1, x2, y2) => {
      if (hit) return;
      // Solve origin = p1 + s*(p2 - p1) + t*v for s, t in [0, 1].
      const ex = x2 - x1, ey = y2 - y1;
      const d = ex * vy - ey * vx;
      if (d === 0) return;
      const s = (-x1 * vy + y1 * vx) / d;
      const t = (-ex * y1 + ey * x1) / d;
      if (s >= 0 && s <= 1 && t >= 0 && t <= 1) hit = true;
    });
    if (hit) return true;
  }
  return false;
}

/** Small repeatable random number generator, so sampled tests give the same points every run. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
