import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface PoiDetailRequest {
  shadow: {
    currentState: "sun" | "shade";
    sunAltitudeDeg: number;
  };
  stableForMinutes?: number;
  userLocation?: { lat: number; lng: number };
  distanceMeters?: number;
  walkingMinutes?: number;
  poiName?: string;
  poiCategory?: string;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body: PoiDetailRequest = await req.json();

  const inSun = body.shadow.currentState === "sun";
  const distance = body.distanceMeters ?? 0;
  const walkMin = body.walkingMinutes ?? Math.round(distance / 80);
  const stableMin = body.stableForMinutes ?? 30;
  const name = body.poiName ?? "This spot";
  const category = body.poiCategory ?? "spot";

  const stableLabel =
    stableMin >= 240 ? "3+ hours"
    : stableMin >= 60 ? `${Math.floor(stableMin / 60)}h ${stableMin % 60 ? `${stableMin % 60}min` : ""}`
    : `${stableMin} min`;

  let description: string;

  try {
    const prompt = `You are Sada, a confident local friend who knows Zagreb intimately. Write ONE short sentence (max 20 words) about "${name}" (a ${category} in Zagreb).

Current conditions:
- It is currently in the ${inSun ? "sun" : "shade"}
- Sun altitude: ${body.shadow.sunAltitudeDeg.toFixed(0)}°
- Will stay in ${inSun ? "sun" : "shade"} for ~${stableLabel}
- ${walkMin} min walk away

Rules:
- Sound like a friend texting, not a tour guide
- Mention the sun/shade naturally
- Be specific to the place if you know it, otherwise be poetic about the vibe
- No emojis, no exclamation marks, no "Hey" or "Check out"
- Just one confident sentence`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    description = response.text?.trim() ?? "";

    if (!description) throw new Error("Empty response");
  } catch (err) {
    console.error("[poi-detail] Gemini failed:", err);
    description = inSun
      ? `${name} is catching full sun right now — ${stableLabel} of warmth left.`
      : `${name} is tucked in the shade — cool and steady for another ${stableLabel}.`;
  }

  return NextResponse.json({
    id,
    description,
    shadow: body.shadow,
    walkingMinutes: walkMin,
  });
}
