"use client";

import { useIngest } from "@/store/useIngest";
import { useXray } from "@/store/useXray";

/** Two ways in: the demo business, or the user's own data. */
export function Landing() {
  const data = useXray((s) => s.data);
  const { startScan, loadDemo } = useXray.getState();
  // Always enters at the first step; files added earlier are still listed there.
  const connect = () => {
    useIngest.getState().go("connect");
    useXray.getState().connect();
  };
  const uploaded = !!data?.available;
  return (
    <section className="reveal flex h-full flex-col items-center justify-center px-[var(--gutter)] text-center">
      <p className="label">{uploaded ? `${data.company} — your uploaded data` : "Demo business: NOVA — international e-commerce retailer"}</p>
      <h1 className="display mt-7 whitespace-nowrap text-[clamp(2.2rem,10.5vw,10.5rem)]">
        Business
        <span className="text-ink-3"> / </span>
        X-Ray
      </h1>
      <p className="mt-7 max-w-md text-[clamp(1rem,1.5vw,1.3rem)] leading-snug tracking-tight text-ink-2">
        See what is really happening inside a business.
      </p>
      <div className="pointer-events-auto mt-10 flex flex-col items-center gap-x-12 sm:flex-row">
        {uploaded ? (
          <>
            <button type="button" className="command" onClick={() => void startScan()} autoFocus>
              Scan my business again
            </button>
            <button type="button" className="command" data-quiet="true" onClick={connect}>
              Upload different data
            </button>
            <button type="button" className="command" data-quiet="true" onClick={loadDemo}>
              Explore demo business
            </button>
          </>
        ) : (
          <>
            <button type="button" className="command" onClick={loadDemo} disabled={!data} autoFocus>
              {data ? "Explore demo business" : "Loading data"}
            </button>
            <button type="button" className="command" onClick={connect}>
              Analyze my business
            </button>
          </>
        )}
      </div>
    </section>
  );
}
