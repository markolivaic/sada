"use client";

import { useState } from "react";
import Map, { Source, Layer } from "react-map-gl/mapbox";
import type { LayerProps } from "react-map-gl/mapbox";
import type { ViewStateChangeEvent } from "react-map-gl/mapbox";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

const INITIAL_VIEW = {
  longitude: 15.9779,
  latitude: 45.813,
  zoom: 15.5,
  pitch: 60,
  bearing: -20,
};

const buildingsLayer: LayerProps = {
  id: "zg3d-buildings",
  type: "fill-extrusion",
  paint: {
    "fill-extrusion-color": "#d1d5db",
    "fill-extrusion-height": ["get", "Z_Delta"],
    "fill-extrusion-base": 0,
    "fill-extrusion-opacity": 0.85,
  },
};

const shadowLayer: LayerProps = {
  id: "shadow-polygons",
  type: "fill",
  paint: {
    "fill-color": "#1e293b",
    "fill-opacity": 0.4,
  },
};

const emptyShadowGeoJSON: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

export default function MapComponent() {
  const [viewState, setViewState] = useState(INITIAL_VIEW);

  return (
    <Map
      {...viewState}
      onMove={(evt: ViewStateChangeEvent) => setViewState(evt.viewState)}
      style={{ width: "100%", height: "100%" }}
      mapStyle="mapbox://styles/mapbox/light-v11"
      mapboxAccessToken={MAPBOX_TOKEN}
    >
      {/* ZG3D LiDAR buildings — replace URL with real data source */}
      <Source id="zg3d" type="geojson" data="/data/zg3d.geojson">
        <Layer {...buildingsLayer} />
      </Source>

      {/* Dynamic shadow polygons — computed at runtime */}
      <Source id="shadows" type="geojson" data={emptyShadowGeoJSON}>
        <Layer {...shadowLayer} />
      </Source>
    </Map>
  );
}
