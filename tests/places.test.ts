import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clockText, durationText, holdText, minutesToNextMorning, originNote, whyText } from "../lib/describe.ts";
import { LIGHTS, createEngine } from "../lib/engine.ts";
import { BOX } from "../lib/geo/frame.ts";
import { SEAT_OFFSET_M, seatFor } from "../lib/geo/seat.ts";
import { buildingAt } from "../lib/geo/shade.ts";
import { LatestOnly } from "../lib/latest.ts";
import { rank, scorePlaces, type Scored } from "../lib/pick.ts";
import { placesFrom, type Place, type SnapshotPlace } from "../lib/places.ts";
import { RouteError, parseDirections } from "../lib/route.ts";
import { blocks, readCity, rectangle } from "./support.ts";

describe("where a cafe's seats are taken to be", () => {
  // Three houses in a row sharing walls, street to the south (y < 0), yard to the north.
  const row = blocks(
    { rings: [rectangle(0, 0, 10, 12)], top: 12 },
    { rings: [rectangle(10, 0, 20, 12)], top: 12 },
    { rings: [rectangle(20, 0, 30, 12)], top: 12 },
  );

  it("leaves a point in the open where it is", () => {
    expect(seatFor(row, 15, -5)).toEqual({ x: 15, y: -5, moved: false });
  });

  it("moves a point under a roof to 2 m outside the nearest wall", () => {
    const seat = seatFor(row, 15, 3);
    expect(seat).toMatchObject({ moved: true });
    expect(seat!.x).toBeCloseTo(15, 5);
    expect(seat!.y).toBeCloseTo(-SEAT_OFFSET_M, 5);
  });

  it("skips a wall shared with the next house, even when it is the nearest", () => {
    // 1 m from the party wall at x = 10, 4 m from the street.
    const seat = seatFor(row, 11, 4);
    expect(seat!.x).toBeCloseTo(11, 5);
    expect(seat!.y).toBeCloseTo(-SEAT_OFFSET_M, 5);
    expect(buildingAt(row, seat!.x, seat!.y)).toBe(-1);
  });

  it("gives up on a building walled in on every side", () => {
    const enclosed = blocks(
      { rings: [rectangle(0, 0, 10, 10)], top: 10 },
      { rings: [rectangle(-10, -10, 20, 0)], top: 10 },
      { rings: [rectangle(-10, 10, 20, 20)], top: 10 },
      { rings: [rectangle(-10, 0, 0, 10)], top: 10 },
      { rings: [rectangle(10, 0, 20, 10)], top: 10 },
    );
    expect(seatFor(enclosed, 5, 5)).toBeNull();
  });
});

describe("the committed places", () => {
  const snapshot: { counts: { cafe: number; bench: number }; places: SnapshotPlace[] } = JSON.parse(readFileSync("data/osm/places.json", "utf8"));
  const city = readCity();
  const { places, withoutSeat } = placesFrom(snapshot.places, city);

  it("lie inside the box and match the snapshot's own counts", () => {
    expect(snapshot.places.filter((p) => p.category === "cafe")).toHaveLength(snapshot.counts.cafe);
    expect(snapshot.places.filter((p) => p.category === "bench")).toHaveLength(snapshot.counts.bench);
    for (const p of snapshot.places) {
      expect(p.lng >= BOX.west && p.lng <= BOX.east && p.lat >= BOX.south && p.lat <= BOX.north, p.id).toBe(true);
    }
  });

  it("give every cafe seat open air, close to where the cafe is mapped", () => {
    const cafes = places.filter((p) => p.category === "cafe");
    expect(cafes.length + withoutSeat).toBe(snapshot.counts.cafe + snapshot.counts.bench - places.filter((p) => p.category === "bench").length);
    for (const cafe of cafes) expect(buildingAt(city, cafe.x, cafe.y), cafe.id).toBe(-1);
    // Almost every cafe is mapped under its own roof, so the rule has to fire for most of them.
    expect(cafes.filter((c) => c.moved).length).toBeGreaterThan(cafes.length * 0.7);
  });
});

describe("the pick", () => {
  const place = (id: string, category: "cafe" | "bench"): Place => ({ id, category, name: id, lng: 0, lat: 0, x: 0, y: 0, seatLng: 0, seatLat: 0, moved: false });
  const scored = (id: string, light: "sun" | "shade" | "unknown", minutes: number, distanceM: number, category: "cafe" | "bench" = "cafe"): Scored => ({
    place: place(id, category),
    hold: { light, minutes, until: "change" },
    distanceM,
  });

  it("takes the nearest place that keeps the wanted light for 20 minutes", () => {
    const list = [
      scored("near, about to lose it", "sun", 5, 80),
      scored("far, lasting", "sun", 120, 600),
      scored("mid, lasting", "sun", 45, 300),
      scored("nearest, wrong light", "shade", 200, 20),
      scored("nearest, unknown", "unknown", 0, 10),
      scored("bench", "sun", 200, 30, "bench"),
    ];
    expect(rank(list, "sun", "cafe").map((s) => s.place.id)).toEqual(["mid, lasting", "far, lasting", "near, about to lose it"]);
    expect(rank(list, "shade", "cafe").map((s) => s.place.id)).toEqual(["nearest, wrong light"]);
    expect(rank(list, "shade", "bench")).toEqual([]);
  });
});

describe("the words under a pick", () => {
  it("round durations down", () => {
    expect(durationText(7)).toBe("7 min");
    expect(durationText(29)).toBe("25 min");
    expect(durationText(60)).toBe("about 1 h");
    expect(durationText(109)).toBe("about 1 h 40 min");
  });

  // 21 June 2026, 09:50 UTC is 11:50 on a Zagreb clock (summer time).
  const at = new Date("2026-06-21T09:50:00Z");

  it("say when the light ends, on a Zagreb clock, and what ends it", () => {
    expect(clockText(at)).toBe("11:50");
    expect(holdText({ light: "sun", minutes: 100, until: "change" }, at)).toBe("Sun until 13:30");
    expect(holdText({ light: "shade", minutes: 300, until: "sunset" }, at)).toBe("Shade until sunset");
    expect(holdText({ light: "sun", minutes: 38, until: "edge" }, at)).toBe("Sun until at least 12:28");
    expect(holdText({ light: "unknown", minutes: 0, until: "edge" }, at)).toBe("Sun too low to tell here");
    // In winter the same UTC moment is one hour earlier on the clock.
    expect(holdText({ light: "sun", minutes: 10, until: "change" }, new Date("2026-12-21T09:50:00Z"))).toBe("Sun until 11:00");
  });

  it("give walking time from a route, and only a straight-line distance without one", () => {
    const hold = { light: "sun", minutes: 100, until: "change" } as const;
    expect(whyText(hold, { minutes: 5.6, distanceM: 431 }, 380)).toBe("about 1 h 40 min left, 6 min walk, 430 m");
    expect(whyText(hold, null, 384)).toBe("about 1 h 40 min left, 380 m in a straight line");
  });

  it("say where distances are measured from when it is not the person", () => {
    expect(originNote("found", true, null)).toBeNull();
    expect(originNote("found", false, 380_400)).toContain("about 380 km from the mapped part of Zagreb");
    expect(originNote("found", false, 900)).toContain("just outside");
    expect(originNote("denied", false, null)).toContain("not available");
    expect(originNote("locating", false, null)).toContain("Finding where you are");
  });

  it("find the next 9:00 on a Zagreb clock", () => {
    expect(minutesToNextMorning(new Date("2026-06-21T19:30:00Z"))).toBe(11 * 60 + 30); // 21:30 local
    expect(minutesToNextMorning(new Date("2026-12-21T16:00:00Z"))).toBe(16 * 60); // 17:00 local
    expect(minutesToNextMorning(new Date("2026-06-21T07:00:00Z"))).toBe(24 * 60); // exactly 9:00 local
  });
});

describe("the frame the worker answers", () => {
  const snapshot: { places: SnapshotPlace[] } = JSON.parse(readFileSync("data/osm/places.json", "utf8"));
  const city = readCity();
  const { places } = placesFrom(snapshot.places, city);
  const engine = createEngine(city, places);
  const noon = new Date("2026-06-21T11:00:00Z").getTime();
  const base = { timeMs: noon, origin: { x: 0, y: 0 }, skip: [], detailId: null };

  it("gives a light for every place and no pick without a question", () => {
    const frame = engine.frame({ ...base, ask: null });
    expect(frame.lights).toHaveLength(places.length);
    expect(frame.pick).toBeNull();
    expect(new Set(frame.lights).size).toBeGreaterThan(1);
  });

  it("picks the head of the full ranking, and the next one when that is skipped", () => {
    const ranked = rank(scorePlaces(city, places, new Date(noon), base.origin), "sun", "cafe");
    const first = engine.frame({ ...base, ask: { want: "sun", category: "cafe" } });
    expect(first.pick?.place.id).toBe(ranked[0].place.id);
    expect(first.matching).toBe(ranked.length);
    expect(LIGHTS[first.lights[places.indexOf(ranked[0].place)]]).toBe("sun");
    const second = engine.frame({ ...base, ask: { want: "sun", category: "cafe" }, skip: [ranked[0].place.id] });
    expect(second.pick?.place.id).toBe(ranked[1].place.id);
  });

  it("offers nothing at night and describes a tapped place", () => {
    const night = engine.frame({ ...base, timeMs: new Date("2026-06-21T23:00:00Z").getTime(), ask: { want: "shade", category: "bench" }, detailId: places[0].id });
    expect(night.pick).toBeNull();
    expect(night.matching).toBe(0);
    expect(night.detail).toMatchObject({ placeId: places[0].id, hold: { light: "shade" } });
  });
});

describe("one request in flight", () => {
  it("sends the first request, drops the ones in between and sends the newest when the answer is back", () => {
    const sent: number[] = [];
    const queue = new LatestOnly<number>((n) => sent.push(n));
    queue.request(1);
    queue.request(2);
    queue.request(3);
    expect(sent).toEqual([1]);
    queue.settled();
    expect(sent).toEqual([1, 3]);
    queue.settled();
    expect(sent).toEqual([1, 3]);
    queue.request(4);
    expect(sent).toEqual([1, 3, 4]);
  });
});

describe("reading a routing answer", () => {
  it("takes the first route's line, length and time", () => {
    const walk = parseDirections({
      code: "Ok",
      routes: [{ distance: 431.2, duration: 312.5, geometry: { type: "LineString", coordinates: [[15.977, 45.813], [15.978, 45.8135], [15.979, 45.814]] } }],
    });
    expect(walk.distanceM).toBe(431.2);
    expect(walk.minutes).toBeCloseTo(5.21, 2);
    expect(walk.coordinates).toHaveLength(3);
  });

  it("throws instead of inventing a route", () => {
    expect(() => parseDirections({ code: "NoRoute", routes: [] })).toThrow(RouteError);
    expect(() => parseDirections({ message: "Not Authorized - Invalid Token" })).toThrow(RouteError);
    expect(() => parseDirections({ routes: [{ distance: 10, duration: 5, geometry: { coordinates: [[15.9, 45.8]] } }] })).toThrow(RouteError);
  });
});
