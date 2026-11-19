"use client";

import { useEffect, useRef } from "react";
import { useMap } from "react-map-gl/mapbox";
import type { GeoJSONSource, LayerSpecification, Map as MapboxMap, MapMouseEvent } from "mapbox-gl";
import type { FeatureCollection } from "geojson";
import type { Sun } from "@/lib/geo/sun";
import { lightsFor, type Sky } from "@/lib/sky";

export const CLOSE_VIEW = { zoom: 15.6, pitch: 55, bearing: -20 };
// Keeps what the camera centres on clear of the clock at the top and the sheet at the bottom.
export const VIEW_PADDING = { top: 70, bottom: 260, left: 0, right: 0 };

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

// Everything this app adds to the map. Sources start empty and are filled once added.
const GROUPS: { source: "route" | "buildings" | "places"; layers: LayerSpecification[] }[] = [
  {
    source: "route",
    layers: [
      { id: "route-glow", type: "line", source: "route", slot: "middle", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#93c5fd", "line-width": 10, "line-opacity": 0.5, "line-emissive-strength": 1 } },
      { id: "route-core", type: "line", source: "route", slot: "middle", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#2563eb", "line-width": 4, "line-emissive-strength": 1 } },
    ],
  },
  {
    source: "buildings",
    layers: [
      {
        id: "buildings",
        type: "fill-extrusion",
        source: "buildings",
        slot: "middle",
        paint: {
          "fill-extrusion-color": "#f1e9da",
          "fill-extrusion-height": ["get", "height"],
          "fill-extrusion-base": 0,
          "fill-extrusion-ambient-occlusion-intensity": 0.35,
          "fill-extrusion-cast-shadows": true,
        },
      },
    ],
  },
  {
    source: "places",
    layers: [
      // Sun is a filled dot, shade a ring, unknown a small grey dot: shape as well as colour.
      {
        id: "places",
        type: "circle",
        source: "places",
        slot: "top",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, ["match", ["get", "light"], "unknown", 2, 3.5], 17, ["match", ["get", "light"], "unknown", 4, 8]],
          "circle-color": ["match", ["get", "light"], "sun", "#f59e0b", "shade", "#ffffff", "#cbd5e1"],
          "circle-stroke-color": ["match", ["get", "light"], "sun", "#ffffff", "shade", "#334155", "#94a3b8"],
          "circle-stroke-width": ["match", ["get", "light"], "shade", 2.5, 1.5],
          "circle-emissive-strength": 1,
        },
      },
      {
        id: "place-names",
        type: "symbol",
        source: "places",
        slot: "top",
        minzoom: 16,
        filter: ["!=", ["get", "name"], "Bench"],
        layout: { "text-field": ["get", "name"], "text-size": 12, "text-offset": [0, 1.1], "text-anchor": "top", "text-optional": true },
        paint: { "text-color": "#1f2937", "text-halo-color": "#ffffff", "text-halo-width": 1.5, "text-emissive-strength": 1 },
      },
    ],
  },
];

interface MapSceneProps {
  buildings: FeatureCollection;
  places: FeatureCollection;
  route: FeatureCollection | null;
  sun: Sun;
  sky: Sky;
  /** Where to move the camera when it is first known: the person, if inside the mapped box. */
  home: { lng: number; lat: number } | null;
  pick: { lng: number; lat: number } | null;
  /** True while the clock is open: the camera does not follow the pick. */
  holdCamera: boolean;
  onPlaceTap: (placeId: string) => void;
}

function setData(map: MapboxMap, id: string, data: FeatureCollection): void {
  try {
    (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
  } catch {
    // The style is being replaced; the data goes in again when the layers are added back.
  }
}

function setLight(map: MapboxMap, sun: Sun, sky: Sky): void {
  try {
    map.setConfigProperty("basemap", "lightPreset", sky.preset);
    map.setLights(lightsFor(sun, sky));
  } catch {
    // Not accepted before the style is in; applied again when the layers are added.
  }
}

/**
 * The app's own layers, light and camera, added to the map by hand.
 *
 * The Standard style imports its base map, and Mapbox refuses new layers until that import
 * is in, even though the style already reports itself loaded. So adding is simply tried on
 * every style event until Mapbox accepts it, and tried again if the style is ever replaced.
 * Rendered inside the map, so it only exists once the map does.
 */
export default function MapScene({ buildings, places, route, sun, sky, home, pick, holdCamera, onPlaceTap }: MapSceneProps) {
  const map = useMap().current?.getMap();
  const latest = useRef({ buildings, places, route, sun, sky, onPlaceTap });
  useEffect(() => {
    latest.current = { buildings, places, route, sun, sky, onPlaceTap };
  });

  useEffect(() => {
    if (!map) return;
    const present = () => {
      try {
        return GROUPS.every((group) => map.getSource(group.source)) && GROUPS.every((group) => group.layers.every((layer) => map.getLayer(layer.id)));
      } catch {
        return false;
      }
    };
    const install = () => {
      if (present()) return;
      const now = latest.current;
      try {
        // The sun's light first: a layer only casts shadows if that light exists when it is added.
        map.setConfigProperty("basemap", "lightPreset", now.sky.preset);
        map.setLights(lightsFor(now.sun, now.sky));
        for (const group of GROUPS) {
          if (!map.getSource(group.source)) map.addSource(group.source, { type: "geojson", data: EMPTY });
          for (const layer of group.layers) if (!map.getLayer(layer.id)) map.addLayer(layer);
        }
      } catch {
        return; // The base map is not in yet. The next style event tries again.
      }
      setData(map, "buildings", now.buildings);
      setData(map, "places", now.places);
      setData(map, "route", now.route ?? EMPTY);
    };
    const tap = (event: MapMouseEvent) => {
      const id = event.features?.[0]?.properties?.id;
      if (typeof id === "string") latest.current.onPlaceTap(id);
    };
    const pointer = () => (map.getCanvas().style.cursor = "pointer");
    const plain = () => (map.getCanvas().style.cursor = "");

    // Once the style and its base map are fully in, set the light again: the base map takes
    // its starting look from the map's options when it arrives, over anything set before.
    const settled = () => {
      install();
      setLight(map, latest.current.sun, latest.current.sky);
    };
    map.on("styledata", install);
    map.on("style.load", settled);
    map.on("style.import.load", settled);
    map.on("click", "places", tap);
    map.on("mouseenter", "places", pointer);
    map.on("mouseleave", "places", plain);
    install();
    return () => {
      map.off("styledata", install);
      map.off("style.load", settled);
      map.off("style.import.load", settled);
      map.off("click", "places", tap);
      map.off("mouseenter", "places", pointer);
      map.off("mouseleave", "places", plain);
    };
  }, [map]);

  useEffect(() => {
    if (map) setData(map, "buildings", buildings);
  }, [map, buildings]);
  useEffect(() => {
    if (map) setData(map, "places", places);
  }, [map, places]);
  useEffect(() => {
    if (map) setData(map, "route", route ?? EMPTY);
  }, [map, route]);
  useEffect(() => {
    if (map) setLight(map, sun, sky);
  }, [map, sun, sky]);

  // The camera moves to the person once, when they are first known to be inside the box.
  const homeLng = home?.lng, homeLat = home?.lat;
  const movedHome = useRef(false);
  useEffect(() => {
    if (!map || movedHome.current || homeLng === undefined || homeLat === undefined) return;
    movedHome.current = true;
    map.flyTo({ center: [homeLng, homeLat], ...CLOSE_VIEW, padding: VIEW_PADDING, duration: 1200, essential: true });
  }, [map, homeLng, homeLat]);

  // The camera goes to the pick once it has settled, and stays put while the clock is open:
  // the pick can change many times as the clock moves, and following it would hide the
  // shadows moving. Closing the clock takes the camera to wherever the pick is then.
  const pickLng = pick?.lng, pickLat = pick?.lat;
  useEffect(() => {
    if (!map || holdCamera || pickLng === undefined || pickLat === undefined) return;
    const timer = setTimeout(() => map.flyTo({ center: [pickLng, pickLat], zoom: 17.2, pitch: 55, bearing: -20, padding: VIEW_PADDING, duration: 1800 }), 300);
    return () => clearTimeout(timer);
  }, [map, holdCamera, pickLng, pickLat]);

  return null;
}
