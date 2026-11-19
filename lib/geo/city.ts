import Flatbush from "flatbush";

/** One building as plain numbers: rings in local metres, heights in metres above sea level. */
export interface BuildingInput {
  /** Outer rings and holes together, each an open list of [x, y]. Even-odd fill. */
  rings: number[][][];
  /** Highest point of the roof. */
  top: number;
  /** Ground level at the building. */
  ground: number;
}

/** All buildings in flat arrays, with a spatial index over their bounding boxes. */
export interface City {
  count: number;
  /** Ring index where each building starts, plus one final end entry. */
  buildingRingStart: Uint32Array;
  /** Vertex index where each ring starts, plus one final end entry. */
  ringStart: Uint32Array;
  /** x0, y0, x1, y1, ... in metres. Rings are open: the last vertex joins the first. */
  xy: Float32Array;
  top: Float32Array;
  ground: Float32Array;
  /** Centre of each building's bounding box. */
  centre: Float32Array;
  maxTop: number;
  index: Flatbush;
}

export function cityFromArrays(
  buildingRingStart: Uint32Array,
  ringStart: Uint32Array,
  xy: Float32Array,
  top: Float32Array,
  ground: Float32Array,
): City {
  const count = top.length;
  const centre = new Float32Array(count * 2);
  const index = new Flatbush(Math.max(count, 1));
  let maxTop = -Infinity;
  for (let b = 0; b < count; b++) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const from = ringStart[buildingRingStart[b]];
    const to = ringStart[buildingRingStart[b + 1]];
    for (let v = from; v < to; v++) {
      const x = xy[2 * v], y = xy[2 * v + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    index.add(minX, minY, maxX, maxY);
    centre[2 * b] = (minX + maxX) / 2;
    centre[2 * b + 1] = (minY + maxY) / 2;
    if (top[b] > maxTop) maxTop = top[b];
  }
  if (count === 0) index.add(0, 0, 0, 0);
  index.finish();
  return { count, buildingRingStart, ringStart, xy, top, ground, centre, maxTop, index };
}

export function cityFromBuildings(buildings: BuildingInput[]): City {
  const ringCount = buildings.reduce((n, b) => n + b.rings.length, 0);
  const vertexCount = buildings.reduce((n, b) => n + b.rings.reduce((m, r) => m + r.length, 0), 0);
  const buildingRingStart = new Uint32Array(buildings.length + 1);
  const ringStart = new Uint32Array(ringCount + 1);
  const xy = new Float32Array(vertexCount * 2);
  const top = new Float32Array(buildings.length);
  const ground = new Float32Array(buildings.length);
  let ring = 0, vertex = 0;
  buildings.forEach((building, b) => {
    buildingRingStart[b] = ring;
    top[b] = building.top;
    ground[b] = building.ground;
    for (const points of building.rings) {
      ringStart[ring++] = vertex;
      for (const [x, y] of points) {
        xy[2 * vertex] = x;
        xy[2 * vertex + 1] = y;
        vertex++;
      }
    }
  });
  buildingRingStart[buildings.length] = ring;
  ringStart[ring] = vertex;
  return cityFromArrays(buildingRingStart, ringStart, xy, top, ground);
}

/**
 * Calls `visit` for every edge of one building, holes included.
 * Coordinates are passed relative to (ox, oy).
 */
export function forEachEdge(
  city: City,
  building: number,
  ox: number,
  oy: number,
  visit: (x1: number, y1: number, x2: number, y2: number) => void,
): void {
  const { buildingRingStart, ringStart, xy } = city;
  for (let r = buildingRingStart[building]; r < buildingRingStart[building + 1]; r++) {
    const from = ringStart[r], to = ringStart[r + 1];
    let px = xy[2 * (to - 1)] - ox, py = xy[2 * (to - 1) + 1] - oy;
    for (let v = from; v < to; v++) {
      const x = xy[2 * v] - ox, y = xy[2 * v + 1] - oy;
      visit(px, py, x, y);
      px = x;
      py = y;
    }
  }
}
