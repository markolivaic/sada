"use client";

import { Armchair, Coffee, Moon, RefreshCw, Sun, TreePine, X } from "lucide-react";
import { SEAT_OFFSET_M } from "@/lib/geo/seat";
import type { Scored } from "@/lib/pick";
import type { Category } from "@/lib/places";

type Want = "sun" | "shade";

interface SadaUIProps {
  status: "loading" | "failed" | "ready";
  night: boolean;
  category: Category;
  want: Want | null;
  /** True while the answer to the current question has not come back yet. */
  pending: boolean;
  pick: Scored | null;
  headline: string | null;
  /** The line under the headline. Null while the walking route is still being fetched. */
  detail: string | null;
  /** How many places of the asked kind are in the asked light right now. */
  matching: number;
  originNote: string | null;
  onCategory: (category: Category) => void;
  onWant: (want: Want) => void;
  onAnother: () => void;
  onStartOver: () => void;
  onClear: () => void;
  onTomorrow: () => void;
}

const PLURAL: Record<Category, string> = { cafe: "cafés", bench: "benches" };
const SHEET = "mx-auto w-full max-w-lg rounded-t-3xl bg-white/95 backdrop-blur-xl px-5 pt-5 pb-6 shadow-2xl";

export default function SadaUI(props: SadaUIProps) {
  const { status, night, category, want, pending, pick, headline, detail, matching, originNote } = props;

  if (want && pick && !night) {
    const other: Want = want === "sun" ? "shade" : "sun";
    return (
      <div className={SHEET} data-testid="pick">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-neutral-500 truncate" data-testid="pick-name">{pick.place.name}</p>
            <p className={`mt-0.5 text-2xl font-bold leading-tight ${pick.hold.light === "sun" ? "text-amber-600" : "text-slate-700"}`} data-testid="pick-headline">
              {headline}
            </p>
            {detail ? (
              <p className="mt-1 text-base text-neutral-700" data-testid="pick-detail">{detail}</p>
            ) : (
              <div className="mt-2 h-4 w-2/3 rounded bg-neutral-200 animate-pulse" />
            )}
          </div>
          <button onClick={props.onClear} className="shrink-0 w-11 h-11 rounded-full bg-neutral-100 hover:bg-neutral-200 flex items-center justify-center" aria-label="Close">
            <X className="h-5 w-5 text-neutral-600" />
          </button>
        </div>

        {pick.place.moved && (
          <p className="mt-2 text-xs text-neutral-500">Judged {SEAT_OFFSET_M} m outside its nearest open wall. Where the tables really stand is not mapped.</p>
        )}
        {originNote && <p className="mt-1 text-xs text-neutral-500">{originNote}</p>}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <button onClick={props.onAnother} className="h-12 flex items-center justify-center gap-2 rounded-xl border border-neutral-300 text-sm font-medium text-neutral-800 hover:bg-neutral-50">
            <RefreshCw className="h-4 w-4" />
            Another one
          </button>
          <button onClick={() => props.onWant(other)} className="h-12 flex items-center justify-center gap-2 rounded-xl border border-neutral-300 text-sm font-medium text-neutral-800 hover:bg-neutral-50">
            {other === "sun" ? <Sun className="h-4 w-4" /> : <TreePine className="h-4 w-4" />}
            {other === "sun" ? "Sun instead" : "Shade instead"}
          </button>
        </div>
        <Legend />
      </div>
    );
  }

  const message =
    status === "failed"
      ? "The building data did not load, so there is nothing to answer from. Reload the page to try again."
      : want && !night && !pending
        ? matching === 0
          ? `No ${PLURAL[category]} in the ${want} at this hour. Try the other light, or the other kind of seat.`
          : `Those were all the ${PLURAL[category]} in the ${want}.`
        : null;

  return (
    <div className={SHEET}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-base font-medium text-neutral-800">Where to sit?</p>
        <div className="flex rounded-full bg-neutral-100 p-1" role="group" aria-label="Kind of seat">
          <SeatButton active={category === "cafe"} onClick={() => props.onCategory("cafe")} icon={<Coffee className="h-4 w-4" />} label="Café" />
          <SeatButton active={category === "bench"} onClick={() => props.onCategory("bench")} icon={<Armchair className="h-4 w-4" />} label="Bench" />
        </div>
      </div>

      {night ? (
        <div className="mt-4 rounded-2xl bg-slate-800 p-4 text-white">
          <p className="flex items-center gap-2 text-base font-medium">
            <Moon className="h-4 w-4" /> The sun is down.
          </p>
          <button onClick={props.onTomorrow} className="mt-3 h-12 w-full rounded-xl bg-white text-sm font-semibold text-slate-900">
            See tomorrow at 9:00
          </button>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            onClick={() => props.onWant("sun")}
            disabled={status !== "ready"}
            className="h-16 flex items-center justify-center gap-2 rounded-2xl bg-amber-400 text-lg font-bold text-neutral-900 active:scale-[0.98] disabled:opacity-50"
          >
            <Sun className="h-5 w-5" />
            Sun
          </button>
          <button
            onClick={() => props.onWant("shade")}
            disabled={status !== "ready"}
            className="h-16 flex items-center justify-center gap-2 rounded-2xl bg-slate-700 text-lg font-bold text-white active:scale-[0.98] disabled:opacity-50"
          >
            <TreePine className="h-5 w-5" />
            Shade
          </button>
        </div>
      )}

      {status === "loading" && <p className="mt-3 text-sm text-neutral-500">Loading the buildings.</p>}
      {message && (
        <div className="mt-3 rounded-2xl bg-neutral-100 p-4 text-sm text-neutral-800" data-testid="message">
          <p>{message}</p>
          {want && matching > 0 && (
            <button onClick={props.onStartOver} className="mt-1 h-11 font-medium underline underline-offset-2">
              Start again from the nearest
            </button>
          )}
        </div>
      )}
      {originNote && !night && <p className="mt-3 text-xs text-neutral-500" data-testid="origin-note">{originNote}</p>}
      {!night && <Legend />}
    </div>
  );
}

/** What the dots on the map mean. Shape as well as colour, so it reads without colour vision. */
function Legend() {
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-600">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-full bg-amber-500" /> in sun
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-full border-[2.5px] border-slate-700 bg-white" /> in shade
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-slate-300" /> sun too low to tell
      </span>
    </p>
  );
}

function SeatButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors ${active ? "bg-neutral-900 text-white" : "text-neutral-600"}`}
    >
      {icon}
      {label}
    </button>
  );
}
