/** Prints what the engine finds in the synthetic dataset. Run: npm run inspect */
import { generateDataset } from "../lib/data/generate";
import { detectFindings } from "../lib/insights/findings";
import { METRICS } from "../lib/analytics/metrics";

const t0 = performance.now();
const data = generateDataset();
const t1 = performance.now();
const findings = detectFindings(data);
const t2 = performance.now();
console.log(`customers ${data.customers.length}  orders ${data.orders.length}  gen ${(t1 - t0).toFixed(0)}ms  analysis ${(t2 - t1).toFixed(0)}ms`);

const f = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(3));
for (const fd of findings) {
  const inv = fd.investigation;
  console.log(`\n${fd.index} ${fd.title} [${fd.tone}] ${METRICS[fd.metric].label} ${JSON.stringify(fd.scope)} ${fd.comparison.kind}`);
  console.log(`   ${f(fd.effect.before)} → ${f(fd.effect.after)} (${(fd.effect.changePct * 100).toFixed(1)}%)  z=${fd.z.toFixed(1)} conf=${fd.confidence.toFixed(2)} expected=${fd.expected?.toFixed(3)}`);
  for (const s of inv.steps) {
    console.log(`   → ${s.dim}=${s.member}: ${f(s.effect.before)} → ${f(s.effect.after)} (${(s.effect.changePct * 100).toFixed(1)}%) share=${s.share.toFixed(2)} weight=${s.weight.toFixed(2)} n=${s.effect.n}`);
  }
  console.log(`   shareOfRoot=${inv.shareOfRoot.toFixed(2)} impact=${inv.impact.value.toFixed(0)} ${inv.impact.unit} annual=${inv.impact.annualised?.toFixed(0)}`);
  for (const d of inv.drivers) {
    console.log(`   · ${d.metric}: ${f(d.before)} → ${f(d.after)} (${(d.changePct * 100).toFixed(0)}%) ctrl=${d.controlChange?.toFixed(3)} t=${d.statistic.toFixed(1)} p=${d.p.toExponential(1)} r=${d.correlation?.r.toFixed(2)}`);
  }
}
