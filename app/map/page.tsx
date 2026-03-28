"use client";

import { useState, useCallback, useRef } from "react";
import MapComponent from "@/components/MapComponent";
import type { POI, PoiTapPayload, MapPoiDetail, DestinationShadowInfo, PoiShadowData } from "@/components/MapComponent";
import SadaUI from "@/components/SadaUI";
import type { SadaResult, DestinationDetail } from "@/components/SadaUI";

export default function MapPage() {
  const [destination, setDestination] = useState<{ lat: number; lng: number } | null>(null);
  const [routeCoordinates, setRouteCoordinates] = useState<[number, number][] | null>(null);
  const [isNight, setIsNight] = useState(false);
  const [poiDetail, setPoiDetail] = useState<MapPoiDetail | null>(null);
  const [destinationDetail, setDestinationDetail] = useState<DestinationDetail | null>(null);
  const [sadaResult, setSadaResult] = useState<SadaResult | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number }>({ lat: 45.813, lng: 15.9779 });
  const [destinationPoi, setDestinationPoi] = useState<POI | null>(null);
  const poiShadowRef = useRef<PoiShadowData | null>(null);
  const lastResultRef = useRef<SadaResult | null>(null);

  const handleResult = useCallback((result: SadaResult) => {
    const dest = result.destination;
    setDestination({ lat: dest.lat, lng: dest.lng });
    setDestinationPoi({
      id: dest.id,
      name: dest.name,
      lat: dest.lat,
      lng: dest.lng,
      category: dest.category,
      tags: {},
    });
    setRouteCoordinates(result.route.coordinates);
    setPoiDetail(null);
    setDestinationDetail(null);
    setSadaResult(result);
    lastResultRef.current = result;
  }, []);

  const handleExitNavigation = useCallback(() => {
    setDestination(null);
    setDestinationPoi(null);
    setRouteCoordinates(null);
    setDestinationDetail(null);
    setSadaResult(null);
    lastResultRef.current = null;
  }, []);

  const handleDestinationShadow = useCallback(async (info: DestinationShadowInfo) => {
    const result = lastResultRef.current;
    if (!result) return;

    const stableFor =
      info.stableForMinutes >= 360
        ? "6+ hours"
        : info.stableForMinutes >= 60
          ? `${Math.floor(info.stableForMinutes / 60)}h ${info.stableForMinutes % 60 ? ` ${info.stableForMinutes % 60} min` : ""}`
          : `${info.stableForMinutes} min`;

    try {
      const res = await fetch(`/api/sada/pois/${result.destination.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shadow: { currentState: info.shadowState, sunAltitudeDeg: info.sunAltitudeDeg },
          stableForMinutes: info.stableForMinutes,
          distanceMeters: result.route.distanceMeters,
          walkingMinutes: result.route.durationMinutes,
          poiName: result.destination.name,
          poiCategory: result.destination.category,
        }),
      });
      const data = await res.json();
      setDestinationDetail({
        shadowState: info.shadowState,
        stableFor: stableFor.trim(),
        description: data.description,
      });
    } catch {
      // detail fetch failed
    }
  }, []);

  const handlePoiTap = useCallback(async (payload: PoiTapPayload) => {
    const { poi, shadowState, sunAltitudeDeg, stableForMinutes } = payload;

    const stableFor =
      stableForMinutes >= 360
        ? "6+ hours"
        : stableForMinutes >= 60
          ? `${Math.floor(stableForMinutes / 60)}h ${stableForMinutes % 60 ? `${stableForMinutes % 60} min` : ""}`
          : `${stableForMinutes} min`;

    try {
      const res = await fetch(`/api/sada/pois/${poi.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shadow: { currentState: shadowState, sunAltitudeDeg },
          stableForMinutes,
          distanceMeters: 200,
          poiName: poi.name,
          poiCategory: poi.category,
        }),
      });
      const data = await res.json();
      setPoiDetail({
        id: poi.id,
        name: poi.name,
        category: poi.category,
        lat: poi.lat,
        lng: poi.lng,
        shadowState,
        stableFor: stableFor.trim(),
        description: data.description,
        walkingMinutes: data.walkingMinutes,
      });
    } catch {
      // TODO: surface error
    }
  }, []);

  const navigating = !!sadaResult && !!destination;

  return (
    <div className="h-screen w-screen overflow-hidden relative">
      <MapComponent
        destination={destination}
        destinationPoi={destinationPoi}
        routeCoordinates={routeCoordinates}
        onNightChange={setIsNight}
        onPoiTap={handlePoiTap}
        onDestinationShadow={handleDestinationShadow}
        onPoiShadowData={(data) => { poiShadowRef.current = data; }}
        poiDetail={poiDetail}
        onDismissPoiDetail={() => setPoiDetail(null)}
        onUserLocation={setUserLocation}
      />
      <div className="absolute bottom-0 inset-x-0 z-10">
        <SadaUI
          onResult={handleResult}
          onExitNavigation={handleExitNavigation}
          isNight={isNight}
          navigating={navigating}
          result={sadaResult}
          destinationDetail={destinationDetail}
          userLocation={userLocation}
          getPoiShadowData={() => poiShadowRef.current}
        />
      </div>
    </div>
  );
}
