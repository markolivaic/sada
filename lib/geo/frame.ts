// Local frame for the mapped box: x east, y north, in metres from the box centre.
// Plain equirectangular scaling. Across this box the east-west scale changes by about
// 0.01%, which is under 15 cm at the corners.

export const BOX = { west: 15.968, south: 45.808, east: 15.998, north: 45.82 } as const;
export const ORIGIN = { lng: 15.983, lat: 45.814 } as const;

const EARTH_RADIUS_M = 6371008.8;
const M_PER_DEG_LAT = (Math.PI / 180) * EARTH_RADIUS_M;
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);

export function toLocal(lng: number, lat: number): [number, number] {
  return [(lng - ORIGIN.lng) * M_PER_DEG_LNG, (lat - ORIGIN.lat) * M_PER_DEG_LAT];
}

export function toLngLat(x: number, y: number): [number, number] {
  return [ORIGIN.lng + x / M_PER_DEG_LNG, ORIGIN.lat + y / M_PER_DEG_LAT];
}

const [EAST_M, NORTH_M] = toLocal(BOX.east, BOX.north);
const [WEST_M, SOUTH_M] = toLocal(BOX.west, BOX.south);

/** The box in local metres. */
export const BOX_M = { west: WEST_M, south: SOUTH_M, east: EAST_M, north: NORTH_M } as const;

export function inBox(x: number, y: number): boolean {
  return x >= BOX_M.west && x <= BOX_M.east && y >= BOX_M.south && y <= BOX_M.north;
}

/**
 * Distance from a point inside the box to the box edge along a unit direction.
 * Returns 0 for a point outside the box.
 */
export function distanceToBoxEdge(x: number, y: number, dx: number, dy: number): number {
  if (!inBox(x, y)) return 0;
  const tx = dx > 0 ? (BOX_M.east - x) / dx : dx < 0 ? (BOX_M.west - x) / dx : Infinity;
  const ty = dy > 0 ? (BOX_M.north - y) / dy : dy < 0 ? (BOX_M.south - y) / dy : Infinity;
  return Math.min(tx, ty);
}
