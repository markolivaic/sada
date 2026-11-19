"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import snapshot from "@/data/osm/places.json";
import type { FrameRequest, FrameResult } from "./engine.ts";
import type { FootprintFeature } from "./geo/footprints.ts";
import { LatestOnly } from "./latest.ts";
import type { Place } from "./places.ts";
import type { FromWorker, ToWorker } from "./shade.worker.ts";

export interface Frame {
  request: FrameRequest;
  result: FrameResult;
}

export interface Shade {
  status: "loading" | "failed" | "ready";
  places: Place[];
  /** The buildings the answers come from, for drawing them on the map. */
  buildings: FootprintFeature[];
  /** The newest answered frame, with the request it answers. */
  frame: Frame | null;
  request: (request: FrameRequest) => void;
}

/** Loads the buildings into a worker and keeps the newest answer from it. */
export function useShade(): Shade {
  const [status, setStatus] = useState<Shade["status"]>("loading");
  const [places, setPlaces] = useState<Place[]>([]);
  const [buildings, setBuildings] = useState<FootprintFeature[]>([]);
  const [frame, setFrame] = useState<Frame | null>(null);
  const queue = useRef<LatestOnly<FrameRequest> | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL("./shade.worker.ts", import.meta.url), { type: "module" });
    const send = (message: ToWorker, transfer: Transferable[] = []) => worker.postMessage(message, transfer);
    let sent: FrameRequest | null = null;
    const latest = new LatestOnly<FrameRequest>((request) => {
      sent = request;
      send({ type: "frame", request });
    });
    let stopped = false;

    worker.onmessage = (event: MessageEvent<FromWorker>) => {
      const message = event.data;
      if (message.type === "ready") {
        setPlaces(message.places);
        setBuildings(message.buildings);
        queue.current = latest;
        setStatus("ready");
      } else if (message.type === "failed") {
        console.error("Could not read the buildings:", message.reason);
        setStatus("failed");
      } else if (sent) {
        setFrame({ request: sent, result: message.result });
        latest.settled();
      }
    };
    worker.onerror = (event) => {
      console.error("The geometry worker stopped:", event.message);
      setStatus("failed");
    };

    async function load() {
      const manifest = await fetch("/data/buildings.json");
      if (!manifest.ok) throw new Error(`manifest: HTTP ${manifest.status}`);
      const { bundle } = await manifest.json();
      const buildings = await fetch("/data/buildings.bin.gz");
      if (!buildings.ok || !buildings.body) throw new Error(`buildings: HTTP ${buildings.status}`);
      // The file is stored gzip-compressed, because hosts send binary files as they are.
      const bin = await new Response(buildings.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
      if (!stopped) send({ type: "init", bin, layout: bundle, snapshot: snapshot.places }, [bin]);
    }
    load().catch((error) => {
      console.error("Could not load the buildings:", error);
      if (!stopped) setStatus("failed");
    });

    return () => {
      stopped = true;
      queue.current = null;
      worker.terminate();
    };
  }, []);

  const request = useCallback((next: FrameRequest) => queue.current?.request(next), []);
  return { status, places, buildings, frame, request };
}
