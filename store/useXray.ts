"use client";

import { create } from "zustand";
import type { Dataset } from "@/types/domain";
import type { Finding, FindingId, Health } from "@/types/insights";
import { generateDataset } from "@/lib/data/generate";
import { type Answer, type AnswerRow, ask as resolveQuestion, resolveIntent } from "@/lib/ai/answer";
import { describeIntent } from "@/lib/ai/intent";
import { SCAN_STAGES, type ScanContext } from "@/lib/engine/scan";
import { calibrate, type Levers, type Model, NO_CHANGE, presets, sameLevers, type Scenario } from "@/lib/simulation/model";
import { evaluate, recommend } from "@/lib/simulation/decision";
import { setCurrency } from "@/lib/format";
import { stagesOf } from "@/lib/visualization/view";

export type Phase = "landing" | "connect" | "scanning" | "overview" | "answer" | "investigating" | "whatif" | "decision";

interface XrayState {
  data: Dataset | null;
  phase: Phase;
  /** Index of the scan stage in progress. */
  scanIndex: number;
  /** Results reported by each completed scan stage. */
  readouts: string[][];
  findings: Finding[];
  health: Health | null;
  activeId: FindingId | null;
  /** Investigation built from a question (activeId "ask"). */
  asked: Finding | null;
  /** Structured answer to the last question that was not an investigation. */
  answer: Answer | null;
  /** Where closing an investigation returns to. */
  origin: "overview" | "answer";
  hoverId: FindingId | null;
  stage: number;
  /** What-If simulator: calibrated model, current lever settings, scenarios to compare. */
  model: Model | null;
  levers: Levers;
  scenarios: Scenario[];
  reducedMotion: boolean;
  init: () => void;
  /** Opens the data ingestion flow. */
  connect: () => void;
  /** Replaces the business under analysis and scans it. */
  load: (data: Dataset) => void;
  /** Loads the demo business (again, if uploaded data replaced it) and scans it. */
  loadDemo: () => void;
  startScan: () => Promise<void>;
  open: (id: FindingId) => void;
  ask: (question: string) => void;
  openWhatIf: (resolveId?: FindingId) => void;
  setLevers: (levers: Partial<Levers>) => void;
  pinScenario: () => void;
  openDecision: () => void;
  backToWhatIf: () => void;
  follow: (action: NonNullable<AnswerRow["action"]>, label: string) => void;
  hover: (id: FindingId | null) => void;
  goTo: (stage: number) => void;
  next: () => void;
  back: () => void;
  close: () => void;
  restart: () => void;
  setReducedMotion: (value: boolean) => void;
}

const STAGE_MS = 2000;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const useXray = create<XrayState>((set, get) => ({
  data: null,
  phase: "landing",
  scanIndex: 0,
  readouts: [],
  findings: [],
  health: null,
  activeId: null,
  asked: null,
  answer: null,
  origin: "overview",
  hoverId: null,
  stage: 0,
  model: null,
  levers: NO_CHANGE,
  scenarios: [],
  reducedMotion: false,

  init: () => {
    if (!get().data) set({ data: generateDataset() });
  },

  connect: () => {
    get().restart();
    set({ phase: "connect" });
  },
  load: (data) => {
    get().restart();
    setCurrency(data.available?.currency ?? "€");
    set({ data, findings: [], health: null });
    void get().startScan();
  },
  loadDemo: () => {
    const current = get().data;
    get().load(current && !current.available ? current : generateDataset());
  },

  startScan: async () => {
    const { data, phase, reducedMotion } = get();
    if (!data || phase !== "landing") return;
    set({ phase: "scanning", scanIndex: 0, readouts: [] });
    const ctx: ScanContext = {};
    const pace = reducedMotion ? 350 : STAGE_MS;
    for (let i = 0; i < SCAN_STAGES.length; i++) {
      set({ scanIndex: i });
      // Let the stage paint before its analysis occupies the main thread.
      await wait(pace * 0.35);
      const readout = SCAN_STAGES[i].run(data, ctx);
      set({ readouts: [...get().readouts, readout] });
      await wait(pace * 0.65);
    }
    set({ findings: ctx.findings ?? [], health: ctx.health ?? null, phase: "overview" });
  },

  open: (id) => set({ activeId: id, hoverId: null, stage: 0, phase: "investigating", origin: get().phase === "answer" ? "answer" : "overview" }),

  ask: (question) => {
    const { data, findings } = get();
    if (!data || !question.trim()) return;
    const result = resolveQuestion(data, findings, question.trim());
    if (result.type === "answer") set({ answer: result.answer, phase: "answer", activeId: null, hoverId: null });
    else set({ asked: result.finding, activeId: "ask", stage: 0, phase: "investigating", origin: "overview", hoverId: null });
  },

  openWhatIf: (resolveId) => {
    const { data, findings } = get();
    if (!data) return;
    const model = get().model ?? calibrate(data, findings);
    const scenarios = get().scenarios.length ? get().scenarios : presets(model);
    const fix = model.resolvable.find((r) => r.id === resolveId);
    set({ model, scenarios, phase: "whatif", activeId: null, levers: fix ? { ...NO_CHANGE, resolve: 1, resolveId: fix.id } : get().levers });
  },
  setLevers: (levers) => set({ levers: { ...get().levers, ...levers } }),
  pinScenario: () => {
    const { scenarios, levers } = get();
    const custom = scenarios.filter((s) => s.id.startsWith("custom")).length;
    set({ scenarios: [...scenarios, { id: `custom-${custom + 1}`, name: `Your scenario ${custom + 1}`, levers }] });
  },

  openDecision: () => {
    const { scenarios, levers, pinScenario } = get();
    // The settings on screen become an option, so what is decided is always something that was simulated.
    if (!scenarios.some((s) => sameLevers(s.levers, levers))) pinScenario();
    const { model, findings } = get();
    // With nothing simulated yet, open on the most robust option rather than on "no change".
    const start = model && sameLevers(levers, NO_CHANGE) ? recommend(evaluate(model, get().scenarios, findings)).scenario.levers : levers;
    set({ phase: "decision", levers: start });
  },
  backToWhatIf: () => set({ phase: "whatif" }),

  follow: (action, label) => {
    const { data, findings, open } = get();
    if (!data) return;
    if ("finding" in action) return open(action.finding);
    const result = resolveIntent(data, findings, label || describeIntent(action.intent), action.intent);
    if (result.type === "answer") set({ answer: result.answer, phase: "answer" });
    else set({ asked: result.finding, activeId: "ask", stage: 0, phase: "investigating", origin: "answer" });
  },
  hover: (id) => set({ hoverId: id }),
  goTo: (stage) => set({ stage }),
  next: () => {
    const f = activeFinding(get());
    if (f) set({ stage: Math.min(get().stage + 1, stagesOf(f).length - 1) });
  },
  back: () => {
    if (get().stage === 0) get().close();
    else set({ stage: get().stage - 1 });
  },
  close: () => set({ phase: get().phase === "investigating" && get().origin === "answer" && get().answer ? "answer" : "overview", activeId: null, stage: 0 }),
  restart: () => set({ phase: "landing", activeId: null, asked: null, answer: null, model: null, scenarios: [], levers: NO_CHANGE, hoverId: null, stage: 0, readouts: [], scanIndex: 0 }),
  setReducedMotion: (value) => set({ reducedMotion: value }),
}));

export const activeFinding = (s: Pick<XrayState, "findings" | "activeId" | "asked">): Finding | null =>
  s.activeId === "ask" ? s.asked : (s.findings.find((f) => f.id === s.activeId) ?? null);
