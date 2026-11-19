import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeBundle, encodeBundle, XY_STEP_M } from "../lib/geo/bundle.ts";
import { cityFromBuildings } from "../lib/geo/city.ts";
import { footprintFeatures } from "../lib/geo/footprints.ts";
import { BOX, BOX_M, toLocal } from "../lib/geo/frame.ts";
import { groundAt, lightAt } from "../lib/geo/shade.ts";
import { BIN_GZ, MANIFEST, SOURCE, buildBundle, sha256 } from "../scripts/buildings.ts";
import { inSweptShadow, readBundle, readCity, readManifest, rectangle, seeded, sunDeg } from "./support.ts";

const toArrayBuffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

describe("the building bundle format", () => {
  const input = [
    { rings: [rectangle(-12.34, 5.01, 20.02, 31.99), rectangle(0, 10, 5, 15)], top: 131.27, ground: 118.4 },
    { rings: [[[100, 100], [130, 100], [115, 140]]], top: 160, ground: 150 },
  ];

  it("gives back what went in, to the 5 cm grid", () => {
    const { bin, layout } = encodeBundle(input);
    const city = decodeBundle(toArrayBuffer(bin), layout);
    expect(city.count).toBe(2);
    expect(Array.from(city.buildingRingStart)).toEqual([0, 2, 3]);
    expect(Array.from(city.ringStart)).toEqual([0, 4, 8, 11]);
    const flat = input.flatMap((b) => b.rings.flat(2));
    flat.forEach((value, i) => expect(Math.abs(city.xy[i] - value)).toBeLessThanOrEqual(XY_STEP_M / 2 + 1e-4));
    expect(city.top[0]).toBeCloseTo(131.27, 2);
    expect(city.ground[1]).toBeCloseTo(150, 2);
  });

  it("drops a ring that collapses on the grid and refuses a file that does not match its manifest", () => {
    const sliver = { rings: [[[0, 0], [0.01, 0], [0.01, 0.01]]], top: 5, ground: 0 };
    const { bin, layout, dropped } = encodeBundle([...input, sliver]);
    expect(dropped).toBe(1);
    expect(layout.buildings).toBe(2);
    expect(() => decodeBundle(toArrayBuffer(bin.subarray(0, bin.length - 4)), layout)).toThrow();
    expect(() => decodeBundle(toArrayBuffer(bin), { ...layout, vertices: layout.vertices + 1 })).toThrow();
  });
});

describe("the committed buildings", () => {
  const manifest = readManifest();
  const source = readFileSync(SOURCE);

  it("are the files the manifest names", () => {
    expect(sha256(source)).toBe(manifest.source.sha256);
    expect(sha256(readBundle())).toBe(manifest.bundle.sha256Unpacked);
    expect(manifest.bundle.file).toBe(BIN_GZ);
    expect(manifest.box).toEqual(BOX);
  });

  it("come out of the build script byte for byte", () => {
    const rebuilt = buildBundle(source);
    expect(sha256(rebuilt.bin)).toBe(manifest.bundle.sha256Unpacked);
    expect(rebuilt.manifestText).toBe(readFileSync(MANIFEST, "utf8"));
  });

  it("hold no record that outlines a whole block", () => {
    // Three source records outline city blocks of 3.6 to 4.4 ha. Kept, each stood as one block
    // tens of metres high over every street inside it. The largest real building in the box
    // covers under 4,000 m2, so nothing near a hectare belongs here.
    const city = readCity();
    let largest = 0;
    for (const feature of footprintFeatures(city)) {
      const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      let area = 0;
      for (const [outer] of polygons) {
        const ring = outer.map(([lng, lat]) => toLocal(lng, lat));
        let twice = 0;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) twice += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
        area += Math.abs(twice) / 2;
      }
      largest = Math.max(largest, area);
    }
    expect(largest).toBeLessThan(10_000);
  });

  it("decode to footprints inside the box with roofs above sea level", () => {
    const city = readCity();
    expect(city.count).toBe(manifest.bundle.buildings);
    let outside = 0;
    for (let i = 0; i < city.xy.length; i += 2) {
      if (city.xy[i] < BOX_M.west - 1 || city.xy[i] > BOX_M.east + 1 || city.xy[i + 1] < BOX_M.south - 1 || city.xy[i + 1] > BOX_M.north + 1) outside++;
    }
    expect(outside).toBe(0);
    expect(Math.min(...city.top)).toBeGreaterThan(100);
    expect(Math.min(...city.ground)).toBeGreaterThan(100);
    expect(city.maxTop).toBeLessThan(300);
  });
});

describe("the buildings as shapes for the map", () => {
  it("keep a courtyard as a hole and two separate parts as two polygons", () => {
    const city = cityFromBuildings([
      { rings: [rectangle(0, 0, 30, 30), rectangle(10, 10, 20, 20)], top: 112, ground: 100 },
      { rings: [rectangle(50, 0, 60, 10), rectangle(70, 0, 80, 10)], top: 105, ground: 100 },
      { rings: [rectangle(100, 0, 110, 10)], top: 99, ground: 100 },
    ]);
    const [yard, twin, ...rest] = footprintFeatures(city);
    expect(rest).toEqual([]); // the third building is below its ground and is not drawn
    expect(yard.geometry.type).toBe("Polygon");
    expect(yard.geometry.coordinates).toHaveLength(2);
    expect(yard.properties.height).toBe(12);
    expect(twin.geometry.type).toBe("MultiPolygon");
    expect(twin.geometry.coordinates).toHaveLength(2);
    // Rings come back closed, in longitude and latitude inside the box.
    const ring = yard.geometry.coordinates[0] as number[][];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring[0][0]).toBeGreaterThan(BOX.west);
    expect(ring[0][1]).toBeLessThan(BOX.north);
  });

  it("cover every committed building that stands above its ground", () => {
    const city = readCity();
    const manifest = readManifest();
    expect(footprintFeatures(city)).toHaveLength(manifest.bundle.buildings - manifest.heightAboveGroundM.notAboveGround);
  });
});

describe("the ray query against swept prism shadows on the real buildings", () => {
  // Two ways to the same answer. The query walks back from the point toward the sun through
  // an index. The reference pushes every building's footprint forward along its shadow.
  it("agrees at every sampled point and sun position", () => {
    const city = readCity();
    const random = seeded(20261118);
    const suns = [sunDeg(62, 175), sunDeg(35, 120), sunDeg(20, 235), sunDeg(8, 95)];
    let compared = 0, shaded = 0;
    const disagreements: string[] = [];
    for (let i = 0; i < 400; i++) {
      // Keep away from the box edge so "unknown" does not enter; this test is about blocking.
      const x = (random() - 0.5) * (BOX_M.east - BOX_M.west) * 0.8;
      const y = (random() - 0.5) * (BOX_M.north - BOX_M.south) * 0.8;
      const ground = groundAt(city, x, y);
      for (const sun of suns) {
        const fast = lightAt(city, x, y, sun, ground) === "shade";
        const reference = inSweptShadow(city, x, y, sun, ground);
        compared++;
        if (reference) shaded++;
        if (fast !== reference) disagreements.push(`${x.toFixed(2)}, ${y.toFixed(2)} at ${(sun.elevation * 180 / Math.PI).toFixed(0)} deg`);
      }
    }
    expect(disagreements).toEqual([]);
    // The sample has to exercise both answers, or agreement means nothing.
    expect(shaded).toBeGreaterThan(compared * 0.2);
    expect(shaded).toBeLessThan(compared * 0.9);
  });
});
