"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Sun, TreePine, Coffee, Armchair, Clock, Navigation, X, Footprints, RefreshCw,
} from "lucide-react";
import type { PoiShadowData } from "@/components/MapComponent";

type LightPref = "sun" | "shade";
type SeatPref = "cafe" | "bench";

const SEAT_CATEGORIES: Record<SeatPref, string[]> = {
  cafe: ["cafe"],
  bench: ["bench"],
};

export interface SadaResult {
  destination: {
    id: string;
    name: string;
    lat: number;
    lng: number;
    category: string;
  };
  route: {
    coordinates: [number, number][];
    distanceMeters: number;
    durationMinutes: number;
  };
  walkingDuration: string;
}

export interface DestinationDetail {
  shadowState: "sun" | "shade";
  stableFor: string;
  description: string;
}

interface SadaUIProps {
  onResult?: (result: SadaResult) => void;
  onExitNavigation?: () => void;
  isNight?: boolean;
  navigating?: boolean;
  result?: SadaResult | null;
  destinationDetail?: DestinationDetail | null;
  userLocation?: { lat: number; lng: number };
  getPoiShadowData?: () => PoiShadowData | null;
}

const LOADING_MESSAGES = [
  "Reading the shadows…",
  "Calculating sun angle…",
  "Scanning Zagreb…",
  "Finding your spot…",
];

export default function SadaUI({
  onResult,
  onExitNavigation,
  isNight = false,
  navigating = false,
  result: externalResult,
  destinationDetail,
  userLocation,
  getPoiShadowData,
}: SadaUIProps) {
  const [light, setLight] = useState<LightPref>("sun");
  const [seat, setSeat] = useState<SeatPref>("cafe");
  const [loading, setLoading] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [loadingIndex, setLoadingIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const loadingInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset exclusion list when preferences change
  useEffect(() => {
    setExcluded([]);
  }, [light, seat]);

  // Cycle loading messages
  useEffect(() => {
    if (loading) {
      setLoadingIndex(0);
      loadingInterval.current = setInterval(() => {
        setLoadingIndex((prev) =>
          prev < LOADING_MESSAGES.length - 1 ? prev + 1 : prev,
        );
      }, 900);
    } else {
      if (loadingInterval.current) clearInterval(loadingInterval.current);
    }
    return () => {
      if (loadingInterval.current) clearInterval(loadingInterval.current);
    };
  }, [loading]);

  const handleSada = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const loc = userLocation ?? { lat: 45.813, lng: 15.9779 };
      const categories = SEAT_CATEGORIES[seat] ?? [seat];

      // Try client-side selection using accurate building-shadow data
      const shadowData = getPoiShadowData?.();
      let chosenDestination: { id: string; name: string; lat: number; lng: number; category: string } | null = null;

      if (shadowData && shadowData.pois.length > 0) {
        const allOfType = shadowData.pois.filter((poi) => categories.includes(poi.category));
        const matchingShadow = allOfType.filter((poi) => shadowData.shadowStates.get(poi.id) === light);
        const candidates = matchingShadow.filter((poi) => {
          const coordKey = `${poi.lat},${poi.lng}`;
          return !excluded.includes(coordKey);
        });

        if (candidates.length > 0) {
          const pick = candidates[Math.floor(Math.random() * candidates.length)];
          chosenDestination = {
            id: pick.id,
            name: pick.name,
            lat: pick.lat,
            lng: pick.lng,
            category: pick.category,
          };
        } else if (matchingShadow.length === 0) {
          // No POIs of this type in the desired light condition at all
          const seatLabel = seat === "cafe" ? "cafés" : "benches";
          const lightLabel = light === "sun" ? "sun" : "shade";
          setError(`No ${seatLabel} in the ${lightLabel} right now. Try switching to ${light === "sun" ? "shade" : "sun"}, or a different seat type.`);
          setLoading(false);
          return;
        } else {
          // All matching POIs have been excluded via "Try another"
          setError(`You've seen all the ${seat === "cafe" ? "cafés" : "benches"} in the ${light}! Try the other preference.`);
          setLoading(false);
          return;
        }
      }

      if (!chosenDestination) {
        // No shadow data available yet — fall back to server-side
        setError("Still loading shadow data — try again in a moment.");
        setLoading(false);
        return;
      }

      const body: Record<string, unknown> = {
        light,
        seat,
        exclude: excluded,
        userLocation: loc,
        destination: chosenDestination,
      };

      const res = await fetch("/api/sada", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`Server error (${res.status})`);

      const data: SadaResult = await res.json();
      onResult?.(data);

      const coordKey = `${data.destination.lat},${data.destination.lng}`;
      setExcluded((prev) => [...prev, coordKey]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [light, seat, excluded, userLocation, onResult, getPoiShadowData]);

  // ── Navigation mode ──
  if (navigating && externalResult) {
    const dist = externalResult.route.distanceMeters;
    const distLabel = dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${dist} m`;

    return (
      <div className="mx-auto w-full max-w-lg rounded-t-3xl bg-white/90 backdrop-blur-xl p-5 pb-7 shadow-2xl">
        {/* Header row */}
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Navigation className="h-5 w-5 text-rose-500 shrink-0" />
              <span className="text-lg font-semibold text-neutral-900 truncate">
                {externalResult.destination.name}
              </span>
              {destinationDetail && (
                <span
                  className={`shrink-0 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                    destinationDetail.shadowState === "sun"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {destinationDetail.shadowState === "sun" ? "☀ Sun" : "☁ Shade"}
                </span>
              )}
            </div>

            {/* Stats row */}
            <div className="flex items-center gap-4 mt-2">
              <div className="flex items-center gap-1.5 text-neutral-900">
                <Clock className="h-4 w-4 text-neutral-400" />
                <span className="text-2xl font-bold tabular-nums">
                  {externalResult.route.durationMinutes}
                </span>
                <span className="text-sm text-neutral-500">min</span>
              </div>
              <div className="w-px h-6 bg-neutral-200" />
              <div className="flex items-center gap-1.5 text-neutral-900">
                <Footprints className="h-4 w-4 text-neutral-400" />
                <span className="text-lg font-semibold tabular-nums">{distLabel}</span>
              </div>
              {destinationDetail && (
                <>
                  <div className="w-px h-6 bg-neutral-200" />
                  <span
                    className={`text-sm font-medium ${
                      destinationDetail.shadowState === "sun" ? "text-amber-600" : "text-slate-500"
                    }`}
                  >
                    {destinationDetail.shadowState === "sun" ? "☀" : "☁"} {destinationDetail.stableFor}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Exit button */}
          <button
            onClick={onExitNavigation}
            className="shrink-0 w-10 h-10 rounded-full bg-neutral-100 hover:bg-neutral-200 flex items-center justify-center transition-colors"
            title="Exit navigation"
          >
            <X className="h-5 w-5 text-neutral-600" />
          </button>
        </div>

        {/* AI description */}
        {destinationDetail ? (
          <p className="mt-3 text-neutral-600 leading-relaxed italic text-sm">
            &ldquo;{destinationDetail.description}&rdquo;
          </p>
        ) : (
          <div className="mt-3 animate-pulse space-y-2">
            <div className="h-3 w-3/4 rounded bg-neutral-200" />
            <div className="h-3 w-1/2 rounded bg-neutral-200" />
          </div>
        )}

        {/* Try another */}
        <button
          onClick={handleSada}
          disabled={loading}
          className="mt-4 w-full flex items-center justify-center gap-2 rounded-xl border border-neutral-200 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {loading ? LOADING_MESSAGES[loadingIndex] : "Try another spot"}
        </button>
      </div>
    );
  }

  // ── Search mode ──
  return (
    <div className="mx-auto w-full max-w-lg rounded-t-3xl bg-white/90 backdrop-blur-xl p-6 pb-8 shadow-2xl">
      {/* Mad-libs sentence */}
      <p className="text-center text-lg text-neutral-700 leading-relaxed">
        I want to sit in the{" "}
        <ToggleButton
          active={light === "sun"}
          onClick={() => setLight("sun")}
          icon={<Sun className="h-4 w-4" />}
          label="Sun"
        />
        <ToggleButton
          active={light === "shade"}
          onClick={() => setLight("shade")}
          icon={<TreePine className="h-4 w-4" />}
          label="Shade"
        />{" "}
        at a{" "}
        <ToggleButton
          active={seat === "cafe"}
          onClick={() => setSeat("cafe")}
          icon={<Coffee className="h-4 w-4" />}
          label="Café"
        />
        <ToggleButton
          active={seat === "bench"}
          onClick={() => setSeat("bench")}
          icon={<Armchair className="h-4 w-4" />}
          label="Bench"
        />{" "}
        near me.
      </p>

      {/* CTA */}
      <button
        onClick={handleSada}
        disabled={loading || isNight}
        className={`mt-5 w-full rounded-2xl py-4 text-xl font-bold transition-transform disabled:scale-100 ${
          isNight
            ? "bg-neutral-300 text-neutral-500 cursor-not-allowed"
            : "bg-neutral-900 text-white hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60"
        }`}
      >
        {isNight ? "☾ The sun is down — come back tomorrow" : loading ? "SADA." : "SADA."}
      </button>

      {/* Loading state */}
      {loading && (
        <div className="mt-4 rounded-2xl bg-neutral-100 p-5 animate-pulse space-y-3">
          <div className="h-4 w-3/4 rounded bg-neutral-300" />
          <div className="h-4 w-1/2 rounded bg-neutral-300" />
          <p className="text-sm text-neutral-500 font-medium">{LOADING_MESSAGES[loadingIndex]}</p>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="mt-4 rounded-2xl bg-red-50 border border-red-200 p-4 flex items-start gap-3">
          <span className="text-red-500 text-lg shrink-0">⚠</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-red-700">{error}</p>
            <button
              onClick={handleSada}
              className="mt-2 text-sm font-medium text-red-600 hover:text-red-800 underline underline-offset-2"
            >
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`mx-0.5 inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium transition-colors ${
        active
          ? "bg-neutral-900 text-white"
          : "bg-transparent text-neutral-500 border border-neutral-300 hover:border-neutral-400"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
