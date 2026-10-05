import { checkGrounding } from "./grounding";

/**
 * AI abstraction. A provider only ever *phrases* structured analytical
 * results: it receives a deterministic draft plus the facts behind it, and
 * returns wording. It is never asked for a number, and any figure it
 * introduces fails the grounding check and is discarded.
 */

export interface ExplainRequest {
  /** What is being explained, for the model's context. */
  topic: string;
  /** Deterministic, template-built explanation. Always a valid answer on its own. */
  draft: string;
  /** Every formatted figure and label the explanation may use. */
  facts: string[];
}

export interface Explanation {
  text: string;
  /** "templates" or the model that produced the wording. */
  source: string;
  /** True when a model's wording was verified against the facts. */
  verified: boolean;
}

export interface AIProvider {
  readonly name: string;
  explain(request: ExplainRequest): Promise<Explanation>;
}

export class TemplateProvider implements AIProvider {
  readonly name = "templates";
  async explain(request: ExplainRequest): Promise<Explanation> {
    return { text: request.draft, source: this.name, verified: false };
  }
}

/** Delegates wording to the server route, which hides the model vendor behind `TextModel`. */
export class RemoteProvider implements AIProvider {
  readonly name = "remote";
  private readonly fallback = new TemplateProvider();
  constructor(private readonly endpoint = "/api/explain") {}

  async explain(request: ExplainRequest): Promise<Explanation> {
    try {
      const res = await fetch(this.endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
      if (!res.ok) return this.fallback.explain(request);
      const { text, model } = (await res.json()) as { text: string; model: string };
      // The server checks too; the client re-checks so the guarantee does not depend on the network path.
      if (!text || !checkGrounding(text, [request.draft, ...request.facts]).grounded) return this.fallback.explain(request);
      return { text, source: model, verified: true };
    } catch {
      return this.fallback.explain(request);
    }
  }
}

let provider: Promise<AIProvider> | null = null;

/** Resolves once per session: the remote provider if the server has a model configured, templates otherwise. */
export function getProvider(): Promise<AIProvider> {
  provider ??= fetch("/api/explain")
    .then((r) => (r.ok ? (r.json() as Promise<{ enabled: boolean }>) : { enabled: false }))
    .then((s): AIProvider => (s.enabled ? new RemoteProvider() : new TemplateProvider()))
    .catch((): AIProvider => new TemplateProvider());
  return provider;
}
