# Sada

Every other map tells you where things are. Sada tells you where to be.

## What it does

You tap one button. Sada picks a real place nearby, tells you how to walk there, and explains in two sentences why that spot is worth going to right now. The recommendation accounts for actual sunlight conditions at the current time of day, not just distance or ratings.

Shadow geometry is computed from Zagreb's ZG3D LiDAR dataset using SunCalc for sun angle and Turf.js for polygon projection. Each point of interest gets a shadow score based on whether its footprint is in light or shade at the moment the request is made. That score feeds directly into which result gets returned.

Gemini 2.0 Flash writes a two-sentence narration for every destination. It receives the place name, category, shadow condition, time of day, and distance, and returns something specific to that place at that moment, not a generic description.

<img width="2554" height="1301" alt="image" src="https://github.com/user-attachments/assets/3148b2ad-523d-43c0-8e3d-2216a98d0fac" />


## How it works

There are three main API routes. The `/api/sada/pois` endpoint fetches points of interest from the OpenStreetMap Overpass API, filters them by the requested category, and returns a ranked list with shadow scores attached. The `/api/sada/route` endpoint calls the Google Directions API to compute a walking route between two coordinates and returns the geometry as a coordinate array. The `/api/sada` endpoint is the main entry point: it orchestrates the POI fetch, scores candidates against the current shadow map, picks the best match, fetches the route, and asks Gemini for narration, all in one request.

**POST /api/sada**

Request:

```json
{
  "light": "sun" | "shade",
  "seat": "cafe" | "bench" | "viewpoint" | "fountain" | "square",
  "userLocation": { "lat": number, "lng": number },
  "exclude": string[]
}
```

Response:

```json
{
  "destination": { "id": string, "name": string, "lat": number, "lng": number, "category": string },
  "route": { "coordinates": [number, number][], "distanceMeters": number, "durationMinutes": number },
  "walkingDuration": string
}
```

<img width="499" height="221" alt="image" src="https://github.com/user-attachments/assets/b97f2fda-897e-4c4e-8c8c-fac459ce7b02" />


## Stack

- Next.js 14, App Router, TypeScript
- Mapbox GL JS via react-map-gl
- SunCalc and Turf.js for shadow geometry
- ZG3D 2022 LiDAR dataset from data.zagreb.hr
- OpenStreetMap Overpass API
- Google Directions API
- Google Gemini 2.0 Flash

## Running locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Three environment variables are required:

- `NEXT_PUBLIC_MAPBOX_TOKEN` — create a public token at mapbox.com
- `GOOGLE_MAPS_API_KEY` — Google Cloud console, Directions API must be enabled
- `GEMINI_API_KEY` — available at aistudio.google.com

## Data

The ZG3D dataset is a 2022 LiDAR survey of Zagreb published on the City of Zagreb open data portal at data.zagreb.hr. Each building record includes a `Z_Delta` value representing roof height above ground, which is used to project shadow polygons at a given sun angle. The dataset covers inner Zagreb and has been clipped to a bounding box around the city center for performance.

## Built at

Zagreb Hackathon, March 2026.
