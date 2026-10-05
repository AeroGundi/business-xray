import Anthropic from "@anthropic-ai/sdk";
import type { ExplainRequest } from "@/lib/ai/provider";
import { SYSTEM_PROMPT, type TextModel, userPrompt } from "./model";

export class AnthropicModel implements TextModel {
  readonly name: string;
  private readonly client = new Anthropic();

  constructor(model = process.env.AI_MODEL ?? "claude-opus-5-5") {
    this.name = model;
  }

  async rewrite(request: ExplainRequest): Promise<string | null> {
    try {
      const response = await this.client.beta.messages.create({
        model: this.name,
        max_tokens: 16000,
        // Rephrasing a short draft: the lowest effort is enough.
        output_config: { effort: "low" },
        // If a safety classifier declines, the API retries on a fallback model in the same call.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt(request) }],
      });
      if (response.stop_reason === "refusal") return null;
      const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("").trim();
      return text || null;
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) console.warn("explain: rate limited");
      else if (error instanceof Anthropic.AuthenticationError) console.warn("explain: invalid credentials");
      else if (error instanceof Anthropic.APIError) console.warn(`explain: API error ${error.status}`);
      else console.warn("explain: request failed");
      return null;
    }
  }
}
