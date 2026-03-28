import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const body = await req.json();
  const { light, seat } = body as { light: string; seat: string };

  // 1. Fetch user location.
  // 2. Fetch cafes/benches from OSM.
  // 3. Filter by distance using Google Directions API.
  // 4. Calculate Sun/Shade using SunCalc & Turf.js.
  // 5. Generate narration using Google Gemini API.

  void light;
  void seat;

  return NextResponse.json({
    destination: { lat: 45.8127, lng: 15.9785 },
    walkingDuration: "4 mins",
    narration:
      "Head south past the flower market — there's a bench on Bogovićeva with perfect afternoon sun and a view of the cathedral spire.",
  });
}
