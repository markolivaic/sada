// Runs the geometry off the main thread: decodes the buildings once, then answers one
// frame request at a time with the light at every place and the pick.

import { createEngine, type Engine, type FrameRequest, type FrameResult } from "./engine.ts";
import { decodeBundle, type BundleLayout } from "./geo/bundle.ts";
import { footprintFeatures, type FootprintFeature } from "./geo/footprints.ts";
import { placesFrom, type Place, type SnapshotPlace } from "./places.ts";

export type ToWorker =
  | { type: "init"; bin: ArrayBuffer; layout: BundleLayout; snapshot: SnapshotPlace[] }
  | { type: "frame"; request: FrameRequest };

export type FromWorker =
  | { type: "ready"; places: Place[]; buildings: FootprintFeature[] }
  | { type: "failed"; reason: string }
  | { type: "frame"; result: FrameResult };

const post = (message: FromWorker, transfer: Transferable[] = []) =>
  (self as unknown as { postMessage(message: FromWorker, transfer: Transferable[]): void }).postMessage(message, transfer);

let engine: Engine | null = null;

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.type === "init") {
    try {
      const city = decodeBundle(message.bin, message.layout);
      engine = createEngine(city, placesFrom(message.snapshot, city).places);
      post({ type: "ready", places: engine.places, buildings: footprintFeatures(city) });
    } catch (error) {
      post({ type: "failed", reason: String(error) });
    }
    return;
  }
  if (!engine) return;
  const result = engine.frame(message.request);
  post({ type: "frame", result }, [result.lights.buffer]);
};
