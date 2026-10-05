import { checkGrounding } from "@/lib/ai/grounding";
import type { ExplainRequest } from "@/lib/ai/provider";
import { AnthropicModel } from "@/lib/ai/server/anthropic";
import type { TextModel } from "@/lib/ai/server/model";

/**
 * Rewrites a deterministic explanation with a language model.
 * Vendor selection is the only place a provider is named; add a case to
 * support another one.
 */
function resolveModel(): TextModel | null {
  const vendor = process.env.AI_PROVIDER ?? "anthropic";
  if (vendor === "anthropic" && (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)) return new AnthropicModel();
  return null;
}

export async function GET() {
  const model = resolveModel();
  return Response.json({ enabled: model !== null, model: model?.name ?? null });
}

export async function POST(request: Request) {
  const model = resolveModel();
  if (!model) return Response.json({ error: "No language model is configured." }, { status: 503 });

  const body = (await request.json()) as Partial<ExplainRequest>;
  if (typeof body.draft !== "string" || typeof body.topic !== "string" || !Array.isArray(body.facts)) {
    return Response.json({ error: "Expected { topic, draft, facts }." }, { status: 400 });
  }
  const req: ExplainRequest = { topic: body.topic, draft: body.draft, facts: body.facts.map(String) };
  // Oversized input is rejected rather than truncated, so the model never sees a partial set of facts.
  if (req.topic.length > 500 || req.draft.length > 4000 || req.facts.length > 200) {
    return Response.json({ error: "Request too large." }, { status: 413 });
  }

  const text = await model.rewrite(req);
  if (!text) return Response.json({ error: "The model returned no usable text." }, { status: 502 });

  const check = checkGrounding(text, [req.draft, ...req.facts]);
  if (!check.grounded) return Response.json({ error: "Ungrounded figures.", unsupported: check.unsupported }, { status: 422 });
  return Response.json({ text, model: model.name });
}
