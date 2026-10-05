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

Two ways in: **Explore demo business** (the synthetic NOVA retailer) or
**Analyze my business** — upload CSV/Excel files, have the columns recognised
and confirmed, see validation and a Data Readiness score, and run the same
X-Ray on your own data (in the browser; files are not uploaded).

Landing → business scan → health score and seven findings → root-cause
drill-down → evidence and testable hypotheses → impact → What-If simulator → Decision brief,
plus Ask the Business (natural-language questions answered by the analytics
engine). See
`docs/ARCHITECTURE.md` and `docs/METHODOLOGY.md`.

## Optional: model-worded explanations

Explanations are template-built by default. To have Claude reword them, start
the server with `ANTHROPIC_API_KEY` set (optionally `AI_MODEL`, default
`claude-opus-5-5`). Generated text is shown only if every figure in it appears
in the analysis; otherwise the template wording is kept.

Keyboard: `Enter` to scan, `/` to ask, `←` `→` to move through an investigation, `Esc` to close.
