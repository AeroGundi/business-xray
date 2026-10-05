import type { Dataset } from "@/types/domain";
import type { Driver, Finding } from "@/types/insights";
import { METRICS, type Metric, type MetricId } from "@/lib/analytics/metrics";
import { driverCandidates, isSupported, testDrivers } from "@/lib/root-cause/investigate";
import { scopePhrase } from "./narrative";

/**
 * Hypothesis generation and testing. A hypothesis proposes that one
 * operational metric moved together with the anomaly in the final segment;
 * testing it runs the same statistical test the root-cause stage uses.
 */

export interface Hypothesis {
  metric: MetricId;
  statement: string;
}

export interface HypothesisResult {
  supported: boolean;
  driver: Driver;
}

/** Candidates the root-cause stage did not already report as supporting evidence. */
export function openHypotheses(finding: Finding, data: Dataset): Hypothesis[] {
  const target: Metric = METRICS[finding.metric];
  const reported = new Set(finding.investigation.drivers.map((d) => d.metric));
  const where = scopePhrase(finding.investigation.leafScope);
  return driverCandidates(target, data)
    .filter((id) => !reported.has(id))
    .map((id) => ({ metric: id, statement: `A change in ${METRICS[id].noun} may be contributing to the move in ${target.noun} for ${where}.` }));
}

export function testHypothesis(data: Dataset, finding: Finding, metric: MetricId): HypothesisResult {
  const [driver] = testDrivers(data, METRICS[finding.metric], finding.investigation.leafScope, finding.comparison, [metric]);
  return { supported: isSupported(driver), driver };
}
