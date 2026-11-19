import { forEachEdge, type City } from "./city.ts";
import { inBox } from "./frame.ts";
import { buildingAt } from "./shade.ts";

/** How far outside the wall a cafe's seats are taken to be. */
export const SEAT_OFFSET_M = 2;

export interface Seat {
  x: number;
  y: number;
  /** True when the mapped point was under a roof and the seat was moved outside. */
  moved: boolean;
}

/**
 * Where to judge sun and shade for a mapped place.
 *
 * OpenStreetMap puts most cafes at a point inside their building, where it is always
 * shade. For those, the seat is taken to be outside the nearest wall that has open air in
 * front of it. Walls shared with the next building are skipped. Returns null when no wall
 * of the building opens onto free ground inside the box.
 */
export function seatFor(city: City, x: number, y: number): Seat | null {
  const building = buildingAt(city, x, y);
  if (building < 0) return { x, y, moved: false };

  const candidates: { distance: number; x: number; y: number }[] = [];
  forEachEdge(city, building, x, y, (x1, y1, x2, y2) => {
    const ex = x2 - x1, ey = y2 - y1;
    const length2 = ex * ex + ey * ey;
    if (length2 === 0) return;
    // Closest point of the edge to the mapped point, which is the origin here.
    const t = Math.max(0, Math.min(1, -(x1 * ex + y1 * ey) / length2));
    const cx = x1 + t * ex, cy = y1 + t * ey;
    // The edge's normal, turned to point away from the mapped point.
    const length = Math.sqrt(length2);
    let nx = ey / length, ny = -ex / length;
    if (nx * cx + ny * cy < 0) {
      nx = -nx;
      ny = -ny;
    }
    candidates.push({ distance: Math.hypot(cx, cy), x: x + cx + nx * SEAT_OFFSET_M, y: y + cy + ny * SEAT_OFFSET_M });
  });
  candidates.sort((a, b) => a.distance - b.distance);
  for (const candidate of candidates) {
    if (inBox(candidate.x, candidate.y) && buildingAt(city, candidate.x, candidate.y) < 0) {
      return { x: candidate.x, y: candidate.y, moved: true };
    }
  }
  return null;
}
