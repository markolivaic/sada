"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import MapGL, { Source, Layer, Marker, Popup } from "react-map-gl/mapbox";
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


export interface POI {
  id: string;
  name: string;
  lat: number;
  lng: number;
  category: "cafe" | "bench" | "park" | string;
  tags: Record<string, string>;
}

// Bounding box of geojson file — only show POIs where we have building shadow data
const SHADOW_BBOX = {
  minLat: 45.808,
  maxLat: 45.820,
  minLng: 15.968,
  maxLng: 15.998,
};

function isInShadowCoverage(lat: number, lng: number): boolean {
  return lat >= SHADOW_BBOX.minLat && lat <= SHADOW_BBOX.maxLat
    && lng >= SHADOW_BBOX.minLng && lng <= SHADOW_BBOX.maxLng;
}

export interface PoiTapPayload {
  poi: POI;
  shadowState: "sun" | "shade";
  sunAltitudeDeg: number;
  stableForMinutes: number;
}

export interface MapPoiDetail {
  id: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  shadowState: "sun" | "shade";
  stableFor: string;
  description: string;
  walkingMinutes: number;
}

export interface DestinationShadowInfo {
  shadowState: "sun" | "shade";
  stableForMinutes: number;
  sunAltitudeDeg: number;
}

export interface PoiShadowData {
  pois: POI[];
  shadowStates: Map<string, "sun" | "shade">;
}

interface MapComponentProps {
  destination?: { lat: number; lng: number } | null;
  destinationPoi?: POI | null;
  routeCoordinates?: [number, number][] | null;
  onNightChange?: (isNight: boolean) => void;
  onPoiTap?: (payload: PoiTapPayload) => void;
  onDestinationShadow?: (info: DestinationShadowInfo) => void;
  onPoiShadowData?: (data: PoiShadowData) => void;
  poiDetail?: MapPoiDetail | null;
  onDismissPoiDetail?: () => void;
  onUserLocation?: (loc: { lat: number; lng: number }) => void;
}

function isPointInShadowFast(
  pt: ReturnType<typeof turf.point>,
  buildings: FeatureCollection,
  time: Date,
): boolean {
  const sun = SunCalc.getPosition(time, ZG_LAT, ZG_LNG);
  if (sun.altitude <= 0) return true;

  const shadowAzimuth = ((sun.azimuth * 180) / Math.PI + 360) % 360;

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
      const combined = turf.featureCollection([feature as Feature<Polygon>, translated]);
      const shadow = turf.convex(combined);
      if (shadow && turf.booleanPointInPolygon(pt, shadow)) return true;
    } catch { /* skip */ }
  }
  return false;
}

function estimateStability(
  poi: POI,
  currentState: "sun" | "shade",
  buildings: FeatureCollection,
  startTime: Date,
): number {
  const pt = turf.point([poi.lng, poi.lat]);
  const step = 15;
  const maxLookahead = 240;

  for (let m = step; m <= maxLookahead; m += step) {
    const futureTime = new Date(startTime.getTime() + m * 60000);
    const sun = SunCalc.getPosition(futureTime, poi.lat, poi.lng);
    if (sun.altitude <= 0) {
      return currentState === "shade" ? maxLookahead : m;
    }
    const inShadow = isPointInShadowFast(pt, buildings, futureTime);
    const futureState = inShadow ? "shade" : "sun";
    if (futureState !== currentState) return m;
  }
  return maxLookahead;
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

export default function MapComponent({ destination = null, destinationPoi = null, routeCoordinates = null, onNightChange, onPoiTap, onDestinationShadow, onPoiShadowData, poiDetail = null, onDismissPoiDetail, onUserLocation }: MapComponentProps) {
  const mapRef = useRef<MapRef>(null);
  const [buildingData, setBuildingData] = useState<FeatureCollection | null>(null);
  const [shadowGeoJSON, setShadowGeoJSON] = useState<FeatureCollection>(EMPTY_FC);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [minuteOffset, setMinuteOffset] = useState(0);
  const [routeGeoJSON, setRouteGeoJSON] = useState<FeatureCollection<Polygon> | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [shadowsVisible, setShadowsVisible] = useState(false);
  const [greetingVisible, setGreetingVisible] = useState(true);
  const [fetchedPois, setFetchedPois] = useState<POI[]>([]);
  const [recalculating, setRecalculating] = useState(false);

  // Merge fetched POIs with destination POI (if it's not already in the list)
  const pois = useMemo(() => {
    if (!destinationPoi) return fetchedPois;
    const alreadyPresent = fetchedPois.some((p) => p.id === destinationPoi.id);
    if (alreadyPresent) return fetchedPois;
    return [...fetchedPois, destinationPoi];
  }, [fetchedPois, destinationPoi]);

  // GPS
  useEffect(() => {
    if (!navigator.geolocation) {
      const fallback = { lat: ZG_LAT, lng: ZG_LNG };
      setUserLocation(fallback);
      onUserLocation?.(fallback);
      return;
    }
    let fellBack = false;
    const timer = window.setTimeout(() => {
      fellBack = true;
      setUserLocation((prev) => {
        if (!prev) {
          const fb = { lat: ZG_LAT, lng: ZG_LNG };
          onUserLocation?.(fb);
          return fb;
        }
        return prev;
      });
    }, 8000);
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        clearTimeout(timer);
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(loc);
        onUserLocation?.(loc);
      },
      () => {
        if (!fellBack) {
          clearTimeout(timer);
          const fb = { lat: ZG_LAT, lng: ZG_LNG };
          setUserLocation(fb);
          onUserLocation?.(fb);
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
    fetch("/data/zg3d_shadow.geojson")
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

  // Fetch real POIs from API, filtered to shadow coverage area. Retries on failure.
  useEffect(() => {
    if (fetchedPois.length > 0) return;

    let cancelled = false;
    const center = {
      lat: (SHADOW_BBOX.minLat + SHADOW_BBOX.maxLat) / 2,
      lng: (SHADOW_BBOX.minLng + SHADOW_BBOX.maxLng) / 2,
    };

    const attempt = () => {
      fetch(`/api/sada/pois?lat=${center.lat}&lng=${center.lng}&radius=600`)
        .then((res) => res.json())
        .then((data: { locations?: POI[] }) => {
          if (cancelled) return;
          const locs = data.locations ?? [];
          if (locs.length === 0) {
            setTimeout(() => { if (!cancelled) attempt(); }, 5000);
            return;
          }
          const filtered = locs.filter((p) => isInShadowCoverage(p.lat, p.lng));
          setFetchedPois(filtered);
        })
        .catch(() => {
          if (!cancelled) setTimeout(attempt, 5000);
        });
    };
    attempt();

    return () => { cancelled = true; };
  }, [fetchedPois.length]);

  const getSimulatedTime = useCallback(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + minuteOffset);
    return d;
  }, [minuteOffset]);

  const simTime = useMemo(() => getSimulatedTime(), [getSimulatedTime]);
  const sunState = useMemo(() => getSunState(simTime), [simTime]);

  useEffect(() => {
    onNightChange?.(sunState.alt <= 0);
  }, [sunState.alt, onNightChange]);

  // Recompute shadows (debounced — turf.union is expensive)
  useEffect(() => {
    if (!buildingData) return;
    setRecalculating(true);
    const timer = setTimeout(() => {
      setShadowGeoJSON(computeShadows(buildingData, simTime));
      setRecalculating(false);
    }, 150);
    return () => clearTimeout(timer);
  }, [buildingData, simTime]);

  // Per-POI sun/shade state (cheap point-in-polygon against merged shadow)
  const poiShadowStates = useMemo(() => {
    const states = new Map<string, "sun" | "shade">();
    const isNightTime = sunState.alt <= 0;
    for (const poi of pois) {
      if (isNightTime) {
        states.set(poi.id, "shade");
        continue;
      }
      if (shadowGeoJSON.features.length === 0) {
        states.set(poi.id, "sun");
        continue;
      }
      const pt = turf.point([poi.lng, poi.lat]);
      let inShadow = false;
      for (const feat of shadowGeoJSON.features) {
        try {
          if (turf.booleanPointInPolygon(pt, feat as Feature<Polygon>)) {
            inShadow = true;
            break;
          }
        } catch { /* skip degenerate geometry */ }
      }
      states.set(poi.id, inShadow ? "shade" : "sun");
    }
    return states;
  }, [shadowGeoJSON, pois, sunState.alt]);

  // Push POIs + shadow states to parent so SadaUI can pick accurately
  useEffect(() => {
    if (pois.length > 0 && poiShadowStates.size > 0) {
      onPoiShadowData?.({ pois, shadowStates: poiShadowStates });
    }
  }, [pois, poiShadowStates, onPoiShadowData]);

  // Report destination shadow state upward
  useEffect(() => {
    if (!destination || !buildingData || !onDestinationShadow) return;
    const isNightTime = sunState.alt <= 0;
    if (isNightTime) {
      onDestinationShadow({ shadowState: "shade", stableForMinutes: 240, sunAltitudeDeg: 0 });
      return;
    }
    const pt = turf.point([destination.lng, destination.lat]);
    let inShadow = false;
    for (const feat of shadowGeoJSON.features) {
      try {
        if (turf.booleanPointInPolygon(pt, feat as Feature<Polygon>)) {
          inShadow = true;
          break;
        }
      } catch { /* skip */ }
    }
    const shadowState: "sun" | "shade" = inShadow ? "shade" : "sun";
    const fakePoi: POI = { id: "_dest", name: "", lat: destination.lat, lng: destination.lng, category: "", tags: {} };
    const stableForMinutes = estimateStability(fakePoi, shadowState, buildingData, simTime);
    onDestinationShadow({
      shadowState,
      stableForMinutes,
      sunAltitudeDeg: (sunState.alt * 180) / Math.PI,
    });
  }, [destination, shadowGeoJSON, buildingData, simTime, sunState.alt, onDestinationShadow]);

  // Intro animation — fly from bird's-eye down to user location once map is loaded
  const introPlayed = useRef(false);
  const handleMapLoad = useCallback(() => {
    setMapLoaded(true);
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
    // Fade out greeting after the fly-in finishes
    setTimeout(() => setGreetingVisible(false), 4000);
    // Show shadows after 3D models have had time to stream in
    setTimeout(() => setShadowsVisible(true), 4500);
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
    if (!destination || !routeCoordinates || routeCoordinates.length < 2) {
      setRouteGeoJSON(null);
      return;
    }
    const line = turf.lineString(routeCoordinates);
    const buffered = turf.buffer(line, 1.5, { units: "meters" });
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
  }, [destination, routeCoordinates]);

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
    const risePct = riseOff >= -720 && riseOff <= 720 ? toPct(riseOff) : null;
    const setPct = setOff >= -720 && setOff <= 720 ? toPct(setOff) : null;

    let trackGradient = "linear-gradient(to right, #e5e7eb 0%, #e5e7eb 100%)";
    if (risePct !== null && setPct !== null) {
      trackGradient = `linear-gradient(to right, #1e293b 0%, #1e293b ${risePct}%, #fbbf24 ${risePct}%, #e5e7eb ${risePct + 3}%, #e5e7eb ${setPct - 3}%, #fb923c ${setPct}%, #1e293b ${setPct}%, #1e293b 100%)`;
    }

    return {
      sunrise: risePct,
      sunset: setPct,
      sunriseTime: sunState.sunrise,
      sunsetTime: sunState.sunset,
      trackGradient,
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

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return "Good Morning";
    if (h < 17) return "Good Afternoon";
    return "Good Evening";
  }, []);

  return (
    <MapGL
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
      {shadowsVisible && (
        <Source id="shadows" type="geojson" data={shadowGeoJSON}>
          <Layer {...dynamicShadowLayer} />
        </Source>
      )}

      {/* Route — glowing 3D ribbon at street level, rendered between buildings */}
      {mapLoaded && routeGeoJSON && (
        <Source id="route" type="geojson" data={routeGeoJSON}>
          <Layer
            id="route-glow"
            type="fill"
            slot="middle"
            paint={{
              "fill-color": "#93c5fd",
              "fill-opacity": 0.4,
            }}
          />
          <Layer
            id="route-core"
            type="line"
            slot="middle"
            paint={{
              "line-color": "#3b82f6",
              "line-width": 4,
              "line-opacity": 0.9,
            }}
          />
        </Source>
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

      {/* POI markers */}
      {pois.map((poi) => {
        const state = poiShadowStates.get(poi.id) ?? "sun";
        const inSun = state === "sun";
        const selected = poiDetail?.id === poi.id;
        const isDestination = destinationPoi?.id === poi.id;
        const icon =
          poi.category === "cafe" ? "☕" : poi.category === "bench" ? "🪑" : poi.category === "park" ? "🌳" : "📍";
        return (
          <Marker key={poi.id} longitude={poi.lng} latitude={poi.lat} anchor="bottom">
            <div
              className="flex flex-col items-center gap-0.5 group cursor-pointer"
              onClick={() => {
                onPoiTap?.({
                  poi,
                  shadowState: state,
                  sunAltitudeDeg: (sunState.alt * 180) / Math.PI,
                  stableForMinutes: buildingData
                    ? estimateStability(poi, state, buildingData, simTime)
                    : 60,
                });
              }}
            >
              <div className="relative flex items-center justify-center">
                {isDestination && (
                  <span className="absolute inline-flex h-12 w-12 rounded-full bg-rose-400 opacity-50 animate-ping" />
                )}
                <div
                  className={`
                    relative rounded-full flex items-center justify-center text-base shadow-md
                    border-[3px] transition-all duration-300
                    ${isDestination
                      ? "w-11 h-11 border-rose-500 bg-rose-50 scale-110"
                      : selected
                        ? "w-11 h-11 border-blue-500 bg-blue-50 scale-110"
                        : `w-9 h-9 ${inSun ? "border-amber-400 bg-amber-50" : "border-slate-400 bg-slate-100"}`
                    }
                  `}
                >
                  {icon}
                </div>
              </div>
              <span
                className={`
                  text-[10px] font-semibold leading-tight px-1.5 py-0.5 rounded-md whitespace-nowrap
                  shadow-sm backdrop-blur-sm transition-all duration-300
                  ${isDestination
                    ? "bg-rose-100/90 text-rose-900"
                    : selected
                      ? "bg-blue-100/90 text-blue-900"
                      : inSun ? "bg-amber-100/80 text-amber-900" : "bg-slate-200/80 text-slate-700"
                  }
                `}
              >
                {poi.name}
              </span>
            </div>
          </Marker>
        );
      })}

      {/* POI detail popup */}
      {poiDetail && (
        <Popup
          longitude={poiDetail.lng}
          latitude={poiDetail.lat}
          anchor="left"
          offset={20}
          closeOnClick={false}
          closeButton={false}
          onClose={onDismissPoiDetail}
          className="poi-popup"
          maxWidth="280px"
        >
          <div className="space-y-1.5 p-1 relative">
            <button
              onClick={onDismissPoiDetail}
              className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-neutral-100 hover:bg-neutral-200 flex items-center justify-center transition-colors"
            >
              <span className="text-neutral-500 text-sm font-bold leading-none">✕</span>
            </button>
            <div className="flex items-center gap-2 pr-7">
              <span className="font-semibold text-sm text-neutral-900">{poiDetail.name}</span>
              <span
                className={`ml-auto text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full ${
                  poiDetail.shadowState === "sun"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-slate-200 text-slate-600"
                }`}
              >
                {poiDetail.shadowState === "sun" ? "☀ Sun" : "☁ Shade"}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-neutral-500">
              <span>{poiDetail.walkingMinutes} min walk</span>
              <span className="text-neutral-300">·</span>
              <span
                className={`font-medium ${
                  poiDetail.shadowState === "sun" ? "text-amber-600" : "text-slate-500"
                }`}
              >
                {poiDetail.shadowState === "sun" ? "☀" : "☁"} for {poiDetail.stableFor}
              </span>
            </div>
            <p className="text-xs text-neutral-600 leading-relaxed italic">
              &ldquo;{poiDetail.description}&rdquo;
            </p>
          </div>
        </Popup>
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

      {/* Greeting overlay */}
      <div
        className={`absolute top-8 left-1/2 -translate-x-1/2 z-20 transition-all duration-1000 ease-out ${
          greetingVisible && mapLoaded
            ? "opacity-100 translate-y-0"
            : greetingVisible
              ? "opacity-0 -translate-y-4"
              : "opacity-0 translate-y-4 pointer-events-none"
        }`}
      >
        <div className="rounded-2xl bg-white/80 backdrop-blur-md px-8 py-4 shadow-xl">
          <p className="text-2xl font-light text-gray-800 tracking-wide">{greeting}</p>
          <p className="text-sm text-gray-500 text-center mt-0.5">Zagreb, Croatia</p>
        </div>
      </div>

      {/* Time slider panel */}
      <div className="absolute top-4 left-4 z-10 rounded-xl bg-white/90 backdrop-blur-sm px-4 py-3 shadow-lg w-[300px]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            {isNight ? "Night" : sunState.alt <= 6 ? "Golden Hour" : "Daylight"}
          </span>
          <div className="flex items-center gap-2">
            {recalculating && (
              <span className="text-[10px] text-blue-500 font-medium animate-pulse">
                Recalculating…
              </span>
            )}
            <span className="text-sm font-semibold text-gray-900 tabular-nums">{timeLabel}</span>
          </div>
        </div>

        <div className="relative h-6 flex items-center">
          {/* Sunrise tick + label */}
          {sliderMarkers.sunrise !== null && (
            <div
              className="absolute pointer-events-none flex flex-col items-center"
              style={{ left: `${sliderMarkers.sunrise}%`, transform: "translateX(-50%)" }}
            >
              <div className="w-px h-6 bg-amber-400" />
              <span className="text-[9px] text-amber-600 font-medium mt-0.5 whitespace-nowrap">
                ☀ {sliderMarkers.sunriseTime.toLocaleTimeString("hr-HR", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          )}
          {/* Sunset tick + label */}
          {sliderMarkers.sunset !== null && (
            <div
              className="absolute pointer-events-none flex flex-col items-center"
              style={{ left: `${sliderMarkers.sunset}%`, transform: "translateX(-50%)" }}
            >
              <div className="w-px h-6 bg-orange-500" />
              <span className="text-[9px] text-orange-600 font-medium mt-0.5 whitespace-nowrap">
                {sliderMarkers.sunsetTime.toLocaleTimeString("hr-HR", { hour: "2-digit", minute: "2-digit" })} ☾
              </span>
            </div>
          )}
          <div
            className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full pointer-events-none"
            style={{ background: sliderMarkers.trackGradient }}
          />
          <input
            type="range"
            min={-720}
            max={720}
            value={minuteOffset}
            onChange={(e) => setMinuteOffset(Number(e.target.value))}
            className="relative z-10 w-full h-1.5 rounded-full appearance-none cursor-pointer accent-blue-600 bg-transparent"
          />
        </div>

        <div className="flex items-center justify-center mt-4">
          <button
            onClick={() => setMinuteOffset(0)}
            className="text-[11px] font-medium text-blue-600 hover:text-blue-800 px-2"
          >
            Reset to Now
          </button>
        </div>
      </div>

      {/* Back to my location button */}
      {userLocation && (
        <button
          onClick={() => {
            mapRef.current?.flyTo({
              center: [userLocation.lng, userLocation.lat],
              zoom: 15.5,
              pitch: 60,
              bearing: -20,
              duration: 1500,
            });
          }}
          className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-white/90 backdrop-blur-sm shadow-lg flex items-center justify-center hover:bg-white transition-colors"
          title="Back to my location"
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
