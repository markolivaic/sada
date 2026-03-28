import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

function deriveCategory(tags: Record<string, string>): string | null {
  if (tags?.amenity === "cafe") return "cafe";
  if (tags?.amenity === "bench") return "bench";
  if (tags?.amenity === "drinking_water") return "fountain";
  if (tags?.tourism === "viewpoint") return "viewpoint";
  if (tags?.leisure === "park") return "park";
  if (tags?.place === "square") return "square";
  return null;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: {
    shadow: { currentState: "sun" | "shade"; sunAltitudeDeg: number };
    userLocation?: { lat: number; lng: number };
    distanceMeters: number;
    walkingMinutes: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { shadow, distanceMeters, walkingMinutes } = body;

  if (
    !shadow ||
    !shadow.currentState ||
    shadow.sunAltitudeDeg === undefined ||
    distanceMeters === undefined ||
    walkingMinutes === undefined
  ) {
    return NextResponse.json(
      { error: "Missing required fields: shadow, distanceMeters, walkingMinutes" },
      { status: 400 }
    );
  }

  let name = "this spot";
  let category = "location";

  const makeFallback = (n: string) =>
    shadow.currentState === "sun"
      ? `${n} is catching full sun right now — ${walkingMinutes} min walk from you.`
      : `${n} is shaded right now — ${walkingMinutes} min walk if you want to cool down.`;

  try {
    const osmId = id.replace("osm-", "");

    if (!/^\d+$/.test(osmId)) {
      return NextResponse.json(
        { error: "Invalid OSM ID format" },
        { status: 400 }
      );
    }
    const query = `[out:json];node(${osmId});out body;`;

    try {
      const overpassRes = await fetch(
        "https://overpass-api.de/api/interpreter",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(query)}`,
        }
      );
      const overpassData = await overpassRes.json();
      const el = overpassData.elements?.[0];
      if (el) {
        name = el.tags?.name ?? "this spot";
        category = deriveCategory(el.tags ?? {}) ?? "location";
      }
    } catch (e) {
      console.error("[poi-detail] Overpass fetch failed, using fallbacks:", e);
    }

    const hour = parseInt(
      new Date().toLocaleString("en-US", {
        timeZone: "Europe/Zagreb",
        hour: "numeric",
        hour12: false,
      })
    );
    const timeOfDay =
      hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";

    const fallbackDescription = makeFallback(name);

    let description = fallbackDescription;
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: `You are Sada, a hyperlocal Zagreb guide. A user just tapped on ${name} (a ${category}) on the map. Here is the real-time context:
- Shadow state: ${shadow.currentState} (sun altitude: ${shadow.sunAltitudeDeg}°)
- Walking distance: ${distanceMeters}m (about ${walkingMinutes} min)
- Time of day: ${timeOfDay} in Zagreb

Write exactly 2 sentences. Sentence 1: describe the current condition of this specific spot right now — reference whether it is in sun or shade and what that means for sitting here at this time of day. Sentence 2: give one sharp local detail about this type of place in Zagreb at this time of day, and whether the walk is worth it right now.

Rules: No greetings. No emojis. Start with a verb. Never say 'perfect spot' or 'great choice'.`,
      });
      description = response.text || fallbackDescription;
    } catch (e) {
      console.error("[poi-detail] Gemini generation failed:", e);
    }

    return NextResponse.json({
      id,
      description,
      shadow: {
        currentState: shadow.currentState,
        sunAltitudeDeg: shadow.sunAltitudeDeg,
      },
      walkingMinutes,
    });
  } catch (error) {
    console.error("[poi-detail] Unexpected error:", error);
    return NextResponse.json({
      id,
      description: makeFallback(name),
      shadow,
      walkingMinutes,
    });
  }
}
