"use client";

import { useState, useEffect, useRef } from "react";
import { Sun, TreePine, Coffee, Armchair, Clock } from "lucide-react";

type LightPref = "sun" | "shade";
type SeatPref = "cafe" | "bench";

const LOADING_MESSAGES = [
  "Reading the shadows...",
  "Calculating sun angle...",
  "Scanning Zagreb...",
  "Finding your spot...",
];

interface SadaResult {
  destination: { lat: number; lng: number };
  walkingDuration: string;
  narration: string;
}

export default function SadaUI({ onResult }: { onResult?: (data: SadaResult) => void }) {
  const [light, setLight] = useState<LightPref>("sun");
  const [seat, setSeat] = useState<SeatPref>("cafe");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SadaResult | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [loadingIndex, setLoadingIndex] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setExcluded([]);
  }, [light, seat]);

  useEffect(() => {
    if (loading) {
      setLoadingIndex(0);
      intervalRef.current = setInterval(() => {
        setLoadingIndex(prev =>
          prev < LOADING_MESSAGES.length - 1 ? prev + 1 : prev
        );
      }, 900);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setLoadingIndex(0);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [loading]);

  const handleSada = async () => {
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/sada", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ light, seat, exclude: excluded }),
      });
      const data: SadaResult = await res.json();
      setResult(data);
      onResult?.(data);
      setExcluded(prev => [...prev, `${data.destination.lat},${data.destination.lng}`]);
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
      {loading ? (
        <div className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-neutral-900 py-4">
          <span className="h-2 w-2 rounded-full bg-white/60 animate-pulse" />
          <span className="text-sm italic text-white/60">
            {LOADING_MESSAGES[loadingIndex]}
          </span>
        </div>
      ) : (
        <button
          onClick={handleSada}
          className="mt-5 w-full rounded-2xl bg-neutral-900 py-4 text-xl font-bold text-white transition-transform hover:scale-[1.02] active:scale-[0.98]"
        >
          SADA.
        </button>
      )}

      {/* Result card */}
      {result && !loading && (
        <div className="mt-4 animate-[slideUp_0.4s_ease-out] rounded-2xl bg-black/80 backdrop-blur-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-sm text-white">
              <Clock className="h-3.5 w-3.5" />
              {result.walkingDuration} walk
            </span>
            <button
              onClick={handleSada}
              className="text-sm text-white/60 hover:text-white transition-colors"
            >
              🎲 Try another
            </button>
          </div>

          <p className="text-white text-base leading-relaxed">
            {result.narration}
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
