"use client";

import { useXray } from "@/store/useXray";
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
      <div aria-hidden className="max-lg:hidden" />
      <div className="stage-col">
        <FindingsList findings={findings} />
      </div>
    </section>
  );
}
