## feat: implement Sada core loop — API, UI, and map integration

### Summary

This PR implements the complete MVP flow for **Sada**, a hackathon app that tells you the single best spot to sit in Zagreb *right now* based on sun/shade preference and seat type. The user picks two things (sun or shade, cafe or bench), hits one button, and gets a confident, opinionated recommendation powered by real POI data, sun-aware filtering, and decoded walking routes.

**Every other map tells you where things are. Sada tells you where to *be*.**

---

### What changed

#### `app/api/sada/route.ts` — The Brains

The entire backend logic lives in one API route with a 6-step pipeline:

1. **OSM Overpass API** — Queries OpenStreetMap for real POIs within 800m of the user's location (defaults to Trg bana Jelačića if not provided). Supports six seat types: cafe (`amenity=cafe`), bench (`amenity=bench`), fountain (`amenity=drinking_water`), viewpoint (`tourism=viewpoint`), park (`leisure=park`), and square (`place=square`). Uses the same category-to-query lookup as `/api/sada/pois`.
2. **Exclusion filtering** — Filters out previously-seen spots so the "Try another" button never returns the same place twice in a row. Falls back to the full pool if all spots have been exhausted.
3. **Shadow preference filtering** — Uses `getSunState()` from `lib/shadow.ts` to check each POI's sun/shade state at the current time. Keeps only POIs matching the user's `light` preference. Falls back to unfiltered list if none match.
4. **Google Directions API** — Fetches the full walking route from the user's location to the selected destination. Extracts walking duration text, duration in seconds, distance in meters, and the encoded overview polyline.
5. **Polyline decoding** — Decodes the Google Directions polyline server-side via `@mapbox/polyline` into `[lng, lat]` coordinate pairs (GeoJSON order) for direct map rendering.
6. **Shadow metadata** — Calls `getShadowMetadata()` to compute `currentState`, `stableFor`, and sun altitude for the chosen spot. Currently stored for the upcoming narration endpoint.

**Request body:** `{ light: "sun"|"shade", seat: string, userLocation?: { lat, lng }, exclude?: string[] }`

**Response shape:**
```json
{
  "destination": { "id": "osm-123", "name": "Cafe Name", "lat": 45.81, "lng": 15.97, "category": "cafe" },
  "route": { "coordinates": [[15.97, 45.81], ...], "distanceMeters": 350, "durationMinutes": 4 },
  "walkingDuration": "4 mins"
}
```

Narration is **not** included — AI narration is handled by a separate endpoint.

Includes full `try/catch` with a hardcoded fallback (Zrinjevac for shade, Cogito Coffee for sun) so the live demo never crashes, even if Overpass times out or Google Directions is unavailable.

#### `app/api/sada/pois/route.ts` — POI Discovery Endpoint

GET endpoint that the map calls on load to populate markers with nearby points of interest. Accepts query parameters for location (`lat`, `lng`), search radius (`radius`, default 500m), and category filtering (`categories`, comma-separated). Shadow data is not included in the response — the client computes shadow state against existing shadow polygons.

Pipeline:
1. **Validate and parse** — Parses `lat`, `lng`, `radius`, `categories` from the URL query string. Validates lat/lng for NaN, clamps radius to 100–5000m range, filters categories against a known set (cafe, bench, fountain, viewpoint, park, square).
2. **Dynamic Overpass query** — Builds a union query from only the active categories, each mapped to its OSM tag fragment. POSTs to the Overpass API with a 15-second timeout.
3. **Normalize** — Derives a friendly category name from raw OSM tags (`amenity=drinking_water` → `fountain`), filters out elements missing coordinates, and maps each to `{ id, name, lat, lng, category, tags }`.
4. **Cap and return** — Slices to 100 results max. Returns `{ locations, count, fetchedAt }`.

Error handling: try/catch always returns status 200 with `{ locations: [], count: 0, error: "..." }` on failure. Logs success count and errors to server console.

#### `app/map/page.tsx` — State Lifting

- Added `destination` state (`{ lat, lng } | null`) at the page level.
- Passes `destination` down to `<MapComponent>` as a prop.
- Passes an `onResult` callback to `<SadaUI>` that extracts `res.destination` and sets it into state.
- This is the glue that connects the UI panel to the map.

#### `components/SadaUI.tsx` — Control Panel + Result Card

**Inputs:**
- Two toggle pairs rendered as inline pill buttons in a natural-language sentence: *"I want to sit in the [Sun/Shade] at a [Café/Bench] near me."*
- One-tap `SADA.` button to trigger the recommendation.
- The API route supports six seat types (cafe, bench, fountain, viewpoint, park, square) — the UI currently exposes cafe and bench; the remaining four are wired and ready for UI integration.

**Loading state:**
- Cycling contextual messages: *"Reading the shadows..."* → *"Calculating sun angle..."* → *"Scanning Zagreb..."* → *"Finding your spot..."*
- Messages advance every 900ms via `setInterval`, capped at the last message. Cleanup on unmount via ref.

**Result card (bottom sheet):**
- Walking time badge (e.g. "6 min walk") with clock icon.
- "Try another" ghost button that re-triggers the same fetch with current preferences.
- Dark semi-transparent card (`bg-black/80 backdrop-blur`) with slide-up animation.
- No external "Open in Maps" link — routing is rendered in-app on the Mapbox map.

**Exclusion system:**
- Tracks previously returned coordinates in `excluded` state.
- Sends the exclusion list to the API on each request.
- Resets exclusions when the user changes light or seat preference via `useEffect`.

#### `lib/shadow.ts` — Sun/Shade Utility

Pure server-side utility module (no React, no Next.js dependencies) that wraps SunCalc to determine sun/shade state for any coordinate at any time. Three named exports:

- **`getSunState(lat, lng, date?)`** — Returns `"sun"` or `"shade"`. Converts SunCalc's altitude from radians to degrees and applies the same thresholds used in `MapComponent`: altitude <= 0 (night/twilight) and <= 6 (golden hour) both return `"shade"`; above 6 returns `"sun"`. This means client and server agree on what counts as "shade." Used by `/api/sada` to filter POIs by sun/shade preference.
- **`getMinutesUntilStateChange(lat, lng, currentState, date?)`** — Steps forward in 5-minute increments (up to 4 hours / 48 steps) to find when the sun/shade state flips. Returns the number of minutes until the change, or 240 if stable for 4+ hours.
- **`getShadowMetadata(lat, lng)`** — Convenience wrapper that returns `{ currentState, minutesUntilChange, stableFor, sunAltitudeDeg }`. `stableFor` is a human-readable string (`"145 min"` or `"3+ hours"`). Used by `/api/sada` to compute metadata for the chosen spot (consumed by the narration endpoint).

#### `components/MapComponent.tsx` — Mapbox Map

- Accepts `destination` prop and flies to it when set.
- 3D building extrusion layer with real ZG3D data.
- Shadow polygon computation using SunCalc and Turf.js.
- Time slider for simulating sun position at different hours.
- Walking route rendered as a 3D ribbon on the map.
- User location marker (pulsing blue dot) and destination pin.

#### `app/page.tsx` — Landing Page

- Clean, bold landing with `Sada.` in 8xl/9xl type.
- Tagline: *"Every other map tells you where things are. Sada tells you where to be."*
- Single CTA button: *"Take me somewhere good"* → `/map`.

#### `app/globals.css`

- Custom `slideUp` keyframe animation for the result card entrance.
- Mapbox GL CSS import.
- Tailwind v4 import.

---

### Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router) | 16.2.1 |
| React | React | 19.2.4 |
| Language | TypeScript | 5.x |
| Styling | Tailwind CSS | 4.x |
| Map | Mapbox GL JS via react-map-gl | 3.20.0 / 8.1.0 |
| Polyline | @mapbox/polyline | 1.2.1 |
| Icons | Lucide React | 1.7.0 |
| POI Data | OpenStreetMap Overpass API | -- |
| Directions | Google Directions API | -- |
| Sun position | SunCalc | 1.9.0 |
| Geospatial | @turf/turf | 7.3.4 |
| Fonts | Geist Sans + Geist Mono | via next/font |

**Available but not used in this route:** `@google/genai` (Gemini narration is handled by a separate endpoint).

---

### Environment Variables Required

```
NEXT_PUBLIC_MAPBOX_TOKEN=   # Mapbox GL access token (client-side)
GOOGLE_MAPS_API_KEY=        # Google Directions API key (server-side)
GEMINI_API_KEY=             # Google Gemini API key (server-side, used by narration endpoint)
```

---

### Known Limitations (MVP Scope)

- **Narration not wired in UI:** `SadaUI.tsx` still references `narration` in its result type and renders it, but the main API route no longer returns it. The narration endpoint is being built separately.
- **MapComponent uses demo route:** The map renders a hardcoded `DEMO_ROUTE` instead of the API's decoded `route.coordinates`. Needs to be wired up.
- **No error UI:** Fetch failures are caught but not surfaced to the user in the UI.

---

### How to Test

```bash
npm install
cp .env.example .env.local   # Fill in API keys
npm run dev
```

1. Open `http://localhost:3000` -- see the landing page.
2. Click "Take me somewhere good" -> `/map`.
3. Toggle Sun/Shade and Cafe/Bench.
4. Hit `SADA.` -- watch loading messages cycle, then see the result card slide up.
5. Click "Try another" -- get a different spot (exclusion system prevents repeats).
6. The walking route renders directly on the Mapbox map (no external Google Maps link).
7. To test the route API directly:
   - Minimal: `curl -X POST http://localhost:3000/api/sada -H "Content-Type: application/json" -d '{"light":"sun","seat":"cafe"}'`
   - With location: `curl -X POST http://localhost:3000/api/sada -H "Content-Type: application/json" -d '{"light":"shade","seat":"bench","userLocation":{"lat":45.815,"lng":15.978}}'`
   - All seat types: try `fountain`, `viewpoint`, `park`, `square`
8. Test the POIs endpoint:
   - All defaults: `curl http://localhost:3000/api/sada/pois`
   - Specific location & radius: `curl "http://localhost:3000/api/sada/pois?lat=45.815&lng=15.978&radius=300"`
   - Filter categories: `curl "http://localhost:3000/api/sada/pois?categories=cafe,bench"`
   - Invalid lat/lng returns error: `curl "http://localhost:3000/api/sada/pois?lat=abc&lng=xyz"`
   - Unknown categories returns error: `curl "http://localhost:3000/api/sada/pois?categories=bogus"`
