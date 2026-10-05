# Business X-Ray

*See what is really happening inside a business.*

An interactive investigation of a business rather than a dashboard: scan the
company, see what changed, follow it down to the segment responsible, review
the evidence for a likely cause, and size its impact.

Built as a final degree project (TFG). The business — NOVA, an international
e-commerce retailer — is synthetic and reproducible.

## Run

```bash
npm install
npm run dev
```

| Command | |
|---|---|
| `npm test` | analytics tests, including recovery of the planted root causes |
| `npm run inspect` | print what the engine finds |
| `npm run export` | write the dataset (CSV) and findings (JSON) to `/data` |
| `npm run typecheck` · `npm run lint` | |

## What exists

Landing → business scan → health score and seven findings → root-cause
drill-down → evidence → impact. See `docs/ARCHITECTURE.md` and
`docs/METHODOLOGY.md`.

Planned: Ask the Business, LLM explanations behind `AIProvider`, What-If
simulator, Decision chapter.

Keyboard: `Enter` to scan, `←` `→` to move through an investigation, `Esc` to close.
