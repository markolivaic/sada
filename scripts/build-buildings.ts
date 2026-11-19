// Writes public/data/buildings.bin.gz and public/data/buildings.json from data/source.
// Run with: npm run build:data

import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { BIN_GZ, MANIFEST, SOURCE, buildBundle } from "./buildings.ts";

const { bin, manifest, manifestText } = buildBundle(readFileSync(SOURCE));
// Hosts do not compress a binary file on the way out, so it is stored compressed and the
// browser unpacks it. The manifest's hash is of the unpacked bytes.
const packed = gzipSync(bin, { level: 9 });
writeFileSync(BIN_GZ, packed);
writeFileSync(MANIFEST, manifestText);

const { ground, heightAboveGroundM, bundle } = manifest;
console.log(`${bundle.buildings} buildings, ${bundle.vertices} vertices, ${bundle.bytes} bytes, ${packed.byteLength} packed`);
console.log(`ground replaced by the neighbours' plane: ${ground.replacedAbove} bases above it, ${ground.replacedBelow} below`);
console.log(`height above ground: median ${heightAboveGroundM.median} m, 99% under ${heightAboveGroundM.p99} m, ${heightAboveGroundM.notAboveGround} not above ground`);
