"use client";

import { canSimulate } from "@/lib/simulation/model";
import { useXray } from "@/store/useXray";
import { AskBar } from "./AskBar";
import { FindingsList } from "./FindingsList";
import { HealthScore } from "./HealthScore";

export function Overview() {
  const health = useXray((s) => s.health);
  const findings = useXray((s) => s.findings);
  const data = useXray((s) => s.data);
  if (!health) return null;
  return (
    <section className="stage-grid">
      <div className="reveal stage-col">
        <p className="label text-ink-2">Business scan complete</p>
        <div className="mt-8">
          <HealthScore health={health} />
        </div>
      </div>
      <div className="flex flex-col justify-end max-lg:order-last max-lg:pt-10">
        <AskBar />
      </div>
      <div className="stage-col">
        <FindingsList findings={findings} />
        {data && canSimulate(data) ? (
          <button type="button" className="command pointer-events-auto mt-4 self-start" onClick={() => useXray.getState().openWhatIf()}>
            What if? <span aria-hidden>→</span>
          </button>
        ) : (
          <p className="label mt-6 max-w-xs normal-case tracking-wider">
            Scenario simulation is unavailable: it needs cost, marketing, delivery and returns data.
          </p>
        )}
      </div>
    </section>
  );
}
