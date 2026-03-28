"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import Map, { Source, Layer, Marker } from "react-map-gl/mapbox";
import type { MapRef, MapMouseEvent } from "react-map-gl/mapbox";
import SunCalc from "suncalc";
import * as turf from "@turf/turf";
import type { FeatureCollection, Feature, Polygon } from "geojson";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

const ZG_LAT = 45.813;
const ZG_LNG = 15.9779;

const LNG_OFFSET = 0.0;
const LAT_OFFSET = 0.0;

const MAX_SHADOW_M = 500;

const INITIAL_VIEW = {
  longitude: ZG_LNG,
  latitude: ZG_LAT,
  zoom: 11,
  pitch: 0,
  bearing: 0,
};

const EMPTY_FC: FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

// Hardcoded walking route for demo — replace with API response later
const DEMO_ROUTE: [number, number][] = [
  [15.9779, 45.8130],   // start (user location / ZG center)
  [15.9775, 45.8135],
  [15.9770, 45.8138],
  [15.9765, 45.8142],
  [15.9758, 45.8145],
  [15.9752, 45.8148],
  [15.9748, 45.8152],
  [15.9745, 45.8155],
  [15.9740, 45.8158],   // end (destination)
];

const DEMO_DESTINATION = { lat: 45.8158, lng: 15.9740 };

interface MapComponentProps {
  destination?: { lat: number; lng: number } | null;
}

// ── color helpers ──

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function parseHex(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function lerpColor(a: string, b: string, t: number): string {
  const [r1, g1, b1] = parseHex(a);
  const [r2, g2, b2] = parseHex(b);
  const c = Math.max(0, Math.min(1, t));
  const r = Math.round(r1 + (r2 - r1) * c);
  const g = Math.round(g1 + (g2 - g1) * c);
  const bl = Math.round(b1 + (b2 - b1) * c);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl.toString(16).padStart(2, "0")}`;
}

// ── sun state ──

function getSunState(time: Date) {
  const sun = SunCalc.getPosition(time, ZG_LAT, ZG_LNG);
  const alt = (sun.altitude * 180) / Math.PI;
  const sunBearing = ((sun.azimuth * 180) / Math.PI + 180 + 360) % 360;
  const sunPolar = Math.max(0, 90 - Math.max(0, alt));
  const times = SunCalc.getTimes(time, ZG_LAT, ZG_LNG);

  let nightOverlay: number;
  let warmOverlay: number;
  let shadowOpacity: number;
  let lightColor: string;
  let lightIntensity: number;

  if (alt <= -6) {
    nightOverlay = 0.65;
    warmOverlay = 0;
    shadowOpacity = 0;
    lightColor = "#1e293b";
    lightIntensity = 0.1;
  } else if (alt <= 0) {
    const t = (alt + 6) / 6;
    nightOverlay = lerp(0.65, 0.2, t);
    warmOverlay = lerp(0, 0.25, t);
    shadowOpacity = 0;
    lightColor = lerpColor("#1e293b", "#f97316", t);
    lightIntensity = lerp(0.1, 0.35, t);
  } else if (alt <= 6) {
    const t = alt / 6;
    nightOverlay = lerp(0.2, 0, t);
    warmOverlay = lerp(0.25, 0, t);
    shadowOpacity = lerp(0.45, 0.3, t);
    lightColor = lerpColor("#f97316", "#ffffff", t);
    lightIntensity = lerp(0.35, 0.5, t);
  } else if (alt <= 15) {
    const t = (alt - 6) / 9;
    nightOverlay = 0;
    warmOverlay = 0;
    shadowOpacity = lerp(0.3, 0.25, t);
    lightColor = "#ffffff";
    lightIntensity = lerp(0.5, 0.4, t);
  } else {
    nightOverlay = 0;
    warmOverlay = 0;
    shadowOpacity = 0.25;
    lightColor = "#ffffff";
    lightIntensity = 0.4;
  }

  return {
    alt,
    sunBearing,
    sunPolar,
    nightOverlay,
    warmOverlay,
    shadowOpacity,
    lightColor,
    lightIntensity,
    sunrise: times.sunrise,
    sunset: times.sunset,
  };
}

// ── shadow computation ──

function computeShadows(buildings: FeatureCollection, time: Date): FeatureCollection {
  const sun = SunCalc.getPosition(time, ZG_LAT, ZG_LNG);
  if (sun.altitude <= 0) return EMPTY_FC;

  // SunCalc azimuth: 0=south, clockwise. To get shadow bearing (away from sun):
  // sun bearing = azimuthDeg + 180, shadow = sun bearing + 180 = azimuthDeg
  const shadowAzimuth = ((sun.azimuth * 180) / Math.PI + 360) % 360;
  const shadows: Feature<Polygon>[] = [];

  for (const feature of buildings.features) {
    try {
      if (!feature.geometry) continue;

      const height: number = (feature.properties?.Z_Delta as number) ?? 10;
      if (height <= 0) continue;

      const shadowLength = Math.min(height / Math.tan(sun.altitude), MAX_SHADOW_M);

      const translated = turf.transformTranslate(
        feature as Feature<Polygon>,
        shadowLength,
        shadowAzimuth,
        { units: "meters" },
      );

      const combined = turf.featureCollection([
        feature as Feature<Polygon>,
        translated,
      ]);

      const shadow = turf.convex(combined);
      if (shadow) shadows.push(shadow);
    } catch {
      // skip malformed features
    }
  }

  if (shadows.length === 0) return EMPTY_FC;

  // Merge all shadows into one polygon so overlapping areas don't stack opacity
  try {
    const merged = turf.union(turf.featureCollection(shadows));
    if (merged) return turf.featureCollection([merged]);
  } catch {
    // union can fail on degenerate geometry — fall back to individual polygons
  }

  return turf.featureCollection(shadows);
}

// ── component ──

export default function MapComponent({ destination = null }: MapComponentProps) {
  const mapRef = useRef<MapRef>(null);
  const [buildingData, setBuildingData] = useState<FeatureCollection | null>(null);
  const [shadowGeoJSON, setShadowGeoJSON] = useState<FeatureCollection>(EMPTY_FC);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [minuteOffset, setMinuteOffset] = useState(0);
  const [routeGeoJSON, setRouteGeoJSON] = useState<FeatureCollection<Polygon> | null>(null);

  // GPS
  useEffect(() => {
    if (!navigator.geolocation) {
      setUserLocation({ lat: ZG_LAT, lng: ZG_LNG });
      return;
    }
    let fellBack = false;
    const timer = window.setTimeout(() => {
      fellBack = true;
      setUserLocation((prev) => prev ?? { lat: ZG_LAT, lng: ZG_LNG });
    }, 8000);
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        clearTimeout(timer);
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        if (!fellBack) {
          clearTimeout(timer);
          setUserLocation({ lat: ZG_LAT, lng: ZG_LNG });
        }
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 30000 },
    );
    return () => {
      clearTimeout(timer);
      navigator.geolocation.clearWatch(id);
    };
  }, []);

  // Fetch buildings
  useEffect(() => {
    let cancelled = false;
    fetch("/data/zg3d_center.geojson")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: FeatureCollection) => {
        if (cancelled) return;
        if (LNG_OFFSET === 0 && LAT_OFFSET === 0) {
          setBuildingData(data);
          return;
        }
        const shifted: FeatureCollection = {
          type: "FeatureCollection",
          features: data.features.map((f) => {
            const geom = f.geometry as Polygon;
            if (!geom?.coordinates) return f;
            return {
              ...f,
              geometry: {
                ...geom,
                coordinates: geom.coordinates.map((ring) =>
                  ring.map(([lng, lat, ...rest]) => [lng + LNG_OFFSET, lat + LAT_OFFSET, ...rest]),
                ),
              },
            };
          }),
        };
        setBuildingData(shifted);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const getSimulatedTime = useCallback(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + minuteOffset);
    return d;
  }, [minuteOffset]);

  const simTime = useMemo(() => getSimulatedTime(), [getSimulatedTime]);
  const sunState = useMemo(() => getSunState(simTime), [simTime]);

  // Recompute shadows
  useEffect(() => {
    if (!buildingData) return;
    setShadowGeoJSON(computeShadows(buildingData, simTime));
  }, [buildingData, simTime]);

  // Intro animation — fly from bird's-eye down to user location once map is loaded
  const introPlayed = useRef(false);
  const handleMapLoad = useCallback(() => {
    if (introPlayed.current) return;
    const loc = userLocation ?? { lat: ZG_LAT, lng: ZG_LNG };
    introPlayed.current = true;
    setTimeout(() => {
      mapRef.current?.flyTo({
        center: [loc.lng, loc.lat],
        zoom: 15.5,
        pitch: 60,
        bearing: -20,
        duration: 3500,
        essential: true,
      });
    }, 300);
  }, [userLocation]);

  // If user location arrives after map already loaded, fly there
  useEffect(() => {
    if (!introPlayed.current || !userLocation) return;
    mapRef.current?.flyTo({
      center: [userLocation.lng, userLocation.lat],
      zoom: 15.5,
      pitch: 60,
      bearing: -20,
      duration: 2000,
      essential: true,
    });
    // only run on first real GPS fix
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLocation]);

  // FlyTo destination + show route
  useEffect(() => {
    if (!destination) {
      setRouteGeoJSON(null);
      return;
    }
    // Buffer the line into a thin polygon so we can render it as fill-extrusion
    const line = turf.lineString(DEMO_ROUTE);
    const buffered = turf.buffer(line, 3, { units: "meters" });
    if (buffered) {
      setRouteGeoJSON(turf.featureCollection([buffered]) as FeatureCollection<Polygon>);
    }

    mapRef.current?.flyTo({
      center: [destination.lng, destination.lat],
      zoom: 18,
      pitch: 60,
      bearing: -20,
      duration: 2500,
    });
  }, [destination]);

  const handleClick = (e: MapMouseEvent) => {
    const feature = e.features?.[0];
    if (feature) console.log("[DEBUG]", feature.properties);
  };

  const dynamicShadowLayer = useMemo(() => ({
    id: "shadow-polygons",
    type: "fill" as const,
    slot: "middle",
    paint: {
      "fill-color": "#0f172a",
      "fill-opacity": sunState.shadowOpacity,
    },
  }), [sunState]);

  // Slider sunrise/sunset markers
  const sliderMarkers = useMemo(() => {
    const now = new Date();
    const toOffset = (d: Date) => Math.round((d.getTime() - now.getTime()) / 60000);
    const toPct = (off: number) => ((off + 720) / 1440) * 100;
    const riseOff = toOffset(sunState.sunrise);
    const setOff = toOffset(sunState.sunset);
    return {
      sunrise: riseOff >= -720 && riseOff <= 720 ? toPct(riseOff) : null,
      sunset: setOff >= -720 && setOff <= 720 ? toPct(setOff) : null,
      sunriseTime: sunState.sunrise,
      sunsetTime: sunState.sunset,
    };
  }, [sunState]);

  // Dynamic sun-based lighting on 3D buildings
  const mapLight = useMemo(() => ({
    anchor: "map" as const,
    position: [1.5, sunState.sunBearing, sunState.sunPolar] as [number, number, number],
    color: sunState.lightColor,
    intensity: sunState.lightIntensity,
  }), [sunState]);

  const timeLabel = simTime.toLocaleTimeString("hr-HR", { hour: "2-digit", minute: "2-digit" });
  const isNight = sunState.alt <= 0;

  return (
    <Map
      ref={mapRef}
      initialViewState={INITIAL_VIEW}
      onLoad={handleMapLoad}
      onClick={handleClick}
      style={{ width: "100%", height: "100%" }}
      mapStyle="mapbox://styles/mapbox/standard"
      mapboxAccessToken={MAPBOX_TOKEN}
      light={mapLight}
      terrain={{ source: "mapbox-dem", exaggeration: 1.2 }}
    >
      <Source id="shadows" type="geojson" data={shadowGeoJSON}>
        <Layer {...dynamicShadowLayer} />
      </Source>

      {/* Route — glowing 3D ribbon at street level, rendered between buildings */}
      {routeGeoJSON && (
        <Source id="route" type="geojson" data={routeGeoJSON}>
          <Layer
            id="route-glow"
            type="fill-extrusion"
            slot="middle"
            paint={{
              "fill-extrusion-color": "#60a5fa",
              "fill-extrusion-height": 2.5,
              "fill-extrusion-base": 0,
              "fill-extrusion-opacity": 0.35,
            }}
          />
          <Layer
            id="route-core"
            type="fill-extrusion"
            slot="middle"
            paint={{
              "fill-extrusion-color": "#3b82f6",
              "fill-extrusion-height": 2,
              "fill-extrusion-base": 0,
              "fill-extrusion-opacity": 0.85,
            }}
          />
        </Source>
      )}

      {/* Destination pin */}
      {destination && (
        <Marker longitude={destination.lng} latitude={destination.lat} anchor="bottom">
          <div className="flex flex-col items-center">
            <div className="w-6 h-6 rounded-full bg-red-500 border-2 border-white shadow-lg flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-white" />
            </div>
            <div className="w-0.5 h-3 bg-red-500 -mt-0.5" />
          </div>
        </Marker>
      )}

      {/* User location */}
      {userLocation && (
        <Marker longitude={userLocation.lng} latitude={userLocation.lat} anchor="center">
          <div className="relative flex h-8 w-8 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex h-4 w-4 rounded-full bg-blue-600 border-2 border-white shadow-lg" />
          </div>
        </Marker>
      )}

      {/* Night overlay */}
      {sunState.nightOverlay > 0 && (
        <div
          className="absolute inset-0 pointer-events-none transition-opacity duration-300"
          style={{ background: "#0f172a", opacity: sunState.nightOverlay }}
        />
      )}

      {/* Golden hour warm overlay */}
      {sunState.warmOverlay > 0 && (
        <div
          className="absolute inset-0 pointer-events-none transition-opacity duration-300"
          style={{ background: "#f97316", opacity: sunState.warmOverlay }}
        />
      )}

      {/* Time slider panel */}
      <div className="absolute top-4 left-4 z-10 rounded-xl bg-white/90 backdrop-blur-sm px-4 py-3 shadow-lg w-[300px]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            {isNight ? "Night" : sunState.alt <= 6 ? "Golden Hour" : "Daylight"}
          </span>
          <span className="text-sm font-semibold text-gray-900 tabular-nums">{timeLabel}</span>
        </div>

        <div className="relative h-6 flex items-center">
          {/* Sunrise tick */}
          {sliderMarkers.sunrise !== null && (
            <div className="absolute pointer-events-none" style={{ left: `${sliderMarkers.sunrise}%` }}>
              <div className="w-px h-6 bg-amber-400 -translate-x-1/2" />
            </div>
          )}
          {/* Sunset tick */}
          {sliderMarkers.sunset !== null && (
            <div className="absolute pointer-events-none" style={{ left: `${sliderMarkers.sunset}%` }}>
              <div className="w-px h-6 bg-orange-500 -translate-x-1/2" />
            </div>
          )}
          <input
            type="range"
            min={-720}
            max={720}
            value={minuteOffset}
            onChange={(e) => setMinuteOffset(Number(e.target.value))}
            className="relative z-10 w-full h-1.5 rounded-full appearance-none cursor-pointer accent-blue-600 bg-gray-200"
          />
        </div>

        <div className="flex items-center justify-between mt-1.5">
          {sliderMarkers.sunrise !== null ? (
            <span className="text-[11px] text-amber-600 font-medium">
              ☀ {sliderMarkers.sunriseTime.toLocaleTimeString("hr-HR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          ) : (
            <span className="text-[10px] text-gray-400">-12h</span>
          )}
          <button
            onClick={() => setMinuteOffset(0)}
            className="text-[11px] font-medium text-blue-600 hover:text-blue-800 px-2"
          >
            Now
          </button>
          {sliderMarkers.sunset !== null ? (
            <span className="text-[11px] text-orange-600 font-medium">
              {sliderMarkers.sunsetTime.toLocaleTimeString("hr-HR", { hour: "2-digit", minute: "2-digit" })} ☾
            </span>
          ) : (
            <span className="text-[10px] text-gray-400">+12h</span>
          )}
        </div>
      </div>
    </Map>
  );
}