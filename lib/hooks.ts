"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/** The current time, refreshed every half minute. Null until the page is running in a browser. */
export function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export type LocationState =
  | { status: "locating" }
  | { status: "found"; lng: number; lat: number }
  | { status: "denied" }
  | { status: "unavailable" };

/** Where the person is, or why that is not known. Nothing is assumed in its place. */
export function useLocation(): LocationState {
  const [state, setState] = useState<LocationState>({ status: "locating" });
  const supported = useSyncExternalStore(noSubscription, () => "geolocation" in navigator, () => true);
  useEffect(() => {
    if (!supported) return;
    const watch = navigator.geolocation.watchPosition(
      (position) => setState({ status: "found", lng: position.coords.longitude, lat: position.coords.latitude }),
      (error) => setState((previous) => (previous.status === "found" ? previous : { status: error.code === error.PERMISSION_DENIED ? "denied" : "unavailable" })),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [supported]);
  return supported ? state : { status: "unavailable" };
}

const noSubscription = () => () => {};
