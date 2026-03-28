import { NextResponse } from "next/server";

interface Location {
  id: string;
  name: string;
  lat: number;
  lng: number;
  category: string;
  tags: Record<string, string>;
}

const CATEGORY_QUERIES: Record<string, (r: number, lat: number, lng: number) => string> = {
  cafe:      (r, lat, lng) => `node["amenity"="cafe"](around:${r},${lat},${lng});`,
  bench:     (r, lat, lng) => `node["amenity"="bench"](around:${r},${lat},${lng});`,
  fountain:  (r, lat, lng) => `node["amenity"="drinking_water"](around:${r},${lat},${lng});`,
  viewpoint: (r, lat, lng) => `node["tourism"="viewpoint"](around:${r},${lat},${lng});`,
  park:      (r, lat, lng) => `node["leisure"="park"](around:${r},${lat},${lng});`,
  square:    (r, lat, lng) => `node["place"="square"](around:${r},${lat},${lng});`,
};

const ALL_CATEGORIES = Object.keys(CATEGORY_QUERIES);

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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get("lat") ?? "45.8130");
  const lng = parseFloat(searchParams.get("lng") ?? "15.9779");
  const radius = Math.min(5000, Math.max(100, parseInt(searchParams.get("radius") ?? "500") || 500));
  const categoriesParam = searchParams.get("categories");

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({
      locations: [],
      count: 0,
      fetchedAt: new Date().toISOString(),
      error: "Invalid lat/lng parameters",
    });
  }

  const activeCategories = categoriesParam && categoriesParam.trim().length > 0
    ? categoriesParam.split(",").filter((c) => c in CATEGORY_QUERIES)
    : ALL_CATEGORIES;

  if (activeCategories.length === 0) {
    return NextResponse.json({
      locations: [],
      count: 0,
      fetchedAt: new Date().toISOString(),
      error: "No valid categories provided",
    });
  }

  try {
    const fragments = activeCategories
      .map((cat) => CATEGORY_QUERIES[cat](radius, lat, lng))
      .join("\n");

    const overpassQuery = `[out:json][timeout:15];(\n${fragments}\n);out body;`;

    const overpassRes = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(overpassQuery)}`,
    });

    if (!overpassRes.ok) {
      throw new Error(`Overpass returned HTTP ${overpassRes.status}`);
    }

    const overpassData = await overpassRes.json();
    const elements: Array<{
      id: number;
      lat?: number;
      lon?: number;
      tags?: Record<string, string>;
    }> = overpassData.elements ?? [];

    const locations: Location[] = [];

    for (const el of elements) {
      if (el.lat === undefined || el.lon === undefined) continue;

      const category = deriveCategory(el.tags ?? {});
      if (!category) continue;

      locations.push({
        id: `osm-${el.id}`,
        name: el.tags?.name ?? DEFAULT_NAMES[category],
        lat: el.lat,
        lng: el.lon,
        category,
        tags: el.tags ?? {},
      });
    }

    const capped = locations.slice(0, 100);

    console.log(`[pois] Returned ${capped.length} locations (${activeCategories.join(",")}) near ${lat},${lng} r=${radius}`);

    return NextResponse.json({
      locations: capped,
      count: capped.length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[pois] Failed to fetch locations:", err);
    return NextResponse.json({
      locations: [],
      count: 0,
      fetchedAt: new Date().toISOString(),
      error: "Failed to fetch locations",
    });
  }
}
