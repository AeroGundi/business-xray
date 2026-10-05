import type { ExplainRequest } from "@/lib/ai/provider";

/** Server-side seam between the product and a model vendor. */
export interface TextModel {
  readonly name: string;
  rewrite(request: ExplainRequest): Promise<string | null>;
}

export const SYSTEM_PROMPT = `You rewrite analytical findings for a business executive.

You are given a DRAFT explanation that is already correct, and the FACTS it was built from. Rewrite the draft so it reads naturally and leads with what matters.

The analysis is observational, so the causal claims in the draft are deliberately hedged ("associated with", "likely contributor", "evidence suggests"). Keep that level of caution: do not turn an association into a cause.

Every figure you write must appear in the FACTS or the DRAFT exactly as written there. Do not calculate, round, combine or estimate figures, and do not add figures of your own, including counts and time spans. Your text is checked automatically and is discarded if it contains a figure that is not in the input.

Write plain prose, at most three sentences, with no headings, lists or markdown.`;

export function userPrompt(r: ExplainRequest): string {
  return `TOPIC\n${r.topic}\n\nDRAFT\n${r.draft}\n\nFACTS\n${r.facts.map((f) => `- ${f}`).join("\n")}`;
}
