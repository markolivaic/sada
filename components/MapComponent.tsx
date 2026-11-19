"use client";

import { useMemo, useRef, useState } from "react";
import MapGL, { Marker, Popup } from "react-map-gl/mapbox";
import type { MapRef } from "react-map-gl/mapbox";
import type { FeatureCollection } from "geojson";
import type { FootprintFeature } from "@/lib/geo/footprints";
import { BOX } from "@/lib/geo/frame";
import type { Light } from "@/lib/geo/shade";
import type { Sun } from "@/lib/geo/sun";
import type { Category, Place } from "@/lib/places";
import type { Sky } from "@/lib/sky";
import MapScene, { CLOSE_VIEW, VIEW_PADDING } from "./MapScene";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// The camera starts tilted over the main square, so the first thing on screen is the city in 3D.
const INITIAL_VIEW = { longitude: 15.9772, latitude: 45.8131, ...CLOSE_VIEW };

// The base map without its own 3D buildings and without its own labels for cafés and shops:
// the buildings drawn here are the ones the answers are computed from.
const BASEMAP = { show3dObjects: false, showPointOfInterestLabels: false, showTransitLabels: false };

export interface PlaceDetail {
  place: Place;
  headline: string;
  light: Light;
  distanceText: string;
}

interface MapComponentProps {
  places: Place[];
  lights: Map<string, Light>;
  /** The buildings the answers come from. */
  buildings: FootprintFeature[];
  /** Only places of this kind are shown. */
  category: Category;
  sun: Sun;
  sky: Sky;
  user: { lng: number; lat: number } | null;
  pick: Place | null;
  route: [number, number][] | null;
  detail: PlaceDetail | null;
  /** True while the clock is open: the camera does not follow the pick. */
  holdCamera: boolean;
  onPlaceTap: (placeId: string) => void;
  onDismissDetail: () => void;
}

export default function MapComponent({ places, lights, buildings, category, sun, sky, user, pick, route, detail, holdCamera, onPlaceTap, onDismissDetail }: MapComponentProps) {
  const mapRef = useRef<MapRef>(null);
  const [mapFailed, setMapFailed] = useState(false);
  // The look the map starts with. Later changes go through the style config, not a new map.
  const [initialConfig] = useState(() => ({ basemap: { ...BASEMAP, lightPreset: sky.preset } }));

  const insideBox = user !== null && user.lng >= BOX.west && user.lng <= BOX.east && user.lat >= BOX.south && user.lat <= BOX.north;

  const buildingShapes = useMemo<FeatureCollection>(() => ({ type: "FeatureCollection", features: buildings }), [buildings]);

  const placePoints = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: places
        .filter((place) => place.category === category)
        .map((place) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [place.seatLng, place.seatLat] },
          properties: { id: place.id, name: place.name, light: lights.get(place.id) ?? "unknown" },
        })),
    }),
    [places, lights, category],
  );

  const routeLine = useMemo<FeatureCollection | null>(
    () => (route ? { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: route }, properties: {} }] } : null),
    [route],
  );

  const pickPoint = useMemo(() => (pick ? { lng: pick.seatLng, lat: pick.seatLat } : null), [pick]);

  if (!MAPBOX_TOKEN || mapFailed) {
    return (
      <div className="h-full w-full flex items-start justify-center bg-neutral-200 px-8 pt-28 text-center text-sm text-neutral-600" data-testid="map-missing">
        {MAPBOX_TOKEN ? "The map could not be loaded. The answers below still work." : "No map: NEXT_PUBLIC_MAPBOX_TOKEN is not set. The answers below still work."}
      </div>
    );
  }

  return (
    <MapGL
      ref={mapRef}
      initialViewState={INITIAL_VIEW}
      {...{ config: initialConfig }}
      onError={(event) => {
        console.error("Map error:", event.error);
        // A refused token is the one failure that leaves no map at all. Other errors, such as
        // a tile that did not arrive, leave the rest of the map working.
        const status = (event.error as { status?: number } | undefined)?.status;
        if (status === 401 || status === 403) setMapFailed(true);
      }}
      style={{ width: "100%", height: "100%" }}
      mapStyle="mapbox://styles/mapbox/standard"
      mapboxAccessToken={MAPBOX_TOKEN}
    >
      <MapScene
        buildings={buildingShapes}
        places={placePoints}
        route={routeLine}
        sun={sun}
        sky={sky}
        home={insideBox ? user : null}
        pick={pickPoint}
        holdCamera={holdCamera}
        onPlaceTap={onPlaceTap}
      />

      {user && (
        <Marker longitude={user.lng} latitude={user.lat} anchor="center">
          <div className="relative flex h-8 w-8 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex h-4 w-4 rounded-full bg-blue-600 border-2 border-white shadow-lg" />
          </div>
        </Marker>
      )}

      {pick && (
        <Marker longitude={pick.seatLng} latitude={pick.seatLat} anchor="center">
          <div className="relative flex h-10 w-10 items-center justify-center pointer-events-none">
            <span className="absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-50 animate-ping" />
            <span className="relative inline-flex h-5 w-5 rounded-full bg-rose-500 border-2 border-white shadow-lg" />
          </div>
        </Marker>
      )}

      {detail && (
        <Popup longitude={detail.place.seatLng} latitude={detail.place.seatLat} anchor="bottom" offset={14} closeOnClick={false} closeButton={false} onClose={onDismissDetail} maxWidth="260px">
          <div className="relative pr-10">
            <button onClick={onDismissDetail} aria-label="Close" className="absolute -top-2 -right-2 h-11 w-11 rounded-full text-lg text-neutral-500 hover:bg-neutral-100">
              ×
            </button>
            <p className="text-sm text-neutral-500">{detail.place.name}</p>
            <p className={`text-base font-semibold ${detail.light === "sun" ? "text-amber-600" : "text-slate-700"}`}>{detail.headline}</p>
            <p className="text-xs text-neutral-500">{detail.distanceText}</p>
          </div>
        </Popup>
      )}

      {user && insideBox && (
        <button
          onClick={() => mapRef.current?.flyTo({ center: [user.lng, user.lat], ...CLOSE_VIEW, padding: VIEW_PADDING, duration: 1500 })}
          className="absolute top-4 right-4 z-10 w-11 h-11 rounded-full bg-white/95 shadow-lg flex items-center justify-center"
          aria-label="Back to my location"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-blue-600">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
        </button>
      )}
    </MapGL>
  );
}
