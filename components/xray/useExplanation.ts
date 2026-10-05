"use client";

import { useEffect, useState } from "react";
import { type ExplainRequest, type Explanation, getProvider } from "@/lib/ai/provider";

/**
 * Returns the deterministic draft immediately, then swaps in a model's
 * wording if a provider is configured and its text passes the grounding check.
 */
export function useExplanation(request: ExplainRequest): Explanation {
  const [result, setResult] = useState<{ draft: string; explanation: Explanation } | null>(null);
  const { topic, draft } = request;
  const factsKey = request.facts.join("\n");

  useEffect(() => {
    let cancelled = false;
    getProvider()
      .then((provider) => provider.explain({ topic, draft, facts: factsKey ? factsKey.split("\n") : [] }))
      .then((explanation) => {
        if (!cancelled) setResult({ draft, explanation });
      });
    return () => {
      cancelled = true;
    };
  }, [topic, draft, factsKey]);

  return result?.draft === draft ? result.explanation : { text: draft, source: "templates", verified: false };
}

export function sourceLabel(e: Explanation): string {
  return e.verified ? `Wording by ${e.source} · figures verified against the analysis` : "Wording from templates over the analysis";
}
