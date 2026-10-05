"use client";

import { useEffect, useRef } from "react";
import { useIngest } from "@/store/useIngest";
import { ConnectStart } from "./ConnectStart";
import { DataReadiness } from "./DataReadiness";
import { Processing } from "./Processing";
import { ReadyToScan } from "./ReadyToScan";
import { SchemaMapping } from "./SchemaMapping";
import { TemplateGuide } from "./TemplateGuide";
import { ValidationResults } from "./ValidationResults";

/**
 * The ingestion flow: MY DATA → BUSINESS X-RAY.
 * One screen per decision the user has to make; everything else stays hidden.
 */
export function Connect() {
  const step = useIngest((s) => s.step);
  const scroller = useRef<HTMLElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [step]);

  return (
    <section ref={scroller} className="ingest" aria-label="Connect your data">
      <div key={step} className="min-h-full">
        {step === "connect" && <ConnectStart />}
        {step === "template" && <TemplateGuide />}
        {step === "processing" && <Processing />}
        {step === "mapping" && <SchemaMapping />}
        {step === "validation" && <ValidationResults />}
        {step === "readiness" && <DataReadiness />}
        {step === "ready" && <ReadyToScan />}
      </div>
      {(step === "connect" || step === "ready") && (
        <p className="ingest-col label mt-14 max-w-3xl normal-case leading-relaxed tracking-wider">
          Your files are read and analysed in this browser; they are not uploaded or stored. If AI-worded explanations are enabled on this deployment, the computed summary of a finding (its figures and segment names, never your rows) is sent to a language model to be rephrased.
        </p>
      )}
    </section>
  );
}
