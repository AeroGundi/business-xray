"use client";

import { useXray } from "@/store/useXray";

export function Landing() {
  const ready = useXray((s) => s.data !== null);
  const startScan = useXray((s) => s.startScan);
  return (
    <section className="reveal flex h-full flex-col items-center justify-center px-[var(--gutter)] text-center">
      <p className="label">NOVA — International e-commerce retailer</p>
      <h1 className="display mt-7 whitespace-nowrap text-[clamp(2.2rem,10.5vw,10.5rem)]">
        Business
        <span className="text-ink-3"> / </span>
        X-Ray
      </h1>
      <p className="mt-7 max-w-md text-[clamp(1rem,1.5vw,1.3rem)] leading-snug tracking-tight text-ink-2">
        See what is really happening inside a business.
      </p>
      <button type="button" className="command pointer-events-auto mt-12" onClick={() => void startScan()} disabled={!ready} autoFocus>
        {ready ? "Scan business" : "Loading data"}
      </button>
    </section>
  );
}
