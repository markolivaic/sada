// Turns the ZG3D footprints into the binary bundle the app loads, plus its manifest.
//
// The source has each building's footprint and the lowest and highest point of its 3D solid
// (Z_Min, Z_Max). A solid's lowest point is not always street level: some solids are roof
// parts that sit on another building, and a few reach far below the street. So the ground
// under each building is checked against a plane fitted through its neighbours' bases, and
// replaced by that plane where it is more than GROUND_TOLERANCE_M away.

import { createHash } from "node:crypto";
import { encodeBundle, type BundleLayout } from "../lib/geo/bundle.ts";
import type { BuildingInput } from "../lib/geo/city.ts";
import { BOX, ORIGIN, toLocal } from "../lib/geo/frame.ts";

export const SOURCE = "data/source/zg3d_buildings.geojson";
export const BIN_GZ = "public/data/buildings.bin.gz";
export const MANIFEST = "public/data/buildings.json";

const NEIGHBOUR_RADIUS_M = 60;
const MIN_NEIGHBOURS = 6;
const MIN_WALL_M = 3; // a solid this tall or taller is taken to stand on the ground
const GROUND_TOLERANCE_M = 3;
// A record with no volume that holds this many other buildings is a block outline. The three
// in the data hold 97 to 119; no other record without volume holds more than 4.
const OUTLINE_MIN_CONTAINED = 10;

interface Feature {
  geometry: { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] };
  properties: { OBJECTID: number; Godina_izv: string; Izvor: string; Z_Min: number; Z_Max: number; Volume: number };
}

export interface Manifest {
  source: {
    file: string;
    bytes: number;
    sha256: string;
    dataset: string;
    publisher: string;
    url: string;
    licence: string;
    features: number;
    /** OBJECTIDs of records left out because they outline a whole block. */
    blockOutlines: number[];
    /** Records kept, by survey. */
    surveys: Record<string, number>;
  };
  box: typeof BOX;
  origin: typeof ORIGIN;
  ground: { method: string; kept: number; replacedAbove: number; replacedBelow: number; tooFewNeighbours: number };
  heightAboveGroundM: { median: number; p95: number; p99: number; max: number; notAboveGround: number };
  /** `file` is gzip-compressed; the hash and `bytes` are of the bundle once unpacked. */
  bundle: BundleLayout & { file: string; sha256Unpacked: string; droppedBuildings: number };
}

export const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const round = (value: number, digits: number) => Number(value.toFixed(digits));

function quantile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

interface Sample { dx: number; dy: number; z: number; w: number }

const det3 = (m: number[][]) =>
  m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
  m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
  m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

/** Weighted least-squares plane z = a + b*dx + c*dy, or null when the samples lie on a line. */
function fitPlane(samples: Sample[]): [number, number, number] | null {
  let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0, sz = 0, sxz = 0, syz = 0;
  for (const { dx, dy, z, w } of samples) {
    sw += w; sx += w * dx; sy += w * dy;
    sxx += w * dx * dx; sxy += w * dx * dy; syy += w * dy * dy;
    sz += w * z; sxz += w * dx * z; syz += w * dy * z;
  }
  const d = det3([[sw, sx, sy], [sx, sxx, sxy], [sy, sxy, syy]]);
  // Compared with the scale of the sums, so the test does not depend on how many samples there are.
  if (Math.abs(d) < 1e-9 * sw * sxx * syy) return null;
  return [
    det3([[sz, sx, sy], [sxz, sxx, sxy], [syz, sxy, syy]]) / d,
    det3([[sw, sz, sy], [sx, sxz, sxy], [sy, syz, syy]]) / d,
    det3([[sw, sx, sz], [sx, sxx, sxz], [sy, sxy, syz]]) / d,
  ];
}

/**
 * Ground at the origin of the samples' offsets. Fits a plane, then fits again with little
 * weight on samples far off the first plane. Falls back to the median when no plane fits.
 */
function groundFromNeighbours(samples: Sample[]): number {
  const first = fitPlane(samples);
  if (!first) return quantile(samples.map((s) => s.z), 0.5);
  for (const s of samples) {
    const off = s.z - (first[0] + first[1] * s.dx + first[2] * s.dy);
    s.w = 1 / (1 + (off / GROUND_TOLERANCE_M) ** 2);
  }
  return (fitPlane(samples) ?? first)[0];
}

function insideRing(ring: number[][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[j], [x2, y2] = ring[i];
    if (y1 > y !== y2 > y && x < x1 + ((x2 - x1) * (y - y1)) / (y2 - y1)) inside = !inside;
  }
  return inside;
}

/**
 * Records that outline a whole city block rather than a building: they have no 3D solid
 * (Volume 0) and their footprint holds many buildings that are in the data on their own.
 * Kept, one would stand as a single block tens of metres high over every street and
 * courtyard inside it.
 */
function blockOutlines(features: Feature[]): Set<number> {
  const outerOf = (feature: Feature) => (feature.geometry.type === "Polygon" ? feature.geometry.coordinates[0] : feature.geometry.coordinates[0][0]);
  const centroids = features.map((feature) => {
    const ring = outerOf(feature);
    return [ring.reduce((sum, c) => sum + c[0], 0) / ring.length, ring.reduce((sum, c) => sum + c[1], 0) / ring.length];
  });
  const outlines = new Set<number>();
  features.forEach((feature, i) => {
    if (feature.properties.Volume > 0) return;
    const ring = outerOf(feature);
    let contained = 0;
    centroids.forEach(([x, y], j) => {
      if (j !== i && insideRing(ring, x, y)) contained++;
    });
    if (contained >= OUTLINE_MIN_CONTAINED) outlines.add(i);
  });
  return outlines;
}

export function buildBundle(sourceBytes: Uint8Array): { bin: Uint8Array; manifest: Manifest; manifestText: string } {
  const all: Feature[] = JSON.parse(Buffer.from(sourceBytes).toString("utf8")).features;
  const outlines = blockOutlines(all);
  const features = all.filter((_, i) => !outlines.has(i));

  const surveys: Record<string, number> = {};
  const raw = features.map((feature) => {
    const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    // GeoJSON rings repeat their first point at the end; the bundle keeps rings open.
    const rings = polygons.flatMap((polygon) => polygon.map((ring) => ring.slice(0, -1).map(([lng, lat]) => toLocal(lng, lat))));
    const outer = polygons.flatMap((polygon) => polygon[0]);
    const [cx, cy] = toLocal(
      outer.reduce((sum, c) => sum + c[0], 0) / outer.length,
      outer.reduce((sum, c) => sum + c[1], 0) / outer.length,
    );
    const survey = `${feature.properties.Godina_izv} ${feature.properties.Izvor}`;
    surveys[survey] = (surveys[survey] ?? 0) + 1;
    return { rings, cx, cy, base: feature.properties.Z_Min, top: feature.properties.Z_Max };
  });

  // Neighbour lookup on a coarse grid, over solids tall enough to stand on the ground.
  const cell = (v: number) => Math.floor(v / NEIGHBOUR_RADIUS_M);
  const grid = new Map<string, number[]>();
  raw.forEach((b, i) => {
    if (b.top - b.base < MIN_WALL_M) return;
    const key = `${cell(b.cx)},${cell(b.cy)}`;
    grid.set(key, [...(grid.get(key) ?? []), i]);
  });

  let replacedAbove = 0, replacedBelow = 0, tooFewNeighbours = 0;
  const ground = raw.map((b, i) => {
    const near: Sample[] = [];
    for (let gx = cell(b.cx) - 1; gx <= cell(b.cx) + 1; gx++) {
      for (let gy = cell(b.cy) - 1; gy <= cell(b.cy) + 1; gy++) {
        for (const j of grid.get(`${gx},${gy}`) ?? []) {
          if (j === i) continue;
          const dx = raw[j].cx - b.cx, dy = raw[j].cy - b.cy;
          if (Math.hypot(dx, dy) <= NEIGHBOUR_RADIUS_M) near.push({ dx, dy, z: raw[j].base, w: 1 });
        }
      }
    }
    if (near.length < MIN_NEIGHBOURS) {
      tooFewNeighbours++;
      return b.base;
    }
    const fitted = groundFromNeighbours(near);
    if (b.base - fitted > GROUND_TOLERANCE_M) {
      replacedAbove++;
      return fitted;
    }
    if (b.base - fitted < -GROUND_TOLERANCE_M) {
      replacedBelow++;
      return fitted;
    }
    return b.base;
  });

  const buildings: BuildingInput[] = raw.map((b, i) => ({ rings: b.rings, top: b.top, ground: ground[i] }));
  const { bin, layout, dropped } = encodeBundle(buildings);
  const heights = buildings.map((b) => b.top - b.ground);

  const manifest: Manifest = {
    source: {
      file: SOURCE,
      bytes: sourceBytes.byteLength,
      sha256: sha256(sourceBytes),
      dataset: "ZG3D 2022 3D model Grada Zagreba",
      publisher: "Grad Zagreb",
      url: "https://data.zagreb.hr/dataset/zg3d-2022-3d-model-gz",
      licence: "Otvorena dozvola (Open Licence), http://data.gov.hr/otvorena-dozvola",
      features: all.length,
      blockOutlines: [...outlines].map((i) => all[i].properties.OBJECTID).sort((a, b) => a - b),
      surveys,
    },
    box: BOX,
    origin: ORIGIN,
    ground: {
      method: `plane through the bases of neighbours within ${NEIGHBOUR_RADIUS_M} m; a base more than ${GROUND_TOLERANCE_M} m off the plane is replaced by it`,
      kept: features.length - replacedAbove - replacedBelow,
      replacedAbove,
      replacedBelow,
      tooFewNeighbours,
    },
    heightAboveGroundM: {
      median: round(quantile(heights, 0.5), 1),
      p95: round(quantile(heights, 0.95), 1),
      p99: round(quantile(heights, 0.99), 1),
      max: round(quantile(heights, 1), 1),
      notAboveGround: heights.filter((h) => h <= 0).length,
    },
    bundle: { file: BIN_GZ, sha256Unpacked: sha256(bin), droppedBuildings: dropped, ...layout },
  };
  return { bin, manifest, manifestText: JSON.stringify(manifest, null, 2) + "\n" };
}
