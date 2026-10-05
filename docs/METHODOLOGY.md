# Methodology

Every analytical result shown in Business X-Ray is produced by the methods
below. Parameters are named constants in the code and are quoted here.

## 1. Synthetic data (`lib/data`)

NOVA is simulated week by week for 78 weeks after a 104-week burn-in that
brings the customer base near steady state. The generator is agent-based and
seeded (mulberry32, seed 2026), so the dataset is reproducible.

Structural relationships:

| Cause | Effect |
|---|---|
| marketing spend | acquisitions, with diminishing returns: `n ∝ spend^0.6` |
| customer segment | purchase frequency, basket size, category affinity, churn |
| country | promised delivery time, shipping cost, return rate |
| product | price, unit cost, freight class (+4 days, higher shipping) |
| channel | discount depth |
| delivery delay (days beyond promise + 1) | return probability +1.2 pts/day; churn +2 to +5 pts/day by segment |
| quoted delivery time | conversion loss on the affected product |
| discount | lower revenue and margin per order |
| return | negative contribution profit, +10 pts churn |

Planted scenarios (ground truth, `SCENARIOS`): a freight disruption for the
Atlas Standing Desk in Germany (+9 days from week 68); a 24% discount promotion
on Paid Social that attracts low-repeat customers; Paid Search budget scaled
into a saturated auction; an affiliate partnership driving Smart Home demand in
Spain and Italy. The UK structurally has higher shipping cost and returns.

Limitations: one line per order; first-touch channel attribution; no stock,
pricing or competitor dynamics; contribution profit excludes marketing spend
and overheads.

## 2. Metrics (`lib/analytics/metrics.ts`)

A metric is `Σ num(row) / Σ den(row)` over fact rows in a scope and period, or
a weekly sum when no denominator is defined.

- Contribution margin = Σ profit / Σ revenue, where profit = revenue − COGS −
  shipping, or −(2 × shipping + 0.25 × COGS) for a returned order.
- Repeat purchase rate = share of orders followed by another order from the
  same customer within 5 weeks. Orders in the last 5 weeks are right-censored
  and excluded, so the recent period for this metric is shorter.
- CAC = Σ spend / Σ new customers.

Periods: recent = last 10 weeks; baseline = the 10 weeks before.

## 3. Anomaly detection (`lib/anomaly/detect.ts`)

**Temporal shift.** For a series, δ = relative change (sums) or absolute
change (ratios) between baseline and recent. The same statistic is computed
for every earlier placement of the two windows in that series' own history,
giving an empirical null distribution {δₖ}. The score is a robust z:

    z = (δ − median{δₖ}) / (1.4826 · MAD{δₖ})

The null therefore reflects each series' own trend, seasonality and noise. A
scale floor prevents infinite z on near-constant histories, and at least 12
null samples are required.

**Cross-sectional outlier.** A member is compared with its peers using the
same robust z across members (used for regional underperformance).

**Confidence** = 2Φ(|z|) − 1, capped at 99%. It is the confidence that the
change is unusual for that series — not that a cause has been identified.

**Slice ranking.** When scanning slices, score = z · √(coverage) so that large
segments are preferred over tiny ones with equal z.

Limitations: 78 weeks give 58 overlapping null samples, which are not
independent; the null can contain earlier real events (mitigated by
median/MAD); many slices are scanned without multiple-comparison correction.

## 4. Contribution analysis (`lib/analytics/compare.ts`)

For focus set A and reference set B (recent vs baseline, or a member vs its
peers), each member i of a dimension gets an additive contribution cᵢ with
Σcᵢ = total change:

    sum metric:    cᵢ = aᵢ/w_A − bᵢ/w_B
    ratio metric:  cᵢ = (numAᵢ − ρ_B·denAᵢ)/Den_A − (numBᵢ − ρ_B·denBᵢ)/Den_B,   ρ_B = Num_B/Den_B

The ratio form combines rate and mix effects. Additivity is unit-tested.

## 5. Root-cause exploration (`lib/root-cause/investigate.ts`)

**Drill-down.** At each level every unused dimension is split. For its
leading member: share = cᵢ / total change; weight = its share of reference
volume; lift = min(1, share) − weight. The dimension with the highest lift is
followed if the member has ≥ 100 rows and is either

- *concentrated*: share ≥ 35% and lift ≥ 20 pts, or
- *distinct*: share ≥ 50% and its relative change is ≥ 2× that of its siblings
  combined (or of opposite sign).

Maximum depth 4. This is a simplified form of the explanatory-power / surprise
criterion of Adtributor (Bhagwan et al., NSDI 2014).

**Associated drivers.** In the final segment, candidate operational metrics
(delivery time, discount depth, return rate, repeat rate, new-customer share,
order value, shipping cost; spend and acquisitions for marketing metrics) are
tested recent vs baseline with Welch's t-test, or a pooled two-proportion
z-test for binary outcomes. A driver is reported if p < 0.01 and the relative
shift is ≥ 5%, ranked by |statistic|. For each one the product also reports
the change of the same metric outside the segment (difference-in-differences
control) and the weekly Pearson correlation with the anomalous metric.

**Language.** The evidence is observational. The product says "associated
with", "likely contributor", "evidence suggests" and never "caused by".

Limitations: greedy single-path search; drivers limited to recorded metrics;
confounding is possible (e.g. customer mix shifts inside a segment); normal
approximation for test statistics in small segments.

## 6. Impact (`estimateImpact`)

| Metric | Formula |
|---|---|
| Revenue | (recent − baseline weekly revenue) × weeks |
| Contribution margin | margin change × revenue in the period |
| Repeat purchase rate | rate change × orders × average order value |
| CAC | CAC change × customers acquired |
| Delivery time | orders affected (count) |

Baseline is the counterfactual. The annualised figure multiplies by 52/weeks
and assumes the condition persists unchanged; it is a run-rate, not a forecast.

## 7. Business health score (`lib/analytics/health.ts`)

Five pillars × 20 points. Each component maps its value linearly from a floor
(0 points) to a target (full points), clamped.

| Pillar | Component | Floor → Target | Points |
|---|---|---|---|
| Growth | revenue vs previous period | −10% → +10% | 12 |
| | new customers vs previous period | −10% → +10% | 8 |
| Profit | contribution margin | 20% → 40% | 14 |
| | discount depth | 15% → 4% | 6 |
| Customers | repeat purchase rate | 10% → 25% | 12 |
| | return rate | 12% → 3% | 8 |
| Operations | on-time delivery (≤ promise + 1 day) | 70% → 95% | 12 |
| | shipping cost / revenue | 8% → 3% | 8 |
| Risk | adverse findings with confidence ≥ 95% | 5 → 0 | 12 |
| | revenue concentration by country (HHI) | 0.35 → 0.12 | 8 |

Thresholds are judgement calls for a mid-size e-commerce retailer and should
be defended or recalibrated as such; the score is a transparent index, not a
statistical estimate.

## 8. AI layer: Ask the Business (`lib/ai`)

    question → intent → analytical function → structured result → explanation → UI

**Intent (`intent.ts`).** A deterministic, rule-based interpreter. It detects a
metric (synonym patterns, most specific first), a scope (members of each
dimension found in the question, plus a small alias table) and whether the
question is comparative. It returns one of four intents:

| Intent | Example | Analytical function |
|---|---|---|
| `explain(metric, scope)` | "Why did revenue fall in Germany?" | shift detection + root-cause investigation (§3, §5) |
| `rank(metric, dim, scope)` | "Which customers are most at risk?" | contribution split by the dimension (§4), ordered worst first |
| `overview` | "What changed this quarter?" | the scan's findings ranked by estimated impact |
| `unknown` | "What is the weather?" | none — the product says it cannot answer |

A question that maps to nothing is refused, never guessed. If an `explain`
question matches a finding the scan already produced, that finding is reused
so two routes to the same question cannot disagree. Segments with fewer than
60 fact rows are refused as too thin.

**Structured result (`answer.ts`).** Every answer carries its interpretation,
evidence rows, a view for the visualization, a recommended next
investigation, a template explanation and a `facts` list. All figures are
computed here.

**Explanation (`provider.ts`).** `AIProvider.explain({topic, draft, facts})`
returns wording. `TemplateProvider` returns the draft. `RemoteProvider` calls
`/api/explain`, where a `TextModel` (currently Claude via the Anthropic SDK;
vendor chosen in one function) rewrites the draft.

**Grounding (`grounding.ts`).** Every numeric token in generated text must
appear in the draft or the facts after normalisation; otherwise the text is
discarded and the draft is shown. The check runs on the server and again on
the client. The interface labels which wording is displayed. This guarantees
no invented *figures*; it does not verify non-numeric claims, which is why
the model is instructed to preserve the draft's hedged causal language and
why the draft remains the reference.

**Hypotheses (`insights/hypotheses.ts`).** Each candidate driver not already
confirmed is offered as a hypothesis; testing it runs the same test as §5 in
the final segment and reports supported / not supported with the statistic.

Limitations: the interpreter covers a fixed vocabulary and one metric per
question; it has no memory of previous questions; time periods in a question
("this quarter", "last month") are not parsed — the standard 10-week
comparison is always used and stated in the interpretation.

## 9. What-If simulation (`lib/simulation`)

**Kind of model.** Comparative statics on the weekly run-rate. The baseline is
the last 10 weeks; a scenario's result is the run-rate once the customer base
has adjusted to the change. It is not a forecast and has no time path.

**Equations** (subscript 0 = baseline; levers: price p, discount depth d,
marketing spend m, delivery change ΔD days, retention budget b €/week):

    demand factor     Q = [(1 + p)(1 − d) / (1 − d₀)] ^ ε
    acquisitions      N = N₀ · (1 + m)^η · Q
    days late         Δlate(ΔD) = mean max(0, gapᵢ + ΔD − 1) − mean max(0, gapᵢ − 1)
    repeat rate       r = r₀ + β_rep · Δlate + k · √(b / 1000)
    continuation      c = c₀ · r / r₀
    orders            O = O₀ · (1 + m)^η · Q · (1 − c₀) / (1 − c)
    return rate       ρ = ρ₀ + β_ret · Δlate
    revenue           = O · list₀ (1 + p)(1 − d)
    profit            = O · [(1 − ρ)(rev/order − cogs₀ − ship) − ρ(2·ship + ¼·cogs₀)] − spend₀(1 + m) − b
    shipping          ship = ship₀ + κ · max(0, −ΔD)

`gapᵢ` is delivery minus promised days for each recent order, so the effect of
a delivery change on lateness is computed on the empirical distribution rather
than assumed linear. `c₀` is the share of orders placed by returning customers;
with a geometric repurchase process, orders per acquired customer are
1/(1 − c), which gives the orders equation. With all levers at zero the model
reproduces observed revenue exactly (unit-tested).

**Parameters.**

| Symbol | Meaning | Source | Value (seed 2026) |
|---|---|---|---|
| η | acquisition elasticity to spend | estimated: log–log OLS, weekly, paid channels, channel fixed effects | 0.56 ± 0.09 |
| β_ret | return rate per day late | estimated: linear probability, category fixed effects | +1.45 ± 0.19 pts |
| β_rep | repeat rate per day late | estimated: linear probability, segment fixed effects | −0.47 ± 0.33 pts |
| ε | price elasticity of demand | **assumed** — list prices never vary in the data | −1.3; range −0.8 to −1.8 shown |
| k | repeat-rate gain per √(€1k/week) retention budget | **assumed** — no programme in the data | 0.3 pts |
| κ | shipping cost per day saved, per order | **assumed** — no carrier pricing in the data | €0.90 |

Estimates are shown with their standard error in the interface. β_rep is not
statistically distinguishable from zero (t ≈ 1.4): the delivery lever's effect
on retention is weak evidence and should be presented as such.

**Resolving a finding.** A scenario may recover a share s of one finding's
estimated impact (§6): s × weekly impact is added to revenue (revenue and
repeat-rate findings, earning the average contribution margin) or directly to
profit (margin and CAC findings). This is a return-to-baseline counterfactual,
not a modelled intervention, and findings can overlap, so only one can be
resolved per scenario.

**Limitations.** Steady state only; constant elasticities; no competitor
response, capacity or stock effects; discount is treated as a price change;
the continuation scaling makes outcomes sensitive to small repeat-rate
changes; estimates are from observational data and may be confounded (the
spend elasticity pools a period in which one channel saturated).

## 10. Decision (`lib/simulation/decision.ts`)

**Stress test.** Each option is re-simulated under every combination of
plausible values of the parameters it depends on (and only those — an option
that does not move price is not exposed to price elasticity):

| Parameter type | Values tried |
|---|---|
| price elasticity | −0.8, −1.3, −1.8 |
| other assumed parameters | 0.5×, 1×, 1.5× the assumed value |
| estimated parameters | estimate − 1 SE, estimate, estimate + 1 SE |
| share of a finding recovered | 0.5×, 1×, up to full recovery |

The lowest and highest resulting profit are the option's pessimistic and
optimistic cases.

**Decision rule.** Options are ranked by pessimistic-case profit and the
highest is marked "most robust" (maximin). This is a deliberately cautious
criterion suited to a model with assumed parameters; the expected value is
shown alongside so a less risk-averse reader can choose differently. The
product marks an option; the user chooses.

**Brief.** For the chosen option: expected and annualised profit, the range,
which parameters it rests on (estimated or assumed), and a watch-list — the
metrics each moved lever should shift, with the current value and the value
the model expects — so the decision can be checked against reality afterwards.
The brief can be copied as plain text.

Limitations: the grid is a set of scenarios, not a probability distribution,
so the range is not a confidence interval; parameters are varied
independently; maximin ignores upside.

## 11. Evaluation design (proposed)

Between-subjects comparison of a conventional dashboard built on the same
dataset versus Business X-Ray. Because the scenarios are planted, the correct
root cause is known. Measures: time to identify the root cause, number of
interactions, accuracy against ground truth, stated confidence, SUS
(usability), NASA-TLX (cognitive load), and decision quality.

`tests/engine.test.ts` already verifies that the engine recovers the planted
causes from data alone, across several seeds.

## 12. Data ingestion (`lib/ingestion`)

Uploaded files are turned into the dataset the engine reads in six steps.
Each is deterministic; none uses a language model.

### 12.1 Column profiling (`profile.ts`)

For every column, on up to 4,000 evenly spaced rows: share of values that
parse as a date, a number, an integer, a known country (English or Spanish
name, ISO-2/ISO-3 code) or a code-like token; minimum, median, maximum; mean
length. Cardinality (`distinct / filled`) is counted on **all** rows, because
a sample makes repeated keys look unique. Day/month order of numeric dates is
decided per column by any value whose first or second part exceeds 12, and
reported when it cannot be decided.

### 12.2 Schema detection (`detect.ts`)

For each (column, canonical field) pair:

| Evidence | Score | How |
|---|---|---|
| name | 0–1 | header normalised (case, accents, punctuation, camelCase) and compared with the field's English/Spanish vocabulary: exact or same tokens = 1; vocabulary term contained in the header = 0.6 + 0.3·(term tokens / header tokens); header contained in a term = 0.55 + 0.3·ratio; otherwise 0.75 × Sørensen–Dice bigram similarity if ≥ 0.72 |
| type | 0–1 | share of values with the type the field requires; an incompatible type **vetoes** the pair |
| value | 0–1 | field-specific behaviour: uniqueness for keys, small positive integers for quantity, 0–100 for discounts, country match rate, low cardinality for categories; 0.6 when nothing can be said |

`confidence = 0.62·name + 0.20·type + 0.18·value`, capped at 0.99.

Pairs scoring ≥ 0.50 are assigned greedily in order of confidence, one column
per field. Three fall-backs map columns with no usable name, always below the
confirmation threshold: a column that is ≥ 90% countries (0.70); the only
date column of a file still missing a date (0.70); and a free column whose
values are ≥ 80% contained in the key column of another file
(0.55 + 0.24·containment) — the relationship itself is the evidence.

A file is recognised as the table whose required and core fields it covers
best (confidence-weighted, required ×3, core ×2), with +0.2 when the file
name suggests the table, ×0.6 when a required field is missing and the name
gives no hint, and ×0.4 when the table's own key would repeat in the file (a
customer file lists each customer once). Each table is given to one file.

Bands: high ≥ 95%, medium 80–94%, low < 80%. A low mapping, or one where a
second column scores within 0.08 for the same field, must be confirmed or
changed by the user before the flow continues.

### 12.3 Typed extraction and row rules (`extract.ts`)

Each mapped cell is read as its field's type. A row is set aside — counted
and shown, never silently repaired — when a required field is empty or
unreadable, a date lies before 1990 or in the future, a quantity is ≤ 0, an
amount is negative, the row is identical to an earlier one, or it repeats
the key of a reference table. Unreadable values in non-required fields
become empty.

Relationships are measured on the extracted records: for each link
(orders→customers, orders→products, delivery→orders, returns→orders,
marketing→customers by channel) the share of child rows whose key exists in
the parent. Identifiers are compared ignoring case and surrounding space.

### 12.4 Normalisation conventions (`normalize.ts`)

- **Time.** Weeks are 7-day blocks ending on the last order date; a leading
  partial week is dropped. At least 41 weeks are required: two 10-week
  windows plus the 12 earlier window placements the anomaly detector needs
  for its null distribution (§3).
- **Revenue.** `quantity × unit_price − discount`; when only a line total
  exists it is taken as revenue. The discount column is read as a fraction
  (max ≤ 1), a percentage (header says so, or values ≤ 100 that are ≥ 90%
  multiples of 0.5) or an amount; the reading is reported.
- **Profit.** `revenue − cost − shipping`, or `−(2·shipping + 0.25·cost)`
  for a returned order — the demo business's convention, stated to the user
  as an estimate. Profit is reported only if ≥ 80% of revenue has a known
  cost; remaining lines take the average cost-to-list ratio and are counted.
- **Delivery.** Days from order to delivery. Without a promised date, the
  promise is the median delivery time of the order's country, so "on time"
  means "not more than a day slower than usual". Orders with no delivery are
  excluded from delivery metrics rather than counted as zero. Delivery
  metrics need ≥ 30% of orders matched.
- **Customers.** Acquired at the signup date if given, else at the first
  order in the file (which overstates new customers in the first weeks, and
  is reported). Repeat purchase uses the same 5-week window as §2.
- **Marketing.** Weekly spend by channel (and country when present), joined
  with customers acquired through the same channel. CAC is reported only if
  ≥ 50% of spend is on channels that customers are attributed to.
- **Names.** Countries map to a canonical English name; values differing only
  in case, accents or punctuation are merged, and the merge is reported.

### 12.5 Data readiness (`readiness.ts`)

`readiness = Σ wᵢ · dimensionᵢ`

| Dimension | Weight | Definition |
|---|---|---|
| Data coverage | 0.25 | template fields present, weighted required 3 · core 2 · extra 1 |
| Data quality | 0.25 | mean of completeness (filled cells), validity (cells readable as their type) and usable rows (not set aside) |
| Relationships | 0.15 | mean, over detected links, of the share of records that connect |
| Temporal coverage | 0.15 | weeks / 104, capped at 1 |
| Analytical coverage | 0.20 | mean over the capability matrix: available 1, limited 0.5, unavailable 0 |

A dimension that does not apply (relationships, when a single file is
uploaded) is excluded and the remaining weights are rescaled. The weights
are a design choice, not an estimate; they are constants in the module and
shown next to each dimension in the interface.

The capability matrix (`capabilitiesOf`) lists sixteen analyses with the
data condition for each (e.g. profitability needs cost coverage; marketing
efficiency needs spend attributable to acquisition channels; anomaly
detection is "limited" under 52 weeks because seasonality cannot be
separated from change).

### 12.6 Effect on the analytical engine

With uploaded data the engine is unchanged except for availability checks:
finding detectors, drill dimensions and driver candidates are restricted to
what `Dataset.available` lists. The health score leaves out components it
cannot measure and rescales the earned points to 100
(`score = 100 · earned / attainable`); the omitted components are named
beside the score. The What-If model requires all of margin, CAC, delivery,
returns and repeat rate, and is otherwise not offered.

### 12.7 Verification (`tests/ingestion.test.ts`)

Seven scenarios, built by rewriting the demo business in template format:
(A) perfect data — the engine must return the same findings, the same
root-cause segment and lead driver, and a health score within 3 points of
the original (a gap of up to 3 points was observed; it has not been traced,
though the export does round delivery times to whole days); (B) Spanish headers in a single file; (C) different naming
with a line total instead of a price; (D) optional files missing;
(E) missing customer ID, missing order date, too little history; (F) dirty
data — duplicates, empty and unreadable dates, impossible quantities, mixed
date formats, mixed country spellings, a truncated customer file, each with
an exact expected count; (G) two candidate date columns, and columns mapped
from values or relationships alone.

Limitation: the detection vocabulary and thresholds were tuned on these
scenarios, not validated on a corpus of real business exports.
