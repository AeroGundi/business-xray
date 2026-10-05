/**
 * Grounding check: a generated explanation may only contain figures that
 * appear in the structured facts it was given. Anything else is rejected and
 * the deterministic wording is used instead.
 */

const NUMBER = /\d+(?:[.,]\d+)*/g;

const normalise = (token: string): string => token.replace(/,/g, "").replace(/\.0+$/, "");

export function numbersIn(text: string): string[] {
  return (text.match(NUMBER) ?? []).map(normalise);
}

export interface GroundingResult {
  grounded: boolean;
  /** Figures present in the text but absent from the facts. */
  unsupported: string[];
}

export function checkGrounding(text: string, facts: string[]): GroundingResult {
  const allowed = new Set(facts.flatMap(numbersIn));
  const unsupported = [...new Set(numbersIn(text).filter((n) => !allowed.has(n)))];
  return { grounded: unsupported.length === 0, unsupported };
}
