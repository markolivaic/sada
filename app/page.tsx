"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const SUBTITLE = "The sun is out on Bogovićeva. Johann Franck has a free terrace.";

export default function Home() {
  const [titleVisible, setTitleVisible] = useState(false);
  const [typedCount, setTypedCount] = useState(0);
  const [ctaVisible, setCtaVisible] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setTitleVisible(true), 100);
    const t2 = setTimeout(() => {
      let i = 0;
      const interval = setInterval(() => {
        i++;
        setTypedCount(i);
        if (i >= SUBTITLE.length) {
          clearInterval(interval);
          setTimeout(() => setCtaVisible(true), 400);
        }
      }, 35);
      return () => clearInterval(interval);
    }, 900);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-[#0a0a0a] px-6 overflow-hidden">
      {/* Title */}
      <h1
        className={`text-white font-black tracking-tighter leading-[0.85] select-none transition-opacity duration-[800ms] ease-out ${
          titleVisible ? "opacity-100" : "opacity-0"
        }`}
        style={{ fontSize: "clamp(5rem, 20vw, 22rem)" }}
      >
        Sada.
      </h1>

      {/* Live subtitle */}
      <div className="mt-6 h-8 sm:h-10 flex items-center justify-center">
        <p className="text-amber-400 text-base sm:text-xl font-light tracking-wide text-center">
          {SUBTITLE.slice(0, typedCount)}
          {typedCount < SUBTITLE.length && (
            <span className="inline-block w-[2px] h-[1.1em] bg-amber-400 ml-0.5 align-middle animate-[blink_1s_step-end_infinite]" />
          )}
        </p>
      </div>

      {/* CTA */}
      <div
        className={`mt-12 transition-all duration-700 ease-out ${
          ctaVisible
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-4"
        }`}
      >
        <Link
          href="/map"
          className="group inline-flex items-center gap-2 rounded-full border border-neutral-700 px-8 py-4 text-base font-medium text-neutral-200 transition-all hover:border-neutral-500 hover:text-white hover:bg-white/[0.04] active:scale-[0.97]"
        >
          Take me somewhere good
          <span className="inline-block transition-transform group-hover:translate-x-1">→</span>
        </Link>
      </div>

      {/* Footer */}
      <p className="absolute bottom-8 text-[13px] text-neutral-600 tracking-widest uppercase">
        Zagreb · Real shadow data · Right now
      </p>

      {/* Blink keyframe */}
      <style>{`@keyframes blink { 0%, 100% { opacity: 1 } 50% { opacity: 0 } }`}</style>
    </div>
  );
}
