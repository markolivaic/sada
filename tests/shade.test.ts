import { describe, expect, it } from "vitest";
import { cityFromBuildings } from "../lib/geo/city.ts";
import { BOX_M } from "../lib/geo/frame.ts";
import { buildingAt, groundAt, lightAt } from "../lib/geo/shade.ts";
import { sunAt } from "../lib/geo/sun.ts";
import { blocks, rectangle, sunDeg } from "./support.ts";

const RAD = Math.PI / 180;

describe("a 10 m block with the sun 45 degrees up in the south", () => {
  const city = blocks({ rings: [rectangle(0, 0, 10, 10)], top: 10 });
  const sun = sunDeg(45, 180);

  it("shades the 10 m strip north of it and nothing past it", () => {
    expect(lightAt(city, 5, 10.1, sun)).toBe("shade");
    expect(lightAt(city, 5, 19.9, sun)).toBe("shade");
    expect(lightAt(city, 5, 20.1, sun)).toBe("sun");
  });

  it("leaves the ground beside the strip and south of the block lit", () => {
    expect(lightAt(city, -0.1, 15, sun)).toBe("sun");
    expect(lightAt(city, 10.1, 15, sun)).toBe("sun");
    expect(lightAt(city, 5, -1, sun)).toBe("sun");
  });

  it("counts a point under the roof as shade", () => {
    expect(lightAt(city, 5, 5, sun)).toBe("shade");
    expect(buildingAt(city, 5, 5)).toBe(0);
    expect(buildingAt(city, 5, 15)).toBe(-1);
  });

  it("is all shade once the sun is below the horizon", () => {
    expect(lightAt(city, 5, 30, sunDeg(-1, 180))).toBe("shade");
    expect(lightAt(city, 5, 30, sunDeg(0, 180))).toBe("shade");
  });

  it("throws the shadow away from the sun for every bearing", () => {
    for (let bearing = 0; bearing < 360; bearing += 15) {
      const low = sunDeg(45, bearing);
      // 7 m out from the block's edge on the side facing away from the sun, and the same toward it.
      const away = [5 - low.east * 12, 5 - low.north * 12];
      const toward = [5 + low.east * 12, 5 + low.north * 12];
      expect(lightAt(city, away[0], away[1], low), `away at ${bearing}`).toBe("shade");
      expect(lightAt(city, toward[0], toward[1], low), `toward at ${bearing}`).toBe("sun");
    }
  });
});

describe("footprints that are not convex", () => {
  // An L: the full 20 m square without its north-east quarter.
  const ell = blocks({ rings: [[[0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]]], top: 10 });

  it("leaves the inner corner of an L lit when the sun shines into it", () => {
    expect(lightAt(ell, 12, 12, sunDeg(45, 45))).toBe("sun");
    expect(lightAt(ell, 19, 19, sunDeg(45, 45))).toBe("sun");
  });

  it("shades the same corner when the sun is behind the L", () => {
    expect(lightAt(ell, 12, 12, sunDeg(45, 225))).toBe("shade");
  });

  // A block around a 10 m courtyard. Sun 60 degrees up in the south: the south wing's
  // shadow reaches 10 / tan(60) = 5.77 m into the yard.
  const yard = blocks({ rings: [rectangle(0, 0, 30, 30), rectangle(10, 10, 20, 20)], top: 10 });

  it("lights the far side of a courtyard and shades the near side", () => {
    const sun = sunDeg(60, 180);
    expect(lightAt(yard, 15, 15.6, sun)).toBe("shade");
    expect(lightAt(yard, 15, 15.9, sun)).toBe("sun");
    expect(buildingAt(yard, 15, 15)).toBe(-1);
    expect(buildingAt(yard, 5, 15)).toBe(0);
  });
});

describe("height above the ground the point stands on", () => {
  // Roof at 120 m. From ground at 110 m it is a 10 m building, from 100 m a 20 m one.
  const city = cityFromBuildings([{ rings: [rectangle(0, 0, 10, 10)], top: 120, ground: 110 }]);
  const sun = sunDeg(45, 180);

  it("uses the roof height above the point, not the building's own height", () => {
    expect(lightAt(city, 5, 25, sun, 110)).toBe("sun");
    expect(lightAt(city, 5, 25, sun, 100)).toBe("shade");
    expect(lightAt(city, 5, 31, sun, 100)).toBe("sun");
  });

  it("ignores a roof that is below the point", () => {
    expect(lightAt(city, 5, 11, sun, 125)).toBe("sun");
  });

  it("takes ground level from the nearest buildings", () => {
    expect(groundAt(city, 5, 25)).toBeCloseTo(110, 5);
  });
});

describe("the edge of the mapped box", () => {
  const empty = blocks();

  it("does not call it sun when the box ends before a 30 m building could be ruled out", () => {
    // 20 m inside the south edge. A 30 m building just outside would block any sun below 56 degrees.
    const y = BOX_M.south + 20;
    expect(lightAt(empty, 0, y, sunDeg(40, 180), 0)).toBe("unknown");
    expect(lightAt(empty, 0, y, sunDeg(60, 180), 0)).toBe("sun");
    // The same low sun from the north has the whole box behind it.
    expect(lightAt(empty, 0, y, sunDeg(40, 0), 0)).toBe("sun");
  });

  it("is unknown outside the box", () => {
    expect(lightAt(empty, 0, BOX_M.south - 5, sunDeg(60, 180), 0)).toBe("unknown");
  });

  it("still says shade near the edge when a mapped building blocks the sun", () => {
    const y = BOX_M.south + 20;
    const city = blocks({ rings: [rectangle(-5, y - 10, 5, y - 4)], top: 10 });
    expect(lightAt(city, 0, y, sunDeg(40, 180), 0)).toBe("shade");
  });
});

describe("sun position over Zagreb", () => {
  // SunCalc counts azimuth from south. A wrong conversion to compass bearing puts the
  // morning sun in the west, so these check the bearing against the time of day.
  it("is in the east in the morning, south at noon and west in the evening", () => {
    const morning = sunAt(new Date("2026-06-21T05:00:00Z"));
    const noon = sunAt(new Date("2026-06-21T10:58:00Z"));
    const evening = sunAt(new Date("2026-06-21T16:00:00Z"));
    expect(morning.bearing / RAD).toBeGreaterThan(60);
    expect(morning.bearing / RAD).toBeLessThan(100);
    expect(noon.bearing / RAD).toBeGreaterThan(177);
    expect(noon.bearing / RAD).toBeLessThan(183);
    expect(evening.bearing / RAD).toBeGreaterThan(260);
    expect(evening.bearing / RAD).toBeLessThan(300);
    expect(morning.east).toBeGreaterThan(0.8);
    expect(evening.east).toBeLessThan(-0.8);
  });

  it("stands 90 - latitude + 23.44 degrees high at the summer solstice noon", () => {
    const noon = sunAt(new Date("2026-06-21T10:58:00Z"));
    expect(noon.elevation / RAD).toBeCloseTo(90 - 45.814 + 23.44, 0);
  });

  it("puts a morning shadow on the west side of a block", () => {
    const city = blocks({ rings: [rectangle(0, 0, 10, 10)], top: 10 });
    const morning = sunAt(new Date("2026-06-21T05:30:00Z"));
    expect(lightAt(city, -3, 5, morning, 0)).toBe("shade");
    expect(lightAt(city, 13, 5, morning, 0)).toBe("sun");
  });

  it("differs by less than a twentieth of a degree across the box", () => {
    let worst = 0;
    for (const iso of ["2026-06-21T05:00:00Z", "2026-06-21T11:00:00Z", "2026-12-21T08:00:00Z", "2026-12-21T13:30:00Z", "2026-03-20T16:00:00Z"]) {
      const date = new Date(iso);
      const centre = sunAt(date);
      for (const [lat, lng] of [[45.808, 15.968], [45.808, 15.998], [45.82, 15.968], [45.82, 15.998]]) {
        const corner = sunAt(date, lat, lng);
        worst = Math.max(worst, Math.abs(corner.elevation - centre.elevation) / RAD, Math.abs(corner.bearing - centre.bearing) / RAD);
      }
    }
    expect(worst).toBeLessThan(0.05);
  });
});
