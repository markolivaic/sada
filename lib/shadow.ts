import SunCalc from "suncalc";

export function getSunState(
  lat: number,
  lng: number,
  date: Date = new Date()
): "sun" | "shade" {
  const pos = SunCalc.getPosition(date, lat, lng);
  const altDeg = (pos.altitude * 180) / Math.PI;
  if (altDeg <= 0) return "shade";
  if (altDeg <= 6) return "shade";
  return "sun";
}

export function getMinutesUntilStateChange(
  lat: number,
  lng: number,
  currentState: "sun" | "shade",
  date: Date = new Date()
): number {
  const STEP = 5;
  const MAX_STEPS = 48;
  for (let i = 1; i <= MAX_STEPS; i++) {
    const future = new Date(date.getTime() + i * STEP * 60 * 1000);
    if (getSunState(lat, lng, future) !== currentState) {
      return i * STEP;
    }
  }
  return MAX_STEPS * STEP;
}

export function getShadowMetadata(
  lat: number,
  lng: number
): {
  currentState: "sun" | "shade";
  minutesUntilChange: number;
  stableFor: string;
  sunAltitudeDeg: number;
} {
  const now = new Date();
  const pos = SunCalc.getPosition(now, lat, lng);
  const sunAltitudeDeg = parseFloat(
    ((pos.altitude * 180) / Math.PI).toFixed(1)
  );
  const currentState = getSunState(lat, lng, now);
  const minutesUntilChange = getMinutesUntilStateChange(
    lat,
    lng,
    currentState,
    now
  );
  const stableFor =
    minutesUntilChange >= 240 ? "3+ hours" : `${minutesUntilChange} min`;
  return { currentState, minutesUntilChange, stableFor, sunAltitudeDeg };
}
