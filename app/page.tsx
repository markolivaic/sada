"use client";

import { useEffect, useMemo, useState } from "react";
import MapComponent, { type PlaceDetail } from "@/components/MapComponent";
import SadaUI from "@/components/SadaUI";
import Splash from "@/components/Splash";
import TimeControl from "@/components/TimeControl";
import { distanceText, holdText, minutesToNextMorning, originNote, whyText } from "@/lib/describe";
import { LIGHTS } from "@/lib/engine";
import { ORIGIN, inBox, toLocal } from "@/lib/geo/frame";
import type { Light } from "@/lib/geo/shade";
import { sunAt, sunFromAngles } from "@/lib/geo/sun";
import { useLocation, useNow } from "@/lib/hooks";
import type { Category } from "@/lib/places";
import { walkRoute, type Walk } from "@/lib/route";
import { skyFor } from "@/lib/sky";
import { useShade } from "@/lib/useShade";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

type RouteState = { placeId: string; walk: Walk | null };

// Stands in for the sun until the page knows the time, so nothing is drawn as lit.
const BELOW_HORIZON = sunFromAngles(-1, 0);

export default function Home() {
  const shade = useShade();
  const now = useNow();
  const location = useLocation();
  const [offsetMinutes, setOffsetMinutes] = useState(0);
  const [clockOpen, setClockOpen] = useState(false);
  const [category, setCategory] = useState<Category>("cafe");
  const [want, setWant] = useState<"sun" | "shade" | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [tappedId, setTappedId] = useState<string | null>(null);
  const [route, setRoute] = useState<RouteState | null>(null);

  const time = useMemo(() => (now ? new Date(now.getTime() + offsetMinutes * 60_000) : null), [now, offsetMinutes]);
  const sun = useMemo(() => (time ? sunAt(time) : null), [time]);
  const sky = useMemo(() => skyFor(sun ?? BELOW_HORIZON), [sun]);
  const night = sun !== null && sun.elevation <= 0;

  // Distances are measured from the person when they stand inside the mapped box, and
  // from the middle of the box otherwise. The panel says which.
  const origin = useMemo(() => {
    if (location.status !== "found") return { x: 0, y: 0, lng: ORIGIN.lng, lat: ORIGIN.lat, isPerson: false, awayM: null };
    const [x, y] = toLocal(location.lng, location.lat);
    if (inBox(x, y)) return { x, y, lng: location.lng, lat: location.lat, isPerson: true, awayM: null };
    return { x: 0, y: 0, lng: ORIGIN.lng, lat: ORIGIN.lat, isPerson: false, awayM: Math.hypot(x, y) };
  }, [location]);

  // Ask the worker again whenever anything the answer depends on has changed.
  const { status, request } = shade;
  const timeMs = time?.getTime() ?? null;
  useEffect(() => {
    if (status !== "ready" || timeMs === null) return;
    request({ timeMs, origin: { x: origin.x, y: origin.y }, ask: want ? { want, category } : null, skip: skipped, detailId: tappedId });
  }, [status, request, timeMs, origin.x, origin.y, want, category, skipped, tappedId]);

  const frame = shade.frame;
  const lights = useMemo(() => {
    const map = new Map<string, Light>();
    if (frame) shade.places.forEach((place, i) => map.set(place.id, LIGHTS[frame.result.lights[i]]));
    return map;
  }, [frame, shade.places]);

  // The newest frame may still answer an earlier question; show its pick only if it is this one.
  const answersThis = frame !== null && frame.request.ask?.want === want && frame.request.ask?.category === category && frame.request.skip === skipped;
  const pick = want && answersThis ? frame.result.pick : null;
  const matching = answersThis ? frame.result.matching : 0;
  const frameTime = useMemo(() => (frame ? new Date(frame.result.timeMs) : null), [frame]);

  // Ask for a walking route once the pick has settled, so dragging the clock does not
  // fire a request per step.
  const pickId = pick?.place.id ?? null;
  const pickLng = pick?.place.seatLng, pickLat = pick?.place.seatLat;
  useEffect(() => {
    const token = MAPBOX_TOKEN;
    if (!token || pickId === null || pickLng === undefined || pickLat === undefined) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      walkRoute({ lng: origin.lng, lat: origin.lat }, { lng: pickLng, lat: pickLat }, token, controller.signal)
        .then((walk) => setRoute({ placeId: pickId, walk }))
        .catch((error) => {
          if (controller.signal.aborted) return;
          console.error("No walking route:", error);
          setRoute({ placeId: pickId, walk: null });
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [pickId, pickLng, pickLat, origin.lng, origin.lat]);

  // Without a token there is no routing service to ask, so the pick goes straight to
  // the straight-line distance.
  const pickRoute: RouteState | null = !pick ? null : !MAPBOX_TOKEN ? { placeId: pick.place.id, walk: null } : route?.placeId === pick.place.id ? route : null;

  const detail = useMemo<PlaceDetail | null>(() => {
    const tapped = frame?.result.detail;
    if (!tapped || tapped.placeId !== tappedId || !frameTime) return null;
    const place = shade.places.find((p) => p.id === tapped.placeId);
    return place ? { place, headline: holdText(tapped.hold, frameTime), light: tapped.hold.light, distanceText: `${distanceText(tapped.distanceM)} in a straight line` } : null;
  }, [frame, frameTime, tappedId, shade.places]);

  const ask = (next: "sun" | "shade") => {
    setWant(next);
    setSkipped([]);
    setTappedId(null);
  };

  return (
    <div className="h-dvh w-screen overflow-hidden relative">
      {/* The map starts once the time is known, so it never opens on the wrong time of day. */}
      {sun && (
        <MapComponent
          places={shade.places}
          lights={lights}
          buildings={shade.buildings}
          category={category}
          sun={sun}
          sky={sky}
          user={location.status === "found" ? { lng: location.lng, lat: location.lat } : null}
          pick={pick?.place ?? null}
          route={pickRoute?.walk?.coordinates ?? null}
          detail={detail}
          holdCamera={clockOpen}
          onPlaceTap={setTappedId}
          onDismissDetail={() => setTappedId(null)}
        />
      )}
      {now && time && <TimeControl now={now} time={time} offsetMinutes={offsetMinutes} phase={sky.phase} open={clockOpen} onOpenChange={setClockOpen} onChange={setOffsetMinutes} />}
      <div className="absolute bottom-0 inset-x-0 z-10">
        <SadaUI
          status={shade.status}
          night={night}
          category={category}
          want={want}
          pending={want !== null && !answersThis}
          pick={pick}
          headline={pick && frameTime ? holdText(pick.hold, frameTime) : null}
          detail={pick && pickRoute ? whyText(pick.hold, pickRoute.walk, pick.distanceM) : null}
          matching={matching}
          originNote={originNote(location.status, origin.isPerson, origin.awayM)}
          onCategory={(next) => {
            setCategory(next);
            setSkipped([]);
            setTappedId(null);
          }}
          onWant={ask}
          onAnother={() => pick && setSkipped((ids) => [...ids, pick.place.id])}
          onStartOver={() => setSkipped([])}
          onClear={() => {
            setWant(null);
            setSkipped([]);
          }}
          onTomorrow={() => now && setOffsetMinutes(minutesToNextMorning(now))}
        />
      </div>
      <Splash done={shade.status !== "loading"} />
    </div>
  );
}
