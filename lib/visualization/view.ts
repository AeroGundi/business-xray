import type { Finding, Tone } from "@/types/insights";
import { METRICS, type DimKey, type Metric, type Scope, inScope } from "@/lib/analytics/metrics";
import type { Split } from "@/lib/analytics/compare";
import { formatChange } from "@/lib/format";
import { HUE, type ViewSpec } from "./layout";
import type { ParticleSet } from "./particles";

/** Maps the state of the experience to what the visualization should show. */

export type StageKind = "metric" | "segment" | "cause" | "impact";

export interface Stage {
  kind: StageKind;
  /** Index into investigation.steps for segment stages. */
  step?: number;
}

export function stagesOf(finding: Finding): Stage[] {
  return [
    { kind: "metric" },
    ...finding.investigation.steps.map((_, i): Stage => ({ kind: "segment", step: i })),
    { kind: "cause" },
    { kind: "impact" },
  ];
}

export const hueOf = (tone: Tone): number => HUE[tone];

const FALLBACK_DIMS: DimKey[] = ["country", "category", "segment", "channel"];

function notesOf(metric: Metric, split: Split): Record<string, string> {
  return Object.fromEntries(split.members.map((m) => [m.member, formatChange(m.change, m.changePct, metric.unit)]));
}

/** Findings spread across more of the business than this are located on hover only, to keep the default view legible. */
export const OVERVIEW_MAX_COVERAGE = 0.15;

export function overviewView(findings: Finding[], focus: Finding | null, particles: ParticleSet): ViewSpec {
  const localised = (f: Finding) => {
    let n = 0;
    for (const row of particles.rows) if (inScope(row, f.investigation.leafScope)) n++;
    return n / particles.count <= OVERVIEW_MAX_COVERAGE;
  };
  const shown = focus ? [focus] : findings.filter(localised);
  // Narrowest scope first, so a specific finding is not painted over by a broad one.
  const marks = shown
    .map((f) => ({ scope: f.investigation.leafScope, hue: hueOf(f.tone) }))
    .sort((a, b) => Object.keys(b.scope).length - Object.keys(a.scope).length);
  return { mode: "cluster", scope: {}, dim: "country", hue: 0, marks };
}

export function investigationView(finding: Finding, stageIndex: number): ViewSpec {
  const metric: Metric = METRICS[finding.metric];
  const inv = finding.investigation;
  const hue = hueOf(finding.tone);
  const stages = stagesOf(finding);
  const stage = stages[Math.min(stageIndex, stages.length - 1)];
  const peers = finding.comparison.kind === "peers" ? finding.comparison.peerDim : null;

  const segmentView = (i: number): ViewSpec => {
    const step = inv.steps[i];
    return { mode: "cluster", scope: step.parentScope, dim: step.dim, hue, highlight: step.member, notes: notesOf(metric, step.split) };
  };

  const rootView = (): ViewSpec => {
    if (peers) {
      // A peer comparison is read against the other members, so they stay visible.
      const scope: Scope = { ...finding.scope };
      delete scope[peers];
      return { mode: "cluster", scope, dim: peers, hue, highlight: finding.scope[peers] };
    }
    const first = inv.steps[0];
    if (!first) {
      const dim = FALLBACK_DIMS.find((d) => !(d in finding.scope)) ?? "country";
      return { mode: "cluster", scope: finding.scope, dim, hue };
    }
    const heat = Object.fromEntries(first.split.members.map((m) => [m.member, Math.pow(Math.min(1, Math.max(0, m.share)), 0.7)]));
    return { mode: "cluster", scope: finding.scope, dim: first.dim, hue, heat, notes: notesOf(metric, first.split) };
  };

  switch (stage.kind) {
    case "metric":
      return rootView();
    case "segment":
      return segmentView(stage.step!);
    case "cause": {
      const lead = inv.drivers[0];
      if (finding.comparison.kind === "time" && metric.source === "orders" && lead && METRICS[lead.metric].source === "orders") {
        return { mode: "timeline", scope: inv.leafScope, metric: lead.metric, hue };
      }
      return inv.steps.length ? segmentView(inv.steps.length - 1) : rootView();
    }
    case "impact":
      return { mode: "cluster", scope: {}, dim: "country", hue, marks: [{ scope: inv.leafScope, hue }] };
  }
}

/** The business under a simulated scenario: order volume and profit direction relative to today. */
export function whatIfView(ordersRatio: number, profitChange: number, resolved: Finding | null): ViewSpec {
  // Quantised so that dragging a slider retargets the particles in visible steps only.
  const volume = Math.round(Math.min(2, Math.max(0.2, ordersRatio)) * 50) / 50;
  const tint = Math.round(Math.min(0.7, Math.abs(profitChange) * 3) * 20) / 20;
  return {
    mode: "cluster", scope: {}, dim: "country", hue: profitChange >= 0 ? HUE.positive : HUE.risk, volume, tint,
    marks: resolved ? [{ scope: resolved.investigation.leafScope, hue: HUE.positive }] : undefined,
  };
}
