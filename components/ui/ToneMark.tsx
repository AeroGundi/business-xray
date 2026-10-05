import type { Tone } from "@/types/insights";

const NAME: Record<Tone, string> = { risk: "Risk", attention: "Attention", positive: "Opportunity" };

/** Tone is encoded by shape as well as colour, so it never relies on colour alone. */
export function ToneMark({ tone, size = 9 }: { tone: Tone; size?: number }) {
  return (
    <span className={`tone-${tone} inline-flex items-center`}>
      <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden className="shrink-0" style={{ fill: "var(--tone)" }}>
        {tone === "risk" && <path d="M5 0.5 10 9.5H0z" />}
        {tone === "attention" && <path d="M5 0 10 5 5 10 0 5z" />}
        {tone === "positive" && <circle cx="5" cy="5" r="4.2" />}
      </svg>
      <span className="sr-only">{NAME[tone]}</span>
    </span>
  );
}

export const toneName = (tone: Tone): string => NAME[tone];
