import { NextResponse } from "next/server";
import { getShadowMetadata, getSunState } from "@/lib/shadow";
import polyline from "@mapbox/polyline";

const CATEGORY_QUERIES: Record<string, (lat: number, lng: number) => string> = {
  cafe:      (lat, lng) => `node["amenity"="cafe"](around:800,${lat},${lng});`,
  bench:     (lat, lng) => `node["amenity"="bench"](around:800,${lat},${lng});`,
  fountain:  (lat, lng) => `node["amenity"="drinking_water"](around:800,${lat},${lng});`,
  viewpoint: (lat, lng) => `node["tourism"="viewpoint"](around:800,${lat},${lng});`,
  park:      (lat, lng) => `node["leisure"="park"](around:800,${lat},${lng});`,
  square:    (lat, lng) => `node["place"="square"](around:800,${lat},${lng});`,
};

const DEFAULT_NAMES: Record<string, string> = {
  cafe: "Cafe",
  bench: "Bench",
  fountain: "Fountain",
  viewpoint: "Viewpoint",
  park: "Park",
  square: "Square",
};

function deriveCategory(tags: Record<string, string>): string | null {
  if (tags?.amenity === "cafe") return "cafe";
  if (tags?.amenity === "bench") return "bench";
  if (tags?.amenity === "drinking_water") return "fountain";
  if (tags?.tourism === "viewpoint") return "viewpoint";
  if (tags?.leisure === "park") return "park";
  if (tags?.place === "square") return "square";
  return null;
}

export async function POST(req: Request) {
  const body = await req.json();
  const light: "sun" | "shade" = body.light;
  const seat: string = body.seat;
  const exclude: string[] = body.exclude ?? [];
  const userLocation = body.userLocation ?? { lat: 45.8130, lng: 15.9779 };

  try {
    // Step 1 — Overpass query
    const queryFn = CATEGORY_QUERIES[seat] ?? CATEGORY_QUERIES["cafe"];
    const amenityQuery = queryFn(userLocation.lat, userLocation.lng);
    const overpassQuery = `[out:json];${amenityQuery}out center body;`;

    const overpassRes = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: `data=${encodeURIComponent(overpassQuery)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const overpassData = await overpassRes.json();
    const elements = overpassData.elements;

    if (!elements || elements.length === 0) {
      throw new Error("No POIs returned from Overpass");
    }

    // Step 2 — Filter exclusions
    const filtered = elements.filter(
      (el: { lat: number; lon: number; center?: { lat: number; lon: number } }) => {
        const elLat = el.lat ?? el.center?.lat;
        const elLon = el.lon ?? el.center?.lon;
        return !exclude.includes(`${elLat},${elLon}`);
      }
    );
    const afterExclude = filtered.length > 0 ? filtered : elements;

    // Step 3 — Shadow preference filter
    const shadowFiltered = afterExclude.filter(
      (el: { lat: number; lon: number }) => {
        const state = getSunState(el.lat, el.lon);
        return light === "sun" ? state === "sun" : state === "shade";
      }
    );
    const pool = shadowFiltered.length > 0 ? shadowFiltered : afterExclude;

    // Step 4 — Google Directions (full route)
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    const dirUrl =
      `https://maps.googleapis.com/maps/api/directions/json` +
      `?origin=${userLocation.lat},${userLocation.lng}` +
      `&destination=${chosen.lat},${chosen.lon}` +
      `&mode=walking` +
      `&key=${process.env.GOOGLE_MAPS_API_KEY}`;

    const dirRes = await fetch(dirUrl);
    const dirData = await dirRes.json();

    const walkingDuration: string =
      dirData.routes?.[0]?.legs?.[0]?.duration?.text ?? "5 mins";
    const durationSeconds: number =
      dirData.routes?.[0]?.legs?.[0]?.duration?.value ?? 300;
    const distanceMeters: number =
      dirData.routes?.[0]?.legs?.[0]?.distance?.value ?? 400;
    const encodedPolyline: string =
      dirData.routes?.[0]?.overview_polyline?.points ?? "";

    const coordinates: [number, number][] = encodedPolyline
      ? polyline.decode(encodedPolyline).map(([lat, lng]) => [lng, lat])
      : [[userLocation.lng, userLocation.lat], [chosen.lon, chosen.lat]];

    // Step 5 — Shadow metadata for chosen spot (consumed by narration endpoint)
    const shadow = getShadowMetadata(chosen.lat, chosen.lon);
    void shadow;

    // Step 6 — Response
    const derivedCategory = deriveCategory(chosen.tags ?? {}) ?? seat;

    return NextResponse.json({
      destination: {
        id: `osm-${chosen.id}`,
        name: chosen.tags?.name ?? DEFAULT_NAMES[derivedCategory] ?? DEFAULT_NAMES[seat] ?? "Spot",
        lat: chosen.lat,
        lng: chosen.lon,
        category: derivedCategory,
      },
      route: {
        coordinates,
        distanceMeters,
        durationMinutes: Math.round(durationSeconds / 60),
      },
      walkingDuration,
    });
  } catch (error) {
    // Step 9 — Error handling
    console.error(error);

    return NextResponse.json({
      destination: {
        id: "fallback",
        name: light === "shade" ? "Zrinjevac" : "Cogito Coffee",
        lat: light === "shade" ? 45.8117 : 45.8134,
        lng: light === "shade" ? 15.9772 : 15.9772,
        category: seat,
      },
      route: {
        coordinates: [
          [15.9779, 45.8130],
          [15.9775, 45.8135],
          [15.9772, 45.8134],
        ],
        distanceMeters: 180,
        durationMinutes: 2,
      },
      walkingDuration: "2 mins",
    });
  }
}
