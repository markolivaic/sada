"use client";

/** The name over black while the buildings load. It fades away and never needs a tap. */
export default function Splash({ done }: { done: boolean }) {
  return (
    <div
      aria-hidden={done}
      className={`absolute inset-0 z-30 flex items-center justify-center bg-black transition-opacity duration-500 ${done ? "pointer-events-none opacity-0" : "opacity-100"}`}
    >
      <p className="select-none font-black tracking-tighter text-white" style={{ fontSize: "clamp(5rem, 20vw, 16rem)" }}>
        Sada.
      </p>
    </div>
  );
}
