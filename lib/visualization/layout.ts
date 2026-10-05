import { METRICS, type DimKey, type MetricId, type Scope, dimOf, inScope } from "@/lib/analytics/metrics";
import { rowValue } from "@/lib/root-cause/investigate";
import { formatValue } from "@/lib/format";
import type { ParticleSet } from "./particles";

/**
 * Pure layout functions: a ViewSpec describes *what* the visualization should
 * show; computeLayout turns it into per-particle targets (position, opacity,
 * heat, hue) plus the labels and guide lines that annotate them.
 */

export const HUE = { risk: 0, attention: 0.5, positive: 1 } as const;

export interface Mark {
  scope: Scope;
  hue: number;
}

export type ViewSpec =
  | { mode: "dormant" }
  | {
      mode: "cluster";
      scope: Scope;
      dim: DimKey;
      hue: number;
      /** Heat per member, 0..1. */
      heat?: Record<string, number>;
      /** Member to single out; the others recede. */
      highlight?: string;
      /** Secondary label text per member. */
      notes?: Record<string, string>;
      /** Sub-segments to light up inside the clusters. */
      marks?: Mark[];
      /** Hide cluster labels (used while scanning). */
      quiet?: boolean;
    }
  | { mode: "timeline"; scope: Scope; metric: MetricId | null; hue: number };

export interface Label {
  key: string;
  text: string;
  note?: string;
  position: [number, number, number];
  /** Which side of the label touches its anchor point. */
  anchor: "center" | "left" | "right";
  emphasis: "normal" | "high" | "low";
  kind: "cluster" | "axis";
}

export interface Layout {
  labels: Label[];
  /** Line segments as consecutive xyz pairs. */
  segments: Float32Array;
  /** Point-size multiplier: sparse views draw larger particles so small segments stay legible. */
  boost: number;
}

const boostFor = (visible: number): number => Math.min(3.2, Math.max(1, Math.sqrt(3200 / Math.max(1, visible))));

/** Half-extents of the region the visualization may occupy, in world units. */
export interface Frame {
  rx: number;
  ry: number;
  /** Small screens get fewer labels instead of a shrunken copy of the desktop view. */
  compact?: boolean;
}

const MAX_LABELS = 9;
const TAU = Math.PI * 2;

/**
 * Packs clusters into one body: the largest sits at the core and the rest
 * form a ring around it, each sized by the square root of its volume.
 */
function placeClusters(members: { key: string; count: number }[], frame: Frame): Map<string, { center: [number, number, number]; radius: number }> {
  const out = new Map<string, { center: [number, number, number]; radius: number }>();
  const total = members.reduce((s, m) => s + m.count, 0) || 1;
  const n = members.length;
  const unit = Math.min(frame.rx, frame.ry);
  if (n === 1) {
    out.set(members[0].key, { center: [0, 0, 0], radius: unit * 0.62 });
    return out;
  }
  const radii = members.map((m) => unit * Math.min(0.5, Math.max(0.11, 0.64 * Math.sqrt(m.count / total))));
  const core = n >= 5 ? 1 : 0;
  if (core) out.set(members[0].key, { center: [0, 0, 0], radius: radii[0] });
  const ring = radii.slice(core);
  const sum = ring.reduce((s, r) => s + r, 0);
  // Wide enough for the ring members to sit side by side and to clear the core.
  const widest = Math.max(...ring);
  const R = Math.min(unit - widest * 0.7, Math.max((sum * 1.06) / Math.PI, core ? radii[0] + widest * 1.05 : widest * 1.15));
  const stretch = Math.min(1.3, frame.rx / frame.ry);
  let angle = Math.PI * 0.8;
  ring.forEach((r, i) => {
    const arc = (r / sum) * TAU;
    angle -= arc / 2;
    out.set(members[i + core].key, { center: [Math.cos(angle) * R * stretch, Math.sin(angle) * R, Math.sin(i * 2.4) * 0.4], radius: r });
    angle -= arc / 2;
  });
  return out;
}

export function computeLayout(set: ParticleSet, spec: ViewSpec, frame: Frame, to: Float32Array, state: Float32Array): Layout {
  const { count, rows, gauss, ghost, seed } = set;
  const put = (i: number, x: number, y: number, z: number, alpha: number, heat: number, hue: number) => {
    to[i * 3] = x;
    to[i * 3 + 1] = y;
    to[i * 3 + 2] = z;
    state[i * 3] = alpha;
    state[i * 3 + 1] = heat;
    state[i * 3 + 2] = hue;
  };
  // Particles outside the current scope retreat to a distant shell.
  const away = (i: number) => {
    const gx = gauss[i * 3];
    const gy = gauss[i * 3 + 1];
    const gz = gauss[i * 3 + 2];
    const k = (8 + seed[i] * 4) / (Math.hypot(gx, gy, gz) || 1);
    put(i, gx * k, gy * k, gz * k * 0.35, 0, 0, 0);
  };

  if (spec.mode === "dormant") {
    const r = Math.min(frame.rx, frame.ry) * 0.55;
    for (let i = 0; i < count; i++) put(i, gauss[i * 3] * r, gauss[i * 3 + 1] * r, gauss[i * 3 + 2] * r, ghost[i] ? 0.1 : 0.32, 0, 0);
    return { labels: [], segments: new Float32Array(0), boost: 1 };
  }

  if (spec.mode === "timeline") {
    const metric = spec.metric ? METRICS[spec.metric] : null;
    const W = frame.rx * 0.84;
    const H = frame.ry * 0.5;
    const { from, split, to: end } = set.weeks;
    const idx: number[] = [];
    const vals: number[] = [];
    for (let i = 0; i < count; i++) {
      if (!inScope(rows[i], spec.scope)) {
        away(i);
        continue;
      }
      const v = metric ? rowValue(metric, rows[i]) : 0;
      if (v === null) {
        away(i);
        continue;
      }
      idx.push(i);
      vals.push(v);
    }
    const sorted = [...vals].sort((a, b) => a - b);
    const lo = sorted[Math.floor(sorted.length * 0.02)] ?? 0;
    const hi = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))] ?? 1;
    const binary = lo === 0 && hi === 1 && sorted.every((v) => v === 0 || v === 1);
    idx.forEach((i, k) => {
      const t = (rows[i].week + seed[i] - from) / (end - from);
      let norm = metric && hi > lo ? Math.min(1, Math.max(0, (vals[k] - lo) / (hi - lo))) : 0.5;
      let y = (norm - 0.5) * 2 * H;
      if (!metric) y = gauss[i * 3 + 1] * H * 0.35;
      else if (binary) {
        y = (vals[k] ? 0.55 : -0.55) * H + gauss[i * 3 + 1] * H * 0.12;
        norm = vals[k];
      }
      const polarityHeat = metric && metric.polarity > 0 ? 1 - norm : norm;
      put(i, (t * 2 - 1) * W, y, gauss[i * 3 + 2] * 0.12, ghost[i] ? 0.85 : 1, metric ? polarityHeat : ghost[i] ? 0 : 0.6, spec.hue);
    });
    const xs = ((split - from) / (end - from)) * 2 * W - W;
    const base = -H - 0.28;
    const labels: Label[] = [
      { key: "baseline", text: "Baseline", note: `${split - from} weeks`, position: [(xs - W) / 2, base, 0], anchor: "center", emphasis: "low", kind: "axis" },
      { key: "recent", text: "Recent", note: `${end - split} weeks`, position: [(xs + W) / 2, base, 0], anchor: "center", emphasis: "normal", kind: "axis" },
    ];
    if (metric && !binary) {
      labels.push({ key: "hi", text: formatValue(hi, metric.unit), position: [-W - 0.1, H, 0], anchor: "right", emphasis: "low", kind: "axis" });
      labels.push({ key: "lo", text: formatValue(lo, metric.unit), position: [-W - 0.1, -H, 0], anchor: "right", emphasis: "low", kind: "axis" });
    }
    if (metric) labels.push({ key: "metric", text: `${metric.label} per order`, position: [0, H + 0.42, 0], anchor: "center", emphasis: "normal", kind: "axis" });
    return { labels, segments: new Float32Array([-W, base + 0.14, 0, W, base + 0.14, 0, xs, base + 0.14, 0, xs, H + 0.15, 0]), boost: boostFor(idx.length) };
  }

  // Cluster mode.
  const groups = new Map<string, number>();
  let visible = 0;
  for (let i = 0; i < count; i++) {
    if (!inScope(rows[i], spec.scope)) continue;
    const key = dimOf(rows[i], spec.dim);
    groups.set(key, (groups.get(key) ?? 0) + 1);
    visible++;
  }
  // A single mark is read against the rest of the business, which steps back.
  const backdrop = spec.marks?.length === 1 ? 0.5 : 1;
  const members = [...groups].map(([key, c]) => ({ key, count: c })).sort((a, b) => b.count - a.count);
  const placed = placeClusters(members, frame);

  for (let i = 0; i < count; i++) {
    const row = rows[i];
    if (!inScope(row, spec.scope)) {
      away(i);
      continue;
    }
    const key = dimOf(row, spec.dim);
    const { center, radius } = placed.get(key)!;
    const s = radius * 0.43;
    const receded = spec.highlight !== undefined && key !== spec.highlight;
    let alpha = (ghost[i] ? 0.3 : 0.9) * (receded ? 0.42 : 1) * backdrop;
    let heat = spec.highlight !== undefined ? (receded ? 0 : 1) : Math.min(1, Math.max(0, spec.heat?.[key] ?? 0));
    let hue = spec.hue;
    if (ghost[i]) heat = 0;
    if (spec.marks) {
      heat = 0;
      for (const mark of spec.marks) {
        if (inScope(row, mark.scope)) {
          heat = ghost[i] ? 0.55 : 1;
          hue = mark.hue;
          alpha = ghost[i] ? 0.4 : 1;
          break;
        }
      }
    }
    put(i, center[0] + gauss[i * 3] * s, center[1] + gauss[i * 3 + 1] * s, center[2] + gauss[i * 3 + 2] * s * 0.6, alpha, heat, hue);
  }

  const labels: Label[] = [];
  const segments: number[] = [];
  members.forEach((m, i) => {
    const { center, radius } = placed.get(m.key)!;
    if (members.length > 1) {
      // Spokes stop short of the core and of the cluster so they never pile up into a bright spot.
      const len = Math.hypot(center[0], center[1], center[2]) || 1;
      const a = 0.22;
      const b = Math.max(a, 1 - (radius * 1.05) / len);
      segments.push(center[0] * a, center[1] * a, center[2] * a, center[0] * b, center[1] * b, center[2] * b);
    }
    const limit = frame.compact ? (members.length > 6 ? 3 : 6) : members.length > 10 ? 6 : MAX_LABELS;
    if (spec.quiet || (i >= limit && m.key !== spec.highlight)) return;
    // Ring members are labelled outwards, away from the body; the core is labelled beneath.
    const len = Math.hypot(center[0], center[1]);
    const dir: [number, number] = len > 0.05 ? [center[0] / len, center[1] / len] : [0, -1];
    // Labels are centred on their anchor, so sideways ones need extra clearance for their width.
    const off = radius * 1.1 + 0.1 + Math.abs(dir[0]) * 0.22;
    labels.push({
      key: m.key, text: m.key, note: spec.notes?.[m.key],
      position: [center[0] + dir[0] * off, center[1] + dir[1] * off, center[2]],
      anchor: "center",
      emphasis: spec.highlight === undefined ? "normal" : m.key === spec.highlight ? "high" : "low", kind: "cluster",
    });
  });
  return { labels, segments: new Float32Array(segments), boost: boostFor(visible) };
}
