// How the map is lit for a given sun: which of the base map's times of day to show, and
// the two lights that fall on the buildings. Looks only; the answers do not come from here.

import type { LightsSpecification } from "mapbox-gl";
import type { Sun } from "./geo/sun.ts";

export interface Sky {
  phase: "night" | "low" | "day";
  /** The base map's own look for this time of day. */
  preset: "night" | "dawn" | "dusk" | "day";
  ambient: { color: string; intensity: number };
  sunlight: { color: string; intensity: number };
}

const DEG = 180 / Math.PI;
const mix = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));

export function skyFor(sun: Sun): Sky {
  const elevation = sun.elevation * DEG;
  if (elevation <= 0) {
    return { phase: "night", preset: "night", ambient: { color: "#8fa3d6", intensity: 0.45 }, sunlight: { color: "#8fa3d6", intensity: 0 } };
  }
  if (elevation <= 6) {
    const t = elevation / 6;
    // Before noon the low sun is in the east.
    return {
      phase: "low",
      preset: sun.east > 0 ? "dawn" : "dusk",
      ambient: { color: "#ffd9b8", intensity: mix(0.4, 0.5, t) },
      sunlight: { color: "#ff9d4d", intensity: mix(0.45, 0.7, t) },
    };
  }
  return {
    phase: "day",
    preset: "day",
    ambient: { color: "#f3f1ff", intensity: 0.5 },
    sunlight: { color: "#fff1d6", intensity: mix(0.75, 0.9, (elevation - 6) / 30) },
  };
}

/** An even light from the sky, and a directional one from where the sun stands that casts shadows. */
export function lightsFor(sun: Sun, sky: Sky): LightsSpecification[] {
  // Mapbox takes the direction to the light as a compass bearing and an angle from straight up.
  const fromVertical = Math.min(85, Math.max(0, 90 - sun.elevation * DEG));
  return [
    { id: "sky", type: "ambient", properties: { color: sky.ambient.color, intensity: sky.ambient.intensity } },
    {
      id: "sun",
      type: "directional",
      properties: {
        direction: [sun.bearing * DEG, fromVertical],
        color: sky.sunlight.color,
        intensity: sky.sunlight.intensity,
        // Always on: Mapbox decides whether a layer casts shadows when the layer is added, and
        // does not look again when the light changes. At night the shadows are only faded out.
        "cast-shadows": true,
        "shadow-intensity": sky.phase === "night" ? 0 : 0.9,
      },
    },
  ];
}
