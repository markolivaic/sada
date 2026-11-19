// Refreshes data/osm/places.json: cafes and benches inside the mapped box, from OpenStreetMap
// through the Overpass API. Run with: npm run fetch:places
//
// The app reads the committed snapshot and never calls Overpass itself.

import { writeFileSync } from "node:fs";
import { BOX } from "../lib/geo/frame.ts";

const OUT = "data/osm/places.json";
const ENDPOINT = "https://overpass-api.de/api/interpreter";
const ATTEMPTS = 6;

const bbox = `${BOX.south},${BOX.west},${BOX.north},${BOX.east}`;
const query = `[out:json][timeout:60];(nwr["amenity"="cafe"](${bbox});node["amenity"="bench"](${bbox}););out center tags;`;

interface Element {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

async function ask(): Promise<{ elements: Element[]; osm3s: { timestamp_osm_base: string } }> {
  for (let attempt = 1; ; attempt++) {
    // Overpass answers GET without a User-Agent with 406, and 429 or 502 when it is busy.
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "sada/0.1 (places snapshot)" },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (response.ok) return response.json();
    if (attempt === ATTEMPTS) throw new Error(`Overpass answered ${response.status} ${attempt} times`);
    const wait = 10 * attempt;
    console.log(`Overpass answered ${response.status}, trying again in ${wait} s`);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  }
}

const answer = await ask();
const places = answer.elements
  .map((element) => ({
    id: `${element.type}/${element.id}`,
    category: element.tags?.amenity === "cafe" ? "cafe" : "bench",
    name: element.tags?.name ?? null,
    lat: element.lat ?? element.center?.lat,
    lng: element.lon ?? element.center?.lon,
    outdoorSeating: element.tags?.outdoor_seating ?? null,
  }))
  .filter((place) => place.lat !== undefined && place.lng !== undefined)
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const snapshot = {
  source: "OpenStreetMap",
  attribution: "© OpenStreetMap contributors",
  licence: "Open Database License 1.0, https://opendatacommons.org/licenses/odbl/1-0/",
  endpoint: ENDPOINT,
  query,
  fetchedOn: new Date().toISOString().slice(0, 10),
  osmBase: answer.osm3s.timestamp_osm_base,
  counts: {
    cafe: places.filter((p) => p.category === "cafe").length,
    bench: places.filter((p) => p.category === "bench").length,
  },
  places,
};

writeFileSync(OUT, JSON.stringify(snapshot, null, 1) + "\n");
console.log(`${snapshot.counts.cafe} cafes and ${snapshot.counts.bench} benches, OSM data as of ${snapshot.osmBase}`);
