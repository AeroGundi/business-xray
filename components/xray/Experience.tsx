"use client";

import { useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "motion/react";
import { SCAN_STAGES } from "@/lib/engine/scan";
import { METRICS } from "@/lib/analytics/metrics";
import { formatChange } from "@/lib/format";
import { causeStatement, headline } from "@/lib/insights/narrative";
import type { ViewSpec } from "@/lib/visualization/layout";
import { buildParticles } from "@/lib/visualization/particles";
import { investigationView, overviewView } from "@/lib/visualization/view";
import { activeFinding, useXray } from "@/store/useXray";
import { AnswerView } from "./AnswerView";
import { Chrome } from "./Chrome";
import { Investigation } from "./Investigation";
import { Landing } from "./Landing";
import { Overview } from "./Overview";
import { ScanReadout } from "./ScanReadout";

const Scene = dynamic(() => import("@/components/visualization/Scene"), { ssr: false });

const DORMANT: ViewSpec = { mode: "dormant" };
const TONE_VAR = { risk: "var(--risk)", attention: "var(--attention)", positive: "var(--positive)" };

export function Experience() {
  const data = useXray((s) => s.data);
  const phase = useXray((s) => s.phase);
  const scanIndex = useXray((s) => s.scanIndex);
  const findings = useXray((s) => s.findings);
  const hoverId = useXray((s) => s.hoverId);
  const stage = useXray((s) => s.stage);
  const reducedMotion = useXray((s) => s.reducedMotion);
  const finding = useXray(activeFinding);
  const answer = useXray((s) => s.answer);

  useEffect(() => {
    const store = useXray.getState();
    store.setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    store.init();
  }, []);

  const particles = useMemo(() => {
    if (!data) return null;
    const compact = typeof window !== "undefined" && window.innerWidth < 768;
    return buildParticles(data, compact ? 6000 : 14000);
  }, [data]);

  const scanDim = SCAN_STAGES[scanIndex].dim;
  const spec: ViewSpec = useMemo(() => {
    if (phase === "scanning") return { mode: "cluster", scope: {}, dim: scanDim, hue: 0 };
    if (phase === "overview" && particles) return overviewView(findings, findings.find((f) => f.id === hoverId) ?? null, particles);
    if (phase === "answer" && answer && particles) return answer.view ?? overviewView(findings, null, particles);
    if (phase === "investigating" && finding) return investigationView(finding, stage);
    return DORMANT;
  }, [phase, scanDim, findings, hoverId, finding, stage, particles, answer]);

  // Text equivalent of the current view for assistive technology.
  const summary = useMemo(() => {
    if (phase === "landing") return "Business X-Ray. Ready to scan NOVA.";
    if (phase === "scanning") return `Scanning ${SCAN_STAGES[scanIndex].label}.`;
    if (phase === "overview") {
      return `Scan complete. ${findings.length} findings: ${findings.map((f) => `${headline(f)} ${formatChange(f.effect.change, f.effect.changePct, METRICS[f.metric].unit)}`).join("; ")}.`;
    }
    if (phase === "answer" && answer) return `${answer.question} ${answer.interpretation}. ${answer.explanation}`;
    return finding ? `${headline(finding)}. ${causeStatement(finding)}` : "";
  }, [phase, scanIndex, findings, finding, answer]);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-bg text-ink" data-reduced-motion={reducedMotion}>
      <div className="absolute inset-0">
        {particles && (
          <Scene
            set={particles} spec={spec} centered={phase === "landing"} scanning={phase === "scanning"}
            reducedMotion={reducedMotion} tone={finding ? TONE_VAR[finding.tone] : undefined}
          />
        )}
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse at center, transparent 45%, rgba(6,7,10,0.85) 100%)" }} />

      <Chrome />

      <AnimatePresence mode="wait">
        <motion.div
          key={phase === "investigating" ? `investigating-${finding?.id}-${finding?.question ?? ""}` : phase}
          className="pointer-events-none absolute inset-0 z-10"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.55, ease: [0.22, 1, 0.36, 1] }}
        >
          {phase === "landing" && <Landing />}
          {phase === "scanning" && <ScanReadout />}
          {phase === "overview" && <Overview />}
          {phase === "answer" && answer && <AnswerView answer={answer} />}
          {phase === "investigating" && finding && <Investigation finding={finding} />}
        </motion.div>
      </AnimatePresence>

      <p className="sr-only" aria-live="polite">{summary}</p>
    </main>
  );
}
