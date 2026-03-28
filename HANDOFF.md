# Sada — Full Project Handoff for Claude Code

## What is Sada?

Sada (Croatian for "now") is a hackathon app built in Zagreb. The core idea: **every other map tells you where things are — Sada tells you where to *be*.** 

The user opens the app, picks two preferences (sun or shade, and a seat type), taps one button, and gets a single opinionated recommendation for where to go sit *right now*. The app is supposed to feel like a confident local friend who understands sun physics and knows the city, not like a generic AI assistant showing you a list of 10 options.

---

## Tech Stack & Architecture

### Framework
- **Next.js 16.2.1** with App Router (NOT Pages Router)
- **React 19.2.4**
- **TypeScript 5.x** with strict mode
- **Tailwind CSS v4** — configured via `@tailwindcss/postcss` in `postcss.config.mjs` (there is NO `tailwind.config.js/ts` — Tailwind v4 uses CSS-first configuration)

### External APIs (server-side, in the API routes)
- **OpenStreetMap Overpass API** — free, no auth, queries real POI data (cafes, benches, drinking fountains, viewpoints, parks, squares) by amenity/tourism/place/leisure tags within a radius
- **Google Directions API** — full walking route between two coordinates (duration, distance, encoded polyline), requires `GOOGLE_MAPS_API_KEY`
- **Google Gemini 2.0 Flash** — narration generation via `@google/genai` SDK, requires `GEMINI_API_KEY`. Note: narration is being moved to a **separate endpoint** (not in `/api/sada` currently).

### Client-side
- **Mapbox GL JS** via `react-map-gl` (v8.1.0) — 3D map with building extrusions, shadow polygons, time slider, requires `NEXT_PUBLIC_MAPBOX_TOKEN`
- **Lucide React** — icon set (Sun, TreePine, Coffee, Armchair, Clock)
- **Geist font family** — loaded via `next/font/google`

### Server-side utilities
- **`lib/shadow.ts`** — Pure utility module (no React/Next.js) wrapping `suncalc` (v1.9.0). Exports `getSunState`, `getMinutesUntilStateChange`, and `getShadowMetadata`. Uses the same altitude thresholds as `MapComponent` (<=0 night, <=6 golden hour = "shade"; >6 = "sun") so client and server agree. **Actively imported by `/api/sada`** for POI shadow filtering and metadata computation.
- **`@mapbox/polyline` (v1.2.1)** — Decodes Google Directions encoded polylines into coordinate arrays server-side. Used by `/api/sada` to return decoded route coordinates in GeoJSON `[lng, lat]` order.

### Installed but NOT yet used in the main route
- **`@turf/turf` (v7.3.4)** — geospatial operations (buffer, intersect, boolean operations on polygons). Used by `MapComponent` for shadow polygon computation and route buffering.
- **`@google/genai` (v1.46.0)** — Google Gemini SDK. Was previously used in `/api/sada` for narration; narration is being moved to a separate endpoint.

### Environment Variables
```
NEXT_PUBLIC_MAPBOX_TOKEN=   # Mapbox GL access token (exposed to client)
GOOGLE_MAPS_API_KEY=        # Google Directions API (server-only)
GEMINI_API_KEY=             # Google Gemini API (server-only, used by narration endpoint)
```
Stored in `.env.local` (gitignored). Template in `.env.example`.

---

## File-by-File Breakdown

### `app/page.tsx` — Landing Page
A minimal landing page. Big bold "Sada." title in 8xl/9xl, a one-liner tagline, and a single CTA button ("Take me somewhere good") that links to `/map`. Dark background (`bg-neutral-950`), white text. No state, no logic, purely presentational.

### `app/map/page.tsx` — Map Page (State Owner)
This is the main app page. It is marked `"use client"` and owns the top-level state:
- `destination: { lat: number; lng: number } | null` — the recommended spot's coordinates
- Passes `destination` down to `<MapComponent destination={destination} />`
- Passes a callback to `<SadaUI onResult={(res) => setDestination(res.destination)} />`

The SadaUI is positioned as an absolutely-positioned bottom sheet over the full-screen map via `absolute bottom-0 inset-x-0 z-10`.

### `app/layout.tsx` — Root Layout
Standard Next.js App Router root layout. Loads Geist Sans and Geist Mono fonts via `next/font/google`, sets them as CSS variables. Metadata title: "Sada — Where to be, right now".

### `app/globals.css` — Global Styles
- Imports `mapbox-gl/dist/mapbox-gl.css` (required for Mapbox GL to render correctly)
- Imports `tailwindcss` (Tailwind v4 style)
- Defines CSS custom properties for background/foreground colors
- Configures Tailwind theme inline (`@theme inline`) with font variables
- Defines a custom `slideUp` keyframe animation used by the result card

### `lib/shadow.ts` — Sun/Shade Utility
Pure server-side module with three named exports:

- `getSunState(lat, lng, date?)` — Computes sun altitude in degrees via SunCalc. Returns `"shade"` if altitude <= 6 (golden hour or below horizon), `"sun"` otherwise. Thresholds match `MapComponent`'s visual bands exactly. **Used by `/api/sada` to filter POIs by sun/shade preference.**
- `getMinutesUntilStateChange(lat, lng, currentState, date?)` — Walks forward in 5-minute steps (max 48 steps = 4 hours). Returns minutes until sun/shade state flips, or 240 if stable.
- `getShadowMetadata(lat, lng)` — Returns `{ currentState, minutesUntilChange, stableFor, sunAltitudeDeg }`. `stableFor` is `"3+ hours"` when >= 240 min, otherwise `"N min"`. **Used by `/api/sada` to compute metadata for the chosen spot** (will be consumed by the narration endpoint).

No React, no Next.js imports, no default export, no side effects.

### `components/SadaUI.tsx` — The Control Panel
This is the most complex component. Here's everything it does:

**Types:**
- `LightPref = "sun" | "shade"`
- `SeatPref = "cafe" | "bench"` (UI only exposes these two; the API route supports all six: cafe, bench, fountain, viewpoint, park, square)
- `SadaResult = { destination: { lat, lng }, walkingDuration: string, narration: string }` — **Note: `narration` is still in the type but the API no longer returns it. Needs updating when the narration endpoint is wired up.**

**Props:**
- `onResult?: (data: SadaResult) => void` — callback fired after successful fetch, used by parent to update map destination

**State:**
- `light` / `seat` — user's two preferences
- `loading` — fetch in progress
- `result` — the API response (or null)
- `excluded` — array of `"lat,lng"` strings of previously seen spots
- `loadingIndex` — index into the cycling loading messages array

**Key behaviors:**
1. When `loading` becomes true, a `setInterval` cycles through 4 loading messages every 900ms, capped at the last one. Cleaned up via ref.
2. `handleSada()` POSTs to `/api/sada` with `{ light, seat, exclude: excluded }`. On success: sets result, calls `onResult`, appends coordinates to excluded list.
3. Excluded list resets when light or seat changes (via useEffect).
4. "Try another" button re-calls `handleSada()` with same preferences but updated exclusion list.
5. Result card is a dark glassmorphism bottom sheet with walking duration badge. No external maps link — routing is handled in-app on the Mapbox map.

**Known issue:** The result card still renders `{result.narration}` which is now `undefined` since the API no longer returns narration. This will show an empty paragraph. Needs fixing when the narration endpoint is wired up.

**Sub-component:**
- `ToggleButton` — inline pill toggle used for the sun/shade and cafe/bench selectors.

### `components/MapComponent.tsx` — The Map
Renders a Mapbox GL map centered on Zagreb with:
- GPS-based user location (falls back to Trg bana Jelačića after 8s timeout)
- Intro fly-to animation from bird's-eye to street level
- 3D building extrusions from `/data/zg3d_center.geojson` (if available)
- Dynamic shadow polygon computation using SunCalc azimuth/altitude and Turf.js
- Sun-based directional lighting on buildings that changes with time of day
- Night/golden hour overlays
- Time slider (+-12 hours) for simulating shadow positions
- Walking route rendered as a 3D extruded ribbon (currently uses hardcoded `DEMO_ROUTE`)
- Destination pin marker (red dot) and user location marker (pulsing blue dot)
- Fly-to animation when `destination` prop changes

**Known issue:** Route rendering still uses a hardcoded `DEMO_ROUTE` array instead of the API's decoded `route.coordinates`. Needs to be wired up to consume the actual route from the API response.

### `app/api/sada/pois/route.ts` — POI Discovery Endpoint
GET endpoint that the map calls on load to populate markers with nearby points of interest. No auth required.

**Query parameters:**
- `lat` (number, default 45.8130) — user latitude
- `lng` (number, default 15.9779) — user longitude
- `radius` (number, default 500, clamped 100–5000) — search radius in meters
- `categories` (string, optional) — comma-separated list from: `cafe`, `bench`, `fountain`, `viewpoint`, `park`, `square`. If omitted, returns all six.

**Pipeline:**
1. Validates lat/lng (rejects NaN), clamps radius, filters categories against known set
2. Builds a dynamic Overpass union query — each category maps to an OSM tag fragment (e.g., `fountain` → `node["amenity"="drinking_water"]`)
3. POSTs to Overpass API with 15s timeout
4. Derives friendly category from raw OSM tags via `deriveCategory()`, filters out elements without coordinates
5. Normalizes to `{ id: "osm-{id}", name, lat, lng, category, tags }`, using default names when OSM lacks a `name` tag
6. Caps at 100 results, returns `{ locations, count, fetchedAt }`

**Error handling:** try/catch always returns HTTP 200 with `{ locations: [], count: 0, error: "..." }`. Logs to server console on both success and failure.

**Shadow data is NOT included** — the client computes shadow state client-side against existing shadow polygons.

### `app/api/sada/route.ts` — The Backend Brain
Single POST endpoint. Pipeline:

**Request body:** `{ light: "sun"|"shade", seat: string, userLocation?: { lat, lng }, exclude?: string[] }`

If `userLocation` is missing, defaults to `{ lat: 45.8130, lng: 15.9779 }` (Trg bana Jelačića).

1. **Overpass query** — uses `CATEGORY_QUERIES` lookup to map each seat type to its OSM query fragment, all with 800m radius from `userLocation`:
   - `cafe` → `node["amenity"="cafe"]`
   - `bench` → `node["amenity"="bench"]`
   - `fountain` → `node["amenity"="drinking_water"]`
   - `viewpoint` → `node["tourism"="viewpoint"]`
   - `park` → `node["leisure"="park"]`
   - `square` → `node["place"="square"]`
   
   Unknown seat values fall back to cafe. All queries use `out center body;`.
2. **Filter exclusions** — removes previously seen coordinates (handles both `el.lat/el.lon` for nodes and `el.center.lat/el.center.lon` for ways). Falls back to full list if all filtered out.
3. **Shadow preference filter** — calls `getSunState(el.lat, el.lon)` on each remaining POI. Keeps only those matching the user's `light` preference ("sun" or "shade"). Falls back to unfiltered list if none match the preference.
4. **Pick random** — selects a random element from the filtered pool.
5. **Google Directions** — fetches the full walking route. Extracts: duration text (e.g. "4 mins"), duration in seconds, distance in meters, and encoded overview polyline.
6. **Polyline decode** — decodes the polyline server-side via `@mapbox/polyline` into `[lng, lat]` coordinate pairs (GeoJSON order).
7. **Shadow metadata** — calls `getShadowMetadata(chosen.lat, chosen.lon)` to compute `currentState`, `stableFor`, `sunAltitudeDeg`. Currently stored but not returned (will be consumed by the narration endpoint).
8. **Return JSON:**
   ```json
   {
     "destination": { "id": "osm-123", "name": "Cafe Name", "lat": 45.81, "lng": 15.97, "category": "cafe" },
     "route": { "coordinates": [[15.97, 45.81], ...], "distanceMeters": 350, "durationMinutes": 4 },
     "walkingDuration": "4 mins"
   }
   ```

**Narration is NOT included** — AI narration is being moved to a separate endpoint.

**Error handling:** Full try/catch. On any failure, returns HTTP 200 with a hardcoded fallback that varies based on `light`:
- shade → Zrinjevac (45.8117, 15.9772)
- sun → Cogito Coffee (45.8134, 15.9772)

This ensures the demo never crashes.

---

## What Has Been Built (Complete)

- [x] Landing page with branding and CTA
- [x] Map page with full-screen Mapbox GL map
- [x] State lifting pattern (page → map + UI)
- [x] Sun/Shade and Cafe/Bench toggle selectors with mad-libs sentence pattern
- [x] API route with Overpass → Shadow filter → Directions → Polyline decode pipeline
- [x] Shadow-aware POI filtering using `getSunState`
- [x] Server-side polyline decoding via `@mapbox/polyline`
- [x] Structured destination response with id, name, category
- [x] Decoded route coordinates in GeoJSON order
- [x] Shadow metadata computation for chosen spot
- [x] Exclusion system to prevent duplicate recommendations
- [x] Cycling loading messages with physics-themed copy
- [x] Result bottom sheet with walking duration and try another
- [x] Error fallback in API route
- [x] slideUp animation for result card
- [x] In-app route rendering on the Mapbox map
- [x] POI discovery GET endpoint (`/api/sada/pois`) for map marker population with category filtering and radius control
- [x] GPS-based user location with fallback
- [x] 3D shadow polygon computation using SunCalc + Turf.js
- [x] Time slider for simulating sun position
- [x] Destination pin and user location markers

---

## What Is Missing / Not Yet Implemented

### Critical for Demo

1. **Narration endpoint** — AI narration (Gemini 2.0 Flash) has been removed from `/api/sada` and needs its own endpoint. The prompt, shadow metadata, and time-of-day context are ready to use. `SadaUI.tsx` still expects `narration` in the response — it renders `{result.narration}` which is currently `undefined`.

2. **Wire API route coordinates to map** — `MapComponent` still uses a hardcoded `DEMO_ROUTE` array for the walking route ribbon. It should consume `route.coordinates` from the API response instead. This requires passing the route data through `app/map/page.tsx` state.

3. **Wire `userLocation` to API** — `SadaUI.tsx` currently POSTs `{ light, seat, exclude }` without `userLocation`. The API defaults to Trg bana Jelačića, but `MapComponent` already has the user's GPS location. The user's actual location should be passed through to the API.

### Important for Product Quality

4. **Error UI in SadaUI** — The catch block in `handleSada` has a `// TODO: surface error to user` comment. If the fetch itself fails (network error), the user sees nothing. Add an error state with a retry button.

5. **Shadow polygon computation** — `MapComponent` computes shadow polygons using SunCalc and Turf.js, but requires building data from `/data/zg3d_center.geojson`. If this file is missing (404), no shadows are rendered.

6. **ZG3D building data** — The map has a 3D building extrusion layer that references `/data/zg3d_center.geojson`. If this file doesn't exist, the shadow computation has nothing to project.

### Nice to Have

7. **PWA support** — Add a web app manifest, service worker, and meta tags so the app can be installed on mobile home screens.

8. **Share result** — Let users share their recommendation via Web Share API or a copy-to-clipboard link.

9. **Favorites / history** — Save previously visited spots so the user can build a personal Zagreb map over time.

10. **Dark mode map** — The map uses Mapbox Standard style. For evening recommendations, switching to a dark map style would be more atmospheric.

11. **Multiple cities** — The app is Zagreb-specific. Making it work for other cities would require parameterizing the origin and adjusting any narration prompts.

---

## Project-Specific Conventions

### Next.js Version
This uses **Next.js 16.2.1** which may have breaking changes from what you know. The `AGENTS.md` rule says to check `node_modules/next/dist/docs/` for documentation before writing code. Heed deprecation notices.

### Tailwind CSS v4
There is **no `tailwind.config.js`**. Tailwind v4 is configured via CSS (`@import "tailwindcss"` in `globals.css`) and PostCSS (`@tailwindcss/postcss` in `postcss.config.mjs`). Theme customization is done via `@theme inline` in CSS, not a JS config file.

### File Organization
- `app/` — Next.js App Router pages and API routes
- `components/` — shared React components
- `public/` — static assets (currently just default Next.js SVGs)
- `lib/` — server-side utility modules (currently: `shadow.ts`)
- No `utils/`, `hooks/`, or `types/` directories exist yet

### TypeScript
Strict mode is on. Path alias `@/*` maps to the project root.

### Code Style
- `"use client"` directive on all client components
- Functional components with hooks
- Inline Tailwind classes (no CSS modules)
- Lucide React for icons

---

## How to Run

```bash
npm install
cp .env.example .env.local   # Fill in: NEXT_PUBLIC_MAPBOX_TOKEN, GOOGLE_MAPS_API_KEY, GEMINI_API_KEY
npm run dev                   # http://localhost:3000
```

### API Keys Needed
1. **Mapbox** — Create a free account at mapbox.com, get a public access token
2. **Google Cloud** — Enable Directions API, create an API key
3. **Google AI Studio** — Get a Gemini API key from aistudio.google.com (needed for narration endpoint)

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│                  app/map/page.tsx                    │
│    [destination state] <── onResult callback        │
│         │                        ^                  │
│         v                        │                  │
│  ┌──────────────┐    ┌───────────────────┐         │
│  │ MapComponent  │    │     SadaUI         │         │
│  │ (Mapbox GL)   │    │ (toggles + button) │         │
│  │              │    │                   │         │
│  │ • 3D bldgs   │    │ handleSada() ─────┼──┐      │
│  │ • shadows    │    │ • loading msgs    │  │      │
│  │ • route      │    │ • result card     │  │      │
│  │ • fly-to     │    │ • exclusion list  │  │      │
│  │ • time slider│    │                   │  │      │
│  └──────┬───────┘    └───────────────────┘  │      │
│         │ on load                            │      │
└─────────│────────────────────────────────────│──────┘
          │                                    │
          │  GET /api/sada/pois        POST /api/sada
          │  ?lat=..&lng=..&radius=..  { light, seat, userLocation?, exclude? }
          v                                    v
┌──────────────────────────┐  ┌──────────────────────────────┐
│ app/api/sada/pois/route  │  │      app/api/sada/route.ts    │
│                          │  │                              │
│ 1. Validate params       │  │  1. Overpass API (800m)       │
│ 2. Dynamic Overpass query│  │  2. Filter exclusions         │
│ 3. Normalize + cap 100   │  │  3. Shadow preference filter  │
│ 4. Return { locations }  │  │  4. Google Directions (walk)  │
│                          │  │  5. Polyline decode            │
│ No shadow data returned  │  │  6. Shadow metadata            │
│ (client computes)        │  │  7. Return JSON               │
└──────────────────────────┘  │                              │
                              │  Fallback on any error        │
                              └──────────────────────────────┘
```

---

## Data Flow

### Map load — POI population
1. `MapComponent` mounts, requests GPS (falls back to Zagreb center after 8s)
2. Map loads, plays intro fly-to animation from bird's-eye to street level
3. Client sends `GET /api/sada/pois?lat=...&lng=...&radius=500` with user's coordinates
4. Server builds dynamic Overpass union query for all six categories, fetches from OSM
5. Server normalizes elements and returns up to 100 `{ id, name, lat, lng, category, tags }` objects
6. Client renders POI markers on the map

### Recommendation flow
1. User toggles sun/shade and cafe/bench in SadaUI
2. User taps "SADA." button
3. Loading messages cycle: "Reading the shadows..." → "Calculating sun angle..." → "Scanning Zagreb..." → "Finding your spot..."
4. `POST /api/sada` fires with `{ light: "sun", seat: "cafe", exclude: [] }`
5. API queries Overpass for the matching POI type within 800m of user location
6. API filters out any previously returned coordinates
7. API filters remaining POIs by sun/shade preference using `getSunState`
8. API picks a random POI from the filtered pool
9. API fetches full walking route from Google Directions
10. API decodes the overview polyline into `[lng, lat]` coordinates
11. API computes shadow metadata for the chosen spot
12. API returns `{ destination, route, walkingDuration }`
13. SadaUI sets result state, calls `onResult`, appends to exclusion list
14. Parent page receives destination, passes to MapComponent
15. Map flies to destination and renders route + pin
16. User can "Try another" (re-triggers with updated exclusion list)

---

## Key Decisions Made

1. **Single recommendation, not a list** — The whole product identity. No "Top 10" results. One answer. Right now.
2. **User location with fallback** — Uses browser geolocation, falls back to Trg bana Jelačića after 8s timeout. API also defaults to Zagreb center if `userLocation` is not provided.
3. **OSM over Google Places** — Free, no rate limits, no billing. Overpass has every bench, cafe, drinking fountain, viewpoint, park, and square in Zagreb.
4. **Exclusion via client state** — Simpler than server-side session tracking. Resets on preference change, which is the right UX.
5. **Shadow filtering server-side** — Uses `getSunState` from `lib/shadow.ts` to filter POIs by sun/shade state at the current time. Falls back gracefully if no POIs match the preference.
6. **Server-side polyline decode** — Decoded on the server via `@mapbox/polyline` so the client receives ready-to-render `[lng, lat]` coordinate arrays without needing the decode library.
7. **Narration as separate endpoint** — Decoupled from the main route to allow independent iteration on the AI prompt, model, and response time without blocking the core destination+route flow.
8. **Fallback on any error** — The demo must never crash. Hardcoded fallbacks (Zrinjevac for shade, Cogito Coffee for sun) cover any API failure gracefully.
