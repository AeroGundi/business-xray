"use client";

import { useEffect, useRef, useState } from "react";
import { SUGGESTIONS } from "@/lib/ai/intent";
import { useXray } from "@/store/useXray";

/** The natural-language entry point. A single line; the answer appears in the experience, not in a chat log. */
export function AskBar({ suggestions = true }: { suggestions?: boolean }) {
  const ask = useXray((s) => s.ask);
  const [value, setValue] = useState("");
  const [hint, setHint] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const cycle = setInterval(() => setHint((h) => (h + 1) % SUGGESTIONS.length), 4200);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(cycle);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="pointer-events-auto w-full">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(value);
          setValue("");
        }}
        className="flex items-baseline gap-4 border-b border-line-strong pb-2.5 transition-colors focus-within:border-ink"
      >
        <label htmlFor="ask" className="label shrink-0 text-ink-2">
          Ask the business
        </label>
        <input
          id="ask" ref={input} value={value} onChange={(e) => setValue(e.target.value)}
          placeholder={SUGGESTIONS[hint]} autoComplete="off" spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[0.95rem] tracking-tight outline-none placeholder:text-ink-3"
        />
        <button type="submit" className="label shrink-0 cursor-pointer text-ink-2 transition-colors hover:text-ink" aria-label="Ask">
          ↵
        </button>
      </form>
      {suggestions && (
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
          {SUGGESTIONS.slice(0, 4).map((s) => (
            <li key={s}>
              <button type="button" onClick={() => ask(s)} className="cursor-pointer text-left text-[0.8rem] text-ink-3 transition-colors hover:text-ink">
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
