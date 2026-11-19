import { cityFromArrays, type BuildingInput, type City } from "./city.ts";

// The building bundle: one little-endian binary file plus a JSON manifest that says where
// each buffer sits. Horizontal coordinates are int16 steps of 5 cm from the box centre,
// stored as differences along each ring. Heights are uint16 centimetres above sea level.

export const XY_STEP_M = 0.05;
export const Z_STEP_M = 0.01;

type Dtype = "uint32" | "int16" | "uint16";

export interface BufferEntry {
  offset: number;
  length: number;
  dtype: Dtype;
  count: number;
}

export interface BundleLayout {
  bytes: number;
  buildings: number;
  rings: number;
  vertices: number;
  xyStepM: number;
  zStepM: number;
  buffers: {
    buildingRingStart: BufferEntry;
    ringStart: BufferEntry;
    xyDelta: BufferEntry;
    top: BufferEntry;
    ground: BufferEntry;
  };
}

const BYTES: Record<Dtype, number> = { uint32: 4, int16: 2, uint16: 2 };

/** Drops repeated points after rounding to the grid; a ring needs three distinct points. */
function quantiseRing(ring: number[][]): number[][] | null {
  const out: number[][] = [];
  for (const [x, y] of ring) {
    const qx = Math.round(x / XY_STEP_M), qy = Math.round(y / XY_STEP_M);
    const last = out[out.length - 1];
    if (last && last[0] === qx && last[1] === qy) continue;
    out.push([qx, qy]);
  }
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out.length >= 3 ? out : null;
}

export function encodeBundle(buildings: BuildingInput[]): { bin: Uint8Array; layout: BundleLayout; dropped: number } {
  const kept: { rings: number[][][]; top: number; ground: number }[] = [];
  let dropped = 0;
  for (const building of buildings) {
    const rings = building.rings.map(quantiseRing).filter((r): r is number[][] => r !== null);
    if (rings.length === 0) {
      dropped++;
      continue;
    }
    kept.push({ rings, top: building.top, ground: building.ground });
  }
  const ringCount = kept.reduce((n, b) => n + b.rings.length, 0);
  const vertexCount = kept.reduce((n, b) => n + b.rings.reduce((m, r) => m + r.length, 0), 0);

  const buildingRingStart = new Uint32Array(kept.length + 1);
  const ringStart = new Uint32Array(ringCount + 1);
  const xyDelta = new Int16Array(vertexCount * 2);
  const top = new Uint16Array(kept.length);
  const ground = new Uint16Array(kept.length);
  let ring = 0, vertex = 0;
  kept.forEach((building, b) => {
    buildingRingStart[b] = ring;
    top[b] = Math.round(building.top / Z_STEP_M);
    ground[b] = Math.round(building.ground / Z_STEP_M);
    for (const points of building.rings) {
      ringStart[ring++] = vertex;
      let px = 0, py = 0;
      for (const [qx, qy] of points) {
        if (qx < -32768 || qx > 32767 || qy < -32768 || qy > 32767) throw new Error("a vertex lies outside the int16 range");
        xyDelta[2 * vertex] = qx - px;
        xyDelta[2 * vertex + 1] = qy - py;
        px = qx;
        py = qy;
        vertex++;
      }
    }
  });
  buildingRingStart[kept.length] = ring;
  ringStart[ring] = vertex;

  const parts: [keyof BundleLayout["buffers"], Dtype, ArrayBufferView][] = [
    ["buildingRingStart", "uint32", buildingRingStart],
    ["ringStart", "uint32", ringStart],
    ["xyDelta", "int16", xyDelta],
    ["top", "uint16", top],
    ["ground", "uint16", ground],
  ];
  const buffers = {} as BundleLayout["buffers"];
  let offset = 0;
  for (const [name, dtype, view] of parts) {
    buffers[name] = { offset, length: view.byteLength, dtype, count: view.byteLength / BYTES[dtype] };
    offset += Math.ceil(view.byteLength / 4) * 4;
  }
  const bin = new Uint8Array(offset);
  for (const [name, , view] of parts) {
    bin.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength), buffers[name].offset);
  }
  const layout: BundleLayout = {
    bytes: bin.byteLength,
    buildings: kept.length,
    rings: ringCount,
    vertices: vertexCount,
    xyStepM: XY_STEP_M,
    zStepM: Z_STEP_M,
    buffers,
  };
  return { bin, layout, dropped };
}

function slice(bin: ArrayBuffer, entry: BufferEntry, dtype: Dtype, count: number): ArrayBuffer {
  if (entry.dtype !== dtype) throw new Error(`bundle buffer is ${entry.dtype}, expected ${dtype}`);
  if (entry.count !== count || entry.length !== count * BYTES[dtype]) throw new Error("bundle buffer has the wrong length");
  return bin.slice(entry.offset, entry.offset + entry.length);
}

/** Reads a bundle. Throws when the file does not match its manifest. */
export function decodeBundle(bin: ArrayBuffer, layout: BundleLayout): City {
  if (bin.byteLength !== layout.bytes) throw new Error(`bundle is ${bin.byteLength} bytes, manifest says ${layout.bytes}`);
  const { buffers, buildings, rings, vertices } = layout;
  const buildingRingStart = new Uint32Array(slice(bin, buffers.buildingRingStart, "uint32", buildings + 1));
  const ringStart = new Uint32Array(slice(bin, buffers.ringStart, "uint32", rings + 1));
  const xyDelta = new Int16Array(slice(bin, buffers.xyDelta, "int16", vertices * 2));
  const topQ = new Uint16Array(slice(bin, buffers.top, "uint16", buildings));
  const groundQ = new Uint16Array(slice(bin, buffers.ground, "uint16", buildings));

  const xy = new Float32Array(vertices * 2);
  for (let r = 0; r < rings; r++) {
    let qx = 0, qy = 0;
    for (let v = ringStart[r]; v < ringStart[r + 1]; v++) {
      qx += xyDelta[2 * v];
      qy += xyDelta[2 * v + 1];
      xy[2 * v] = qx * layout.xyStepM;
      xy[2 * v + 1] = qy * layout.xyStepM;
    }
  }
  const top = Float32Array.from(topQ, (q) => q * layout.zStepM);
  const ground = Float32Array.from(groundQ, (q) => q * layout.zStepM);
  return cityFromArrays(buildingRingStart, ringStart, xy, top, ground);
}
