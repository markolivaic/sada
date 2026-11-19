import type { City } from "./city.ts";
import { toLngLat } from "./frame.ts";

/** One building for the map: a GeoJSON polygon or multipolygon with its height above ground. */
export interface FootprintFeature {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] };
  properties: { height: number };
}

function contains(ring: number[][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[j], [x2, y2] = ring[i];
    if (y1 > y !== y2 > y && x < x1 + ((x2 - x1) * (y - y1)) / (y2 - y1)) inside = !inside;
  }
  return inside;
}

/**
 * The buildings as GeoJSON, for drawing them as blocks. The bundle keeps a building's rings
 * as one flat list, so each ring is sorted here into an outline or a hole by whether it lies
 * inside another ring of the same building. Buildings no higher than their ground are left out.
 */
export function footprintFeatures(city: City): FootprintFeature[] {
  const features: FootprintFeature[] = [];
  const { buildingRingStart, ringStart, xy } = city;
  for (let b = 0; b < city.count; b++) {
    const height = city.top[b] - city.ground[b];
    if (height <= 0) continue;
    const rings: number[][][] = [];
    for (let r = buildingRingStart[b]; r < buildingRingStart[b + 1]; r++) {
      const ring: number[][] = [];
      for (let v = ringStart[r]; v < ringStart[r + 1]; v++) ring.push([xy[2 * v], xy[2 * v + 1]]);
      rings.push(ring);
    }
    const isHole = rings.map((ring, i) => rings.filter((other, j) => j !== i && contains(other, ring[0][0], ring[0][1])).length % 2 === 1);
    const closed = (ring: number[][]) => [...ring, ring[0]].map(([x, y]) => toLngLat(x, y));
    const polygons = rings
      .map((outline, i) => ({ outline, i }))
      .filter(({ i }) => !isHole[i])
      .map(({ outline }) => [closed(outline), ...rings.filter((ring, j) => isHole[j] && contains(outline, ring[0][0], ring[0][1])).map(closed)]);
    features.push({
      type: "Feature",
      geometry: polygons.length === 1 ? { type: "Polygon", coordinates: polygons[0] } : { type: "MultiPolygon", coordinates: polygons },
      properties: { height: Math.round(height * 10) / 10 },
    });
  }
  return features;
}
