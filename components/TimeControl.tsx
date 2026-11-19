"use client";

import { useMemo } from "react";
import { Clock, X } from "lucide-react";
import { clockText } from "@/lib/describe";
import { daylight } from "@/lib/geo/sun";
import type { Sky } from "@/lib/sky";

export const EARLIEST_MINUTES = -12 * 60;
export const LATEST_MINUTES = 24 * 60;

interface TimeControlProps {
  now: Date;
  time: Date;
  offsetMinutes: number;
  phase: Sky["phase"];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (offsetMinutes: number) => void;
}

function offsetText(minutes: number): string {
  if (minutes === 0) return "now";
  const hours = Math.abs(minutes) / 60;
  const amount = Number.isInteger(hours) ? `${hours} h` : `${Math.floor(hours)} h ${Math.abs(minutes) % 60} min`;
  return minutes > 0 ? `in ${amount}` : `${amount} ago`;
}

/** A small clock that opens into a slider running from twelve hours back to a day ahead. */
export default function TimeControl({ now, time, offsetMinutes, phase, open, onOpenChange: setOpen, onChange }: TimeControlProps) {
  const marks = useMemo(() => {
    const span = LATEST_MINUTES - EARLIEST_MINUTES;
    const percent = (date: Date) => {
      const offset = (date.getTime() - now.getTime()) / 60000;
      return offset >= EARLIEST_MINUTES && offset <= LATEST_MINUTES ? ((offset - EARLIEST_MINUTES) / span) * 100 : null;
    };
    // Sunrise and sunset of the day the slider is on.
    const { sunrise, sunset } = daylight(time);
    return [
      { at: percent(sunrise), label: clockText(sunrise), color: "bg-amber-400", text: "text-amber-700" },
      { at: percent(sunset), label: clockText(sunset), color: "bg-orange-500", text: "text-orange-700" },
    ].filter((mark) => mark.at !== null);
  }, [now, time]);

  const label = phase === "night" ? "Night" : phase === "low" ? "Low sun" : "Daylight";

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="absolute top-4 left-4 z-10 flex h-11 items-center gap-2 rounded-full bg-white/95 px-4 shadow-lg"
        aria-label="Change the time"
      >
        <Clock className="h-4 w-4 text-neutral-500" />
        <span className="text-base font-semibold text-neutral-900 tabular-nums" data-testid="clock">{clockText(time)}</span>
        <span className="text-sm text-neutral-500">{offsetText(offsetMinutes)}</span>
      </button>
    );
  }

  return (
    <div className="absolute top-4 left-4 right-4 z-10 mx-auto max-w-md rounded-2xl bg-white/95 px-4 pt-3 pb-4 shadow-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-semibold text-neutral-900 tabular-nums" data-testid="clock">{clockText(time)}</span>
          <span className="text-sm text-neutral-500">{offsetText(offsetMinutes)}, {label.toLowerCase()}</span>
        </div>
        <button onClick={() => setOpen(false)} aria-label="Close the time control" className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-neutral-100">
          <X className="h-5 w-5 text-neutral-600" />
        </button>
      </div>

      <div className="relative mt-1 h-11 flex items-center">
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-neutral-200 pointer-events-none" />
        {marks.map((mark) => (
          <div key={mark.label} className="absolute top-1 pointer-events-none flex flex-col items-center" style={{ left: `${mark.at}%`, transform: "translateX(-50%)" }}>
            <div className={`w-0.5 h-5 ${mark.color}`} />
            <span className={`mt-3 text-xs font-medium whitespace-nowrap ${mark.text}`}>{mark.label}</span>
          </div>
        ))}
        <input
          type="range"
          aria-label="Time of day"
          min={EARLIEST_MINUTES}
          max={LATEST_MINUTES}
          step={5}
          value={offsetMinutes}
          onChange={(event) => onChange(Number(event.target.value))}
          className="relative z-10 w-full h-11 appearance-none cursor-pointer accent-blue-600 bg-transparent"
        />
      </div>

      <div className="mt-4 flex justify-center">
        <button onClick={() => onChange(0)} disabled={offsetMinutes === 0} className="h-11 px-4 text-sm font-medium text-blue-700 disabled:text-neutral-400">
          Back to now
        </button>
      </div>
    </div>
  );
}
