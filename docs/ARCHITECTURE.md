# Architecture

Business X-Ray is a client-side Next.js application. All analysis runs in the
browser on a deterministic synthetic dataset; there is no backend yet.

## Layers

```
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
                store               zustand store: phase, scan progress, active finding, stage
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

## Experience flow

`landing → scanning → overview → investigating(stage)`; an investigation's
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

## Not built yet

Decision chapter, user-directed branching in the drill-down, model-based
intent parsing, final polish pass.
