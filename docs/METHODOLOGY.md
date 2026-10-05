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

## 8. AI architecture (planned)

    question → intent → analytical function → structured result → explanation → UI

`AIProvider` receives structured results only and returns wording. The current
`TemplateProvider` is deterministic. An LLM provider must be held to the same
contract: no numeric value in its output that is absent from its input.

## 9. Evaluation design (proposed)

Between-subjects comparison of a conventional dashboard built on the same
dataset versus Business X-Ray. Because the scenarios are planted, the correct
root cause is known. Measures: time to identify the root cause, number of
interactions, accuracy against ground truth, stated confidence, SUS
(usability), NASA-TLX (cognitive load), and decision quality.

`tests/engine.test.ts` already verifies that the engine recovers the planted
causes from data alone, across several seeds.
