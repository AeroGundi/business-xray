# Architecture

Business X-Ray is a client-side Next.js application. All analysis runs in the
browser, either on a deterministic synthetic dataset (the NOVA demo) or on
files the user uploads; the only server code is the optional `/api/explain`
route that rewords a finding.

## Layers

```
INGESTION       lib/ingestion       parse → profile → detect → extract → normalise → validate → readiness
                                    (uploaded files only; produces the same Dataset the generator does)
  ↓
DATA            lib/data            seeded generator, reference catalog, planted scenarios
  ↓
ANALYTICS       lib/analytics       stats, metric registry, aggregation, contribution analysis, health score
                lib/anomaly         temporal shift and cross-sectional outlier detection
                lib/root-cause      drill-down, driver tests, impact estimation
  ↓
INSIGHTS        lib/insights        the seven finding detectors, template narrative
                lib/engine          the staged business scan
                lib/simulation      What-If model: parameter estimation, calibration, scenarios, narrative
                lib/ai              Ask the Business: intent → answer → grounded explanation; AIProvider
                app/api/explain     server route that rewords a draft with a language model
  ↓
VISUALIZATION   lib/visualization   particles, pure layout functions, state → ViewSpec mapping
                components/visualization   WebGL point cloud (three.js / React Three Fiber)
                components/xray     the experience: landing, scan, overview, investigation
                components/ingestion   the "Analyze my business" screens
                store               useXray (phase, scan, active finding) · useIngest (files, mapping, analysis)
```

Rules that hold across the codebase:

- **No analytics in React components.** Components read `Finding`, `Health` and
  `Investigation` objects and format them.
- **No numbers in prose that are not read from a structured result.**
  `lib/insights/narrative.ts` is the only place sentences are assembled.
- **The engine never reads the planted scenarios.** `SCENARIOS` in
  `lib/data/catalog.ts` is imported by the generator and by tests only.
- **Everything is a metric.** A metric is `Σnum / Σden` over fact rows (or a
  weekly sum). Aggregation, detection, contribution analysis and drivers are
  generic over `Metric`, so adding a metric is one line in the registry.

## Data model

Reference entities: `Region`, `Country`, `Product`, `MarketingChannel`,
`Customer`. Facts: `OrderRow` (order line joined with its delivery and return
outcome) and `MarketingRow` (weekly spend and acquisitions per channel ×
country). In this version every order has a single line; `OrderRow` therefore
stands in for Order + OrderItem + Delivery + Return.

## Visualization

One particle is one order from the baseline or recent period (≈14,000 on
desktop, 6,000 on small screens).

- `ViewSpec` describes what to show: `dormant`, `cluster` (scope, dimension,
  heat, highlight, marks) or `timeline` (scope, metric).
- `computeLayout` (pure) turns a spec into per-particle targets and labels.
- `ParticleCloud` owns the GPU buffers. Positions and visual state are stored
  as from/to pairs and interpolated in the vertex shader, so a transition
  costs one CPU pass at its start and nothing per frame. One draw call.

Visual encodings, all data-driven:

| Encoding | Meaning |
|---|---|
| particle | one order |
| hollow ring / solid dot | baseline period / recent period |
| cluster | member of the dimension being examined |
| cluster size | order volume |
| particle size | order revenue (√) |
| colour and instability | contribution to the anomaly (red risk, amber attention, green positive) |
| particles leaving | outside the current scope |

Drilling down narrows the scope: particles outside it retreat to a distant
shell while those inside regroup by the next dimension, which reads as moving
deeper into the business.

## Ingestion: MY DATA → BUSINESS X-RAY

```
files ──parse.ts──▶ RawTable            CSV (RFC 4180, delimiter sniffing) and .xlsx (own reader over fflate)
      ──profile.ts─▶ Profile per column  type rates, cardinality, ranges, country and code patterns
      ──detect.ts──▶ SourceMapping       file → canonical table, column → canonical field, with confidence
                     (the user confirms or corrects; nothing below runs on an unconfirmed low-confidence mapping)
      ──extract.ts─▶ typed records       per-field missing/invalid counts, rows set aside with a reason, relationships
      ──normalize.ts▶ Dataset            the engine's own structure + `available` (what the data supports)
      ──validate.ts─▶ Issue[]            plain-language problems with counts, sample rows and a way forward
      ──readiness.ts▶ Readiness          five scored dimensions and the capability matrix
```

Design decisions:

- **A normalisation layer, not a second engine.** `schema.ts` defines the
  canonical e-commerce model (orders, customers, products, delivery,
  marketing, returns). Uploaded data is reshaped into the `Dataset` type the
  generator produces, so every existing analysis, the visualization and the
  AI layer run unchanged.
- **Capability gating instead of placeholders.** `Dataset.available` lists
  the metrics and dimensions the data supports. `hasMetric` / `dimsOf`
  (`lib/analytics/metrics.ts`) are consulted by the finding detectors, the
  drill-down, driver tests, the health score, the scan readouts, Ask the
  Business and the What-If entry points. An analysis the data cannot support
  is absent, never computed from defaults. The demo dataset has no
  `available` field and supports everything.
- **Deterministic schema detection.** No language model takes part in
  ingestion. Every confidence is a documented weighted sum (METHODOLOGY §12).
- **Everything stays in the browser.** Files are read with the File API and
  never sent anywhere. `pipeline.evaluate` is pure, so a mapping change just
  runs it again.
- `templates.ts` generates the downloadable templates and can write any
  `Dataset` in template format; the demo business exported this way is both
  the "filled example" download and the round-trip test fixture.

Limits: parsing and analysis run on the main thread (about one second for
170k rows across six files); `.xls` is not supported; only the e-commerce
model exists; an order with several products is analysed per product line.

## Experience flow

`landing → connect(steps) → scanning → …` for uploaded data: the ingestion
steps are `connect / template → processing → mapping → validation →
readiness → ready`, after which `useXray.load(dataset)` starts the same scan
the demo uses.

`landing → scanning → overview → investigating(stage) → whatif → decision`
(plus `answer` for Ask the Business); an investigation's
stages are `metric → segment… → cause → impact`, derived from the engine's
drill steps (`lib/visualization/view.ts`).

## Ask the Business

`store.ask(question)` → `interpret` → `resolveIntent`. An `explain` intent
produces a `Finding` (id `"ask"`) and opens the normal investigation flow; a
`rank` or `overview` intent produces an `Answer` shown in the `answer` phase
with its own `ViewSpec`. The model vendor is named only in
`app/api/explain/route.ts` and `lib/ai/server/anthropic.ts`.

## What-If

`store.openWhatIf()` calibrates a `Model` once from the data and findings.
`project(model, levers)` is pure and cheap, so every slider movement
recomputes the outcome, its price-sensitivity range and every scenario in the
comparison list. The visualization shows simulated order volume (orders fade
or baseline rings light up) and tints by profit direction; values are
quantised so dragging retargets the particles in steps.

## Decision

`store.openDecision()` turns the settings on screen into an option if they
are not one already. `evaluate` stress-tests every option, `recommend`
applies the maximin rule, and `decisionBrief` / `checkpoints` / `exportBrief`
produce the brief. Selecting an option sets the levers, so the visualization
always shows the option being read.

## Not built yet

User-directed branching in the drill-down, model-based intent parsing,
business models other than e-commerce, direct data connections, a What-If
model that degrades gracefully when some of its drivers are missing (it is
currently all-or-nothing).

## Performance

Measured in Chromium on the development machine at a 2344×1540 canvas with
14,000 particles: 60 fps idle and during transitions (worst frame 18 ms).
