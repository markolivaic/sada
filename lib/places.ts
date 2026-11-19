import type { City } from "./geo/city.ts";
import { toLngLat, toLocal } from "./geo/frame.ts";
import { seatFor } from "./geo/seat.ts";

export type Category = "cafe" | "bench";

/** One entry of data/osm/places.json. */
export interface SnapshotPlace {
  id: string;
  category: string;
  name: string | null;
  lat: number;
  lng: number;
  outdoorSeating: string | null;
}

export interface Place {
  id: string;
  category: Category;
  name: string;
  /** Where OpenStreetMap has it. */
  lng: number;
  lat: number;
  /** Where sun and shade are judged, in local metres and as coordinates. */
  x: number;
  y: number;
  seatLng: number;
  seatLat: number;
  /** True when the seat was moved from under a roof to outside the nearest open wall. */
  moved: boolean;
}

const FALLBACK_NAME: Record<Category, string> = { cafe: "Café", bench: "Bench" };

/** Places with a seat point. `withoutSeat` counts those dropped because none was found. */
export function placesFrom(snapshot: SnapshotPlace[], city: City): { places: Place[]; withoutSeat: number } {
  const places: Place[] = [];
  let withoutSeat = 0;
  for (const entry of snapshot) {
    if (entry.category !== "cafe" && entry.category !== "bench") continue;
    const [x, y] = toLocal(entry.lng, entry.lat);
    const seat = seatFor(city, x, y);
    if (!seat) {
      withoutSeat++;
      continue;
    }
    const [seatLng, seatLat] = toLngLat(seat.x, seat.y);
    places.push({
      id: entry.id,
      category: entry.category,
      name: entry.name ?? FALLBACK_NAME[entry.category],
      lng: entry.lng,
      lat: entry.lat,
      x: seat.x,
      y: seat.y,
      seatLng,
      seatLat,
      moved: seat.moved,
    });
  }
  return { places, withoutSeat };
}
