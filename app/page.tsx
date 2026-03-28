import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-950 text-white px-6">
      <div className="flex flex-col items-center gap-6 text-center max-w-xl">
        <h1 className="text-8xl font-bold tracking-tight sm:text-9xl">
          Sada.
        </h1>
        <p className="text-lg text-neutral-400 leading-relaxed sm:text-xl">
          Every other map tells you where things are.
          <br />
          Sada tells you where to <span className="text-white font-medium">be</span>.
        </p>
        <Link
          href="/map"
          className="mt-4 rounded-full bg-white px-8 py-4 text-lg font-semibold text-black transition-transform hover:scale-105 active:scale-95"
        >
          Take me somewhere good
        </Link>
      </div>
    </div>
  );
}
