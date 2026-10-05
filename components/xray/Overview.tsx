"use client";

import { useXray } from "@/store/useXray";
import { AskBar } from "./AskBar";
import { FindingsList } from "./FindingsList";
import { HealthScore } from "./HealthScore";

export function Overview() {
  const health = useXray((s) => s.health);
  const findings = useXray((s) => s.findings);
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
      </div>
    </section>
  );
}
