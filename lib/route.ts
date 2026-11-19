/** A walking route: the line to draw, its length and how long it takes. */
export interface Walk {
  coordinates: [number, number][];
  distanceM: number;
  minutes: number;
}

interface LngLat {
  lng: number;
  lat: number;
}

export class RouteError extends Error {}

export function directionsUrl(from: LngLat, to: LngLat, token: string): string {
  const path = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  return `https://api.mapbox.com/directions/v5/mapbox/walking/${path}?geometries=geojson&overview=full&access_token=${token}`;
}

/** Reads a Mapbox Directions answer. Throws RouteError when it holds no usable route. */
export function parseDirections(body: unknown): Walk {
  const route = (body as { routes?: { distance?: unknown; duration?: unknown; geometry?: { coordinates?: unknown } }[] })?.routes?.[0];
  const coordinates = route?.geometry?.coordinates;
  if (
    !route ||
    typeof route.distance !== "number" ||
    typeof route.duration !== "number" ||
    !Array.isArray(coordinates) ||
    coordinates.length < 2
  ) {
    throw new RouteError("no walking route in the answer");
  }
  return { coordinates: coordinates as [number, number][], distanceM: route.distance, minutes: route.duration / 60 };
}

/** Asks Mapbox for a walking route. Throws RouteError on any failure; there is no stand-in route. */
export async function walkRoute(from: LngLat, to: LngLat, token: string, signal?: AbortSignal): Promise<Walk> {
  let response: Response;
  try {
    response = await fetch(directionsUrl(from, to, token), { signal });
  } catch (cause) {
    throw new RouteError("the routing service could not be reached", { cause });
  }
  if (!response.ok) throw new RouteError(`the routing service answered ${response.status}`);
  return parseDirections(await response.json());
}
