import { readFileSync, statSync } from "node:fs";
import { expect, it } from "vitest";
import { BOX_M } from "../lib/geo/frame.ts";
import { SEAT_OFFSET_M } from "../lib/geo/seat.ts";
import { EDGE_HEIGHT_M } from "../lib/geo/shade.ts";
import { MIN_STAY_MINUTES } from "../lib/pick.ts";
import { placesFrom } from "../lib/places.ts";
import { readCity, readManifest } from "./support.ts";

// Every figure the README states, taken from the data and the code it describes.
it("the README's numbers are the ones in the data", () => {
  const readme = readFileSync("README.md", "utf8").replace(/\s+/g, " ");
  const manifest = readManifest();
  const snapshot = JSON.parse(readFileSync("data/osm/places.json", "utf8"));
  const { places, withoutSeat } = placesFrom(snapshot.places, readCity());
  const cafes = places.filter((p) => p.category === "cafe");
  const count = (n: number) => n.toLocaleString("en-US");
  const km = (m: number) => (m / 1000).toFixed(1);
  const [older, newer] = Object.entries(manifest.source.surveys).sort();

  const stated = [
    `about ${km(BOX_M.east - BOX_M.west)} by ${km(BOX_M.north - BOX_M.south)} km`,
    `with ${count(manifest.bundle.buildings)} buildings, ${snapshot.counts.cafe} cafés and ${snapshot.counts.bench} benches`,
    `for at least ${MIN_STAY_MINUTES} minutes`,
    `a point ${SEAT_OFFSET_M} m outside the nearest wall`,
    `Of the ${snapshot.counts.cafe} cafés, ${cafes.filter((p) => p.moved).length} are moved this way and ${withoutSeat} are left out`,
    `for ${manifest.ground.replacedAbove + manifest.ground.replacedBelow} of the ${count(manifest.bundle.buildings)} buildings`,
    `${manifest.heightAboveGroundM.notAboveGround} buildings end up no higher`,
    `${count(older[1])} buildings (${Math.round((100 * older[1]) / manifest.bundle.buildings)}%) come from a ${older[0].slice(0, 4)} aerial survey`,
    `${manifest.source.blockOutlines.length} records in the source outline whole blocks`,
    `${count(newer[1])} from a ${newer[0].slice(0, 4)} survey`,
    `before a ${EDGE_HEIGHT_M} m building`,
    `OpenStreetMap snapshot from ${snapshot.osmBase.slice(0, 10)}`,
    `bundle is ${Math.round(manifest.bundle.bytes / 1000)} kB, and ${Math.round(statSync(manifest.bundle.file).size / 1000)} kB as it is sent`,
  ];
  expect(stated.filter((text) => !readme.includes(text))).toEqual([]);
  // The cafés left out are all the places left out, or the sentence above would be wrong.
  expect(places.filter((p) => p.category === "bench")).toHaveLength(snapshot.counts.bench);
});
