import type { Finding } from "@/types/insights";
import { CAVEAT, causeStatement, detectionSentence } from "@/lib/insights/narrative";

/**
 * AI abstraction (Phase 5). A provider only ever *phrases* structured
 * analytical results — it is never asked for numbers. The default provider
 * is deterministic templates, so the product works without any LLM.
 */

export interface GroundedExplanation {
  text: string;
  /** Provider that produced the wording. */
  source: string;
}

export interface AIProvider {
  readonly name: string;
  explainFinding(finding: Finding): Promise<GroundedExplanation>;
}

export class TemplateProvider implements AIProvider {
  readonly name = "templates";
  async explainFinding(finding: Finding): Promise<GroundedExplanation> {
    return { text: `${detectionSentence(finding)} ${causeStatement(finding)} ${CAVEAT}`, source: this.name };
  }
}
