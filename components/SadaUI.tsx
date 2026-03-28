"use client";

import { useState } from "react";
import { Sun, TreePine, Coffee, Armchair, MapPin, Clock } from "lucide-react";

type LightPref = "sun" | "shade";
type SeatPref = "cafe" | "bench";

interface SadaResult {
  destination: { lat: number; lng: number };
  walkingDuration: string;
  narration: string;
}

export default function SadaUI() {
  const [light, setLight] = useState<LightPref>("sun");
  const [seat, setSeat] = useState<SeatPref>("cafe");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SadaResult | null>(null);

  const handleSada = async () => {
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/sada", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ light, seat }),
      });
      const data: SadaResult = await res.json();
      setResult(data);
    } catch {
      // TODO: surface error to user
    } finally {
      setLoading(false);
    }
  };

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
        disabled={loading}
        className="mt-5 w-full rounded-2xl bg-neutral-900 py-4 text-xl font-bold text-white transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60"
      >
        {loading ? "Calculating…" : "SADA."}
      </button>

      {/* Loading skeleton */}
      {loading && (
        <div className="mt-4 animate-pulse space-y-3 rounded-2xl bg-neutral-100 p-5">
          <div className="h-4 w-3/4 rounded bg-neutral-300" />
          <div className="h-4 w-1/2 rounded bg-neutral-300" />
          <p className="text-sm text-neutral-400">Calculating physics…</p>
        </div>
      )}

      {/* Result card */}
      {result && !loading && (
        <div className="mt-4 space-y-3 rounded-2xl bg-neutral-50 border border-neutral-200 p-5">
          <div className="flex items-center gap-2 text-neutral-900 font-semibold">
            <MapPin className="h-5 w-5 text-rose-500" />
            <span>
              {result.destination.lat.toFixed(4)}, {result.destination.lng.toFixed(4)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm text-neutral-500">
            <Clock className="h-4 w-4" />
            <span>{result.walkingDuration} walk</span>
          </div>
          <p className="text-neutral-700 leading-relaxed italic">
            &ldquo;{result.narration}&rdquo;
          </p>
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
