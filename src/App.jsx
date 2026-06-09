import { useState, useMemo } from "react";

// ── TRIAGE ENGINE ─────────────────────────────────────────────────────────────
// This is the core ML logic. It mirrors what a real annotation quality gate
// would do in production: combine multiple signal quality indicators into
// a single actionable decision with an explainable reason.

const SNR_REJECT_THRESHOLD = 12;      // dB — below this, signal too noisy
const DRIFT_REVIEW_THRESHOLD = 0.45;  // above this, distribution has shifted
const CONF_REVIEW_THRESHOLD = 0.72;   // below this, classifier is uncertain

function triageSession(session) {
  // Rule 1: Signal quality gate
  // If SNR is too low, the radar data is dominated by noise.
  // Even a human annotator can't reliably label it.
  // Annotating noisy sessions adds label noise to training data = worse models.
  if (session.snr_db < SNR_REJECT_THRESHOLD) {
    return {
      decision: "REJECT",
      reason: `SNR ${session.snr_db.toFixed(1)} dB is below minimum threshold (${SNR_REJECT_THRESHOLD} dB). Signal too noisy for reliable annotation.`,
      primary_factor: "signal_quality",
      confidence_in_decision: 0.95,
    };
  }

  // Rule 2: Distribution drift gate
  // Z-score based: if this session's feature distribution is far from
  // the training baseline, the classifier's confidence scores are unreliable.
  // A session can have high classifier confidence but still be drifted —
  // the model is confidently wrong on out-of-distribution data.
  if (session.drift_score > DRIFT_REVIEW_THRESHOLD) {
    return {
      decision: "REVIEW",
      reason: `Distribution drift score ${session.drift_score.toFixed(3)} exceeds threshold (${DRIFT_REVIEW_THRESHOLD}). Session features deviate from training baseline — classifier confidence may be unreliable.`,
      primary_factor: "distribution_drift",
      confidence_in_decision: 0.82,
    };
  }

  // Rule 3: Classifier confidence gate
  // Low confidence = the model saw something it wasn't sure about.
  // These are the most valuable sessions to have a human review —
  // they often contain edge cases that improve the model when annotated.
  if (session.classifier_confidence < CONF_REVIEW_THRESHOLD) {
    return {
      decision: "REVIEW",
      reason: `Classifier confidence ${(session.classifier_confidence * 100).toFixed(1)}% is below threshold (${(CONF_REVIEW_THRESHOLD * 100).toFixed(0)}%). Human review needed — may be a valuable edge case for training.`,
      primary_factor: "low_confidence",
      confidence_in_decision: 0.78,
    };
  }

  // All gates passed: safe to auto-label
  return {
    decision: "AUTO_APPROVE",
    reason: `SNR ${session.snr_db.toFixed(1)} dB (✓), drift ${session.drift_score.toFixed(3)} (✓), confidence ${(session.classifier_confidence * 100).toFixed(1)}% (✓). All quality gates passed.`,
    primary_factor: "all_clear",
    confidence_in_decision: session.classifier_confidence,
  };
}

// ── DATA GENERATION ───────────────────────────────────────────────────────────
// Simulates realistic radar session data that Cherish's pipeline would produce.
// In production, these features would be extracted from raw point cloud data.

function seededRng(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

const EVENT_TYPES = ["breathing_rate", "presence_detection", "fall_event", "motion_pattern"];
const EVENT_WEIGHTS = [0.40, 0.32, 0.10, 0.18];
const DEVICES = Array.from({ length: 12 }, (_, i) => `RDR-${String(i + 1).padStart(3, "0")}`);
const LOCATIONS = ["Bedroom", "Living Room", "Bathroom", "Hallway", "Kitchen"];

function generateSessions(n = 120) {
  const rng = seededRng(2026);
  const sessions = [];
  const now = Date.now();

  for (let i = 0; i < n; i++) {
    const r = rng();
    let event = EVENT_TYPES[3], cum = 0;
    for (let j = 0; j < EVENT_WEIGHTS.length; j++) {
      cum += EVENT_WEIGHTS[j];
      if (r < cum) { event = EVENT_TYPES[j]; break; }
    }

    // Realistic SNR distribution: most sessions decent, some noisy
    // Fall events tend to have lower SNR (brief, rapid movement)
    const baseSNR = event === "fall_event" ? 13 : 19;
    const snr = Math.max(5, Math.min(32, baseSNR + (rng() - 0.5) * 14));

    // Drift: older sessions and some devices have more drift
    const deviceDrift = parseInt(DEVICES[Math.floor(rng() * DEVICES.length)].split("-")[1]) > 9 ? 0.2 : 0;
    const drift = Math.max(0, Math.min(0.95, 0.15 + rng() * 0.5 + deviceDrift));

    // Confidence: correlated with SNR (better signal = more confident classifier)
    const conf = Math.max(0.4, Math.min(0.99, (snr / 32) * 0.6 + rng() * 0.4));

    // Point cloud density: sparse = noisy environment
    const density = Math.round(50 + rng() * 450);

    sessions.push({
      id: `S${String(i + 1).padStart(5, "0")}`,
      timestamp: new Date(now - Math.floor(rng() * 86400000)),
      device: DEVICES[Math.floor(rng() * DEVICES.length)],
      location: LOCATIONS[Math.floor(rng() * LOCATIONS.length)],
      event_type: event,
      snr_db: Math.round(snr * 10) / 10,
      classifier_confidence: Math.round(conf * 1000) / 1000,
      drift_score: Math.round(drift * 1000) / 1000,
      duration_sec: Math.round(15 + rng() * 285),
      point_cloud_density: density,
      motion_variance: Math.round((0.1 + rng() * 0.9) * 1000) / 1000,
    });
  }

  return sessions.sort((a, b) => b.timestamp - a.timestamp);
}

// ── STYLING CONSTANTS ─────────────────────────────────────────────────────────
const COLORS = {
  bg: "#07090f",
  surface: "#0d1117",
  border: "#1e2535",
  borderAccent: "#1e3a5f",
  text: "#e2e8f0",
  textMuted: "#64748b",
  textDim: "#475569",
  blue: "#3b82f6",
  cyan: "#06b6d4",
  green: "#22c55e",
  yellow: "#f59e0b",
  red: "#ef4444",
  purple: "#a78bfa",
};

const DECISION_CONFIG = {
  AUTO_APPROVE: { color: COLORS.green, bg: "#052e16", border: "#166534", label: "AUTO-APPROVE", icon: "✓" },
  REVIEW: { color: COLORS.yellow, bg: "#1c1400", border: "#78350f", label: "REVIEW", icon: "⚑" },
  REJECT: { color: COLORS.red, bg: "#1a0505", border: "#7f1d1d", label: "REJECT", icon: "✕" },
};

const FACTOR_LABELS = {
  signal_quality: "Signal Quality",
  distribution_drift: "Distribution Drift",
  low_confidence: "Low Confidence",
  all_clear: "All Gates Passed",
};

const EVENT_COLORS = {
  breathing_rate: COLORS.cyan,
  presence_detection: COLORS.blue,
  fall_event: COLORS.red,
  motion_pattern: COLORS.yellow,
};

const EVENT_LABELS = {
  breathing_rate: "Breathing",
  presence_detection: "Presence",
  fall_event: "Fall",
  motion_pattern: "Motion",
};

// ── SUB COMPONENTS ────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color, accent }) {
  return (
    <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "16px 18px", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: accent || `linear-gradient(90deg, ${COLORS.blue}, ${COLORS.cyan})` }} />
      <div style={{ fontSize: "0.65rem", fontWeight: 700, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: "1.9rem", fontWeight: 700, color: color || COLORS.text, fontFamily: "monospace", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: "0.72rem", color: COLORS.textMuted, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function DecisionBadge({ decision }) {
  const c = DECISION_CONFIG[decision];
  return (
    <span style={{ padding: "3px 8px", borderRadius: 4, fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.06em", background: c.bg, color: c.color, border: `1px solid ${c.border}` }}>
      {c.icon} {c.label}
    </span>
  );
}

function EventBadge({ type }) {
  const color = EVENT_COLORS[type] || COLORS.textMuted;
  return (
    <span style={{ padding: "2px 7px", borderRadius: 4, fontSize: "0.63rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", background: color + "18", color, border: `1px solid ${color}40` }}>
      {EVENT_LABELS[type]}
    </span>
  );
}

function QualityBar({ value, max = 1, thresholdPct, color }) {
  const pct = (value / (max || 1)) * 100;
  const barColor = color || (pct > 70 ? COLORS.green : pct > 40 ? COLORS.yellow : COLORS.red);
  return (
    <div style={{ position: "relative" }}>
      <div style={{ background: "#1e293b", borderRadius: 3, height: 5, overflow: "visible", position: "relative" }}>
        <div style={{ height: "100%", width: `${Math.min(100, pct)}%`, background: barColor, borderRadius: 3, transition: "width 0.3s" }} />
        {thresholdPct && (
          <div style={{ position: "absolute", top: -3, left: `${thresholdPct}%`, width: 1, height: 11, background: COLORS.red, opacity: 0.7 }} />
        )}
      </div>
    </div>
  );
}

function SectionHeader({ children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      <span style={{ fontSize: "0.62rem", fontWeight: 700, color: COLORS.blue, textTransform: "uppercase", letterSpacing: "0.14em", whiteSpace: "nowrap" }}>{children}</span>
      <div style={{ flex: 1, height: 1, background: COLORS.border }} />
    </div>
  );
}

function TriageReason({ triage }) {
  const c = DECISION_CONFIG[triage.decision];
  return (
    <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderLeft: `3px solid ${c.color}`, borderRadius: 7, padding: "10px 14px", fontSize: "0.78rem", color: "#cbd5e1", lineHeight: 1.5 }}>
      <span style={{ color: c.color, fontWeight: 600, marginRight: 6 }}>{FACTOR_LABELS[triage.primary_factor]}:</span>
      {triage.reason}
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [sessions] = useState(() => generateSessions(120));
  const [activeTab, setActiveTab] = useState("queue");
  const [selectedSession, setSelectedSession] = useState(null);
  const [decisionFilter, setDecisionFilter] = useState("all");
  const [eventFilter, setEventFilter] = useState("all");

  // Run every session through the triage engine
  const triaged = useMemo(() => sessions.map(s => ({ ...s, triage: triageSession(s) })), [sessions]);

  // Statistics
  const stats = useMemo(() => {
    const approved = triaged.filter(s => s.triage.decision === "AUTO_APPROVE").length;
    const review = triaged.filter(s => s.triage.decision === "REVIEW").length;
    const rejected = triaged.filter(s => s.triage.decision === "REJECT").length;
    const reviewQueue = triaged.filter(s => s.triage.decision === "REVIEW");
    const fallsInQueue = reviewQueue.filter(s => s.event_type === "fall_event").length;
    return { approved, review, rejected, total: triaged.length, reviewQueue, fallsInQueue };
  }, [triaged]);

  // Filtered sessions for explorer
  const filtered = useMemo(() => triaged.filter(s =>
    (decisionFilter === "all" || s.triage.decision === decisionFilter) &&
    (eventFilter === "all" || s.event_type === eventFilter)
  ), [triaged, decisionFilter, eventFilter]);

  // Review queue sorted by priority: fall events first, then by drift score
  const prioritizedQueue = useMemo(() => [...stats.reviewQueue].sort((a, b) => {
    if (a.event_type === "fall_event" && b.event_type !== "fall_event") return -1;
    if (b.event_type === "fall_event" && a.event_type !== "fall_event") return 1;
    return b.triage.drift_score - a.triage.drift_score;
  }), [stats.reviewQueue]);

  const tabs = [
    { id: "queue", label: "⚑ Review Queue" },
    { id: "overview", label: "📊 Pipeline Overview" },
    { id: "explorer", label: "🔍 Session Explorer" },
    { id: "how", label: "📖 How It Works" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg, color: COLORS.text, fontFamily: "'Inter', -apple-system, sans-serif", padding: "28px 36px" }}>

      {/* Header */}
      <div style={{ paddingBottom: 24, borderBottom: `1px solid ${COLORS.border}`, marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: "0.65rem", fontWeight: 700, color: COLORS.blue, textTransform: "uppercase", letterSpacing: "0.1em", background: "#0a1628", padding: "3px 10px", borderRadius: 4, border: `1px solid ${COLORS.borderAccent}` }}>📡 Cherish Health</span>
          <span style={{ fontSize: "0.72rem", color: COLORS.textMuted }}>Radar Data Annotation Pipeline · Quality Gatekeeper</span>
        </div>
        <h1 style={{ fontSize: "2rem", fontWeight: 700, color: "#f0f9ff", letterSpacing: "-0.02em", margin: "0 0 8px 0" }}>Annotation Triage System</h1>
        <p style={{ fontSize: "0.86rem", color: COLORS.textMuted, maxWidth: 640, lineHeight: 1.65, margin: "0 0 12px 0" }}>
          Automatically routes incoming radar sessions to <strong style={{ color: COLORS.green }}>auto-label</strong>, <strong style={{ color: COLORS.yellow }}>human review</strong>, or <strong style={{ color: COLORS.red }}>reject</strong> — so annotators spend time only on sessions that matter.
          Every decision is explained.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: "0.75rem", color: COLORS.textMuted }}>
          <span><span style={{ color: COLORS.green, fontWeight: 600 }}>{((stats.approved / stats.total) * 100).toFixed(0)}%</span> auto-approved</span>
          <span><span style={{ color: COLORS.yellow, fontWeight: 600 }}>{stats.review}</span> in review queue</span>
          <span><span style={{ color: COLORS.red, fontWeight: 600 }}>{stats.rejected}</span> rejected</span>
          <span style={{ color: COLORS.textDim }}>|</span>
          <span style={{ color: COLORS.red, fontWeight: 600 }}>⚠ {stats.fallsInQueue} fall events need immediate review</span>
        </div>
      </div>

      {/* KPI Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 28 }}>
        <StatCard label="Total Sessions" value={stats.total} sub="Last 24 hours" />
        <StatCard label="Auto-Approved" value={stats.approved} sub={`${((stats.approved / stats.total) * 100).toFixed(0)}% of pipeline`} color={COLORS.green} accent={`linear-gradient(90deg, ${COLORS.green}, ${COLORS.cyan})`} />
        <StatCard label="Needs Review" value={stats.review} sub={`${stats.fallsInQueue} fall events`} color={COLORS.yellow} accent={`linear-gradient(90deg, ${COLORS.yellow}, ${COLORS.red})`} />
        <StatCard label="Rejected" value={stats.rejected} sub="Low SNR or corrupt" color={COLORS.red} accent={`linear-gradient(90deg, ${COLORS.red}, #f97316)`} />
        <StatCard label="Annotator Hours Saved" value={`~${Math.round(stats.approved * 0.8 + stats.rejected * 0.5)}m`} sub="vs reviewing everything" color={COLORS.purple} accent={`linear-gradient(90deg, ${COLORS.purple}, ${COLORS.blue})`} />
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 22, borderBottom: `1px solid ${COLORS.border}` }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{ background: activeTab === t.id ? COLORS.surface : "transparent", color: activeTab === t.id ? COLORS.blue : COLORS.textMuted, border: "none", borderBottom: `2px solid ${activeTab === t.id ? COLORS.blue : "transparent"}`, borderRadius: "6px 6px 0 0", padding: "8px 16px", fontSize: "0.82rem", fontWeight: 500, cursor: "pointer" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* TAB: Review Queue */}
      {activeTab === "queue" && (
        <div>
          <SectionHeader>Prioritized Review Queue · {stats.review} Sessions</SectionHeader>
          <p style={{ fontSize: "0.8rem", color: COLORS.textMuted, marginBottom: 16, lineHeight: 1.5 }}>
            Fall events are surfaced first regardless of other scores — a missed fall is a patient safety issue. Within each event type, sessions are ranked by drift score: high drift sessions are the most valuable for improving the model.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {prioritizedQueue.map((s, idx) => (
              <div key={s.id} onClick={() => setSelectedSession(selectedSession?.id === s.id ? null : s)} style={{ background: COLORS.surface, border: `1px solid ${selectedSession?.id === s.id ? COLORS.blue : COLORS.border}`, borderRadius: 9, padding: "12px 16px", cursor: "pointer", transition: "border-color 0.15s" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: selectedSession?.id === s.id ? 12 : 0 }}>
                  <span style={{ color: COLORS.textDim, fontSize: "0.72rem", fontFamily: "monospace", minWidth: 28 }}>#{idx + 1}</span>
                  <span style={{ color: COLORS.textMuted, fontSize: "0.72rem", fontFamily: "monospace", minWidth: 75 }}>{s.id}</span>
                  <EventBadge type={s.event_type} />
                  <span style={{ color: COLORS.textDim, fontSize: "0.72rem", minWidth: 95 }}>{s.device}</span>
                  <span style={{ color: COLORS.textDim, fontSize: "0.72rem", minWidth: 100 }}>{s.location}</span>

                  <div style={{ display: "flex", gap: 16, marginLeft: "auto", alignItems: "center" }}>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "0.63rem", color: COLORS.textDim, marginBottom: 2 }}>SNR</div>
                      <div style={{ fontSize: "0.8rem", fontFamily: "monospace", color: s.snr_db >= SNR_REJECT_THRESHOLD ? COLORS.green : COLORS.red }}>{s.snr_db} dB</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "0.63rem", color: COLORS.textDim, marginBottom: 2 }}>Drift</div>
                      <div style={{ fontSize: "0.8rem", fontFamily: "monospace", color: s.drift_score > DRIFT_REVIEW_THRESHOLD ? COLORS.yellow : COLORS.green }}>{s.drift_score.toFixed(3)}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "0.63rem", color: COLORS.textDim, marginBottom: 2 }}>Confidence</div>
                      <div style={{ fontSize: "0.8rem", fontFamily: "monospace", color: s.classifier_confidence >= CONF_REVIEW_THRESHOLD ? COLORS.green : COLORS.yellow }}>{(s.classifier_confidence * 100).toFixed(1)}%</div>
                    </div>
                    <span style={{ fontSize: "0.7rem", color: COLORS.textMuted, fontFamily: "monospace", minWidth: 55 }}>{s.timestamp.toLocaleTimeString("en-US", { hour12: false })}</span>
                    <span style={{ color: selectedSession?.id === s.id ? COLORS.blue : COLORS.textDim, fontSize: "0.8rem" }}>{selectedSession?.id === s.id ? "▲" : "▼"}</span>
                  </div>
                </div>

                {selectedSession?.id === s.id && (
                  <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 12 }}>
                    <TriageReason triage={s.triage} />
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 12 }}>
                      {[
                        { label: "SNR (dB)", value: s.snr_db, max: 32, threshold: (SNR_REJECT_THRESHOLD / 32) * 100, color: s.snr_db >= SNR_REJECT_THRESHOLD ? COLORS.green : COLORS.red },
                        { label: "Drift Score", value: s.drift_score, max: 1, threshold: DRIFT_REVIEW_THRESHOLD * 100, color: s.drift_score > DRIFT_REVIEW_THRESHOLD ? COLORS.yellow : COLORS.green },
                        { label: "Confidence", value: s.classifier_confidence, max: 1, threshold: CONF_REVIEW_THRESHOLD * 100, color: s.classifier_confidence >= CONF_REVIEW_THRESHOLD ? COLORS.green : COLORS.yellow },
                        { label: "Point Density", value: s.point_cloud_density, max: 500, color: s.point_cloud_density > 200 ? COLORS.green : COLORS.yellow },
                      ].map(m => (
                        <div key={m.label} style={{ background: "#0a0e18", borderRadius: 6, padding: "8px 10px" }}>
                          <div style={{ fontSize: "0.63rem", color: COLORS.textDim, marginBottom: 4 }}>{m.label}</div>
                          <div style={{ fontSize: "0.9rem", fontFamily: "monospace", color: m.color, marginBottom: 5 }}>{typeof m.value === "number" && m.value < 2 ? (m.value * 100).toFixed(1) + "%" : m.value}</div>
                          <QualityBar value={m.value} max={m.max} thresholdPct={m.threshold} color={m.color} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB: Pipeline Overview */}
      {activeTab === "overview" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
            <div>
              <SectionHeader>Triage Decision Breakdown</SectionHeader>
              {[
                ["AUTO-APPROVE", stats.approved, COLORS.green, "#052e16", "#166534"],
                ["REVIEW", stats.review, COLORS.yellow, "#1c1400", "#78350f"],
                ["REJECT", stats.rejected, COLORS.red, "#1a0505", "#7f1d1d"],
              ].map(([label, count, color, bg, border]) => (
                <div key={label} style={{ background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: "12px 16px", marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <span style={{ fontSize: "0.72rem", fontWeight: 700, color, letterSpacing: "0.08em" }}>{label}</span>
                    <div style={{ fontSize: "0.78rem", color: "#94a3b8", marginTop: 3 }}>
                      {label === "AUTO-APPROVE" && "Signal quality, drift, and confidence all within bounds"}
                      {label === "REVIEW" && "One or more quality signals need human verification"}
                      {label === "REJECT" && "SNR below minimum — annotation would add label noise"}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "1.5rem", fontWeight: 700, color, fontFamily: "monospace" }}>{count}</div>
                    <div style={{ fontSize: "0.72rem", color: "#64748b" }}>{((count / stats.total) * 100).toFixed(0)}%</div>
                  </div>
                </div>
              ))}
            </div>

            <div>
              <SectionHeader>Why Each Decision Was Made</SectionHeader>
              {["signal_quality", "distribution_drift", "low_confidence", "all_clear"].map(factor => {
                const count = triaged.filter(s => s.triage.primary_factor === factor).length;
                const pct = (count / stats.total) * 100;
                const color = factor === "all_clear" ? COLORS.green : factor === "signal_quality" ? COLORS.red : COLORS.yellow;
                return (
                  <div key={factor} style={{ marginBottom: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: "0.78rem" }}>
                      <span style={{ color: "#94a3b8" }}>{FACTOR_LABELS[factor]}</span>
                      <span style={{ color, fontFamily: "monospace" }}>{count} sessions · {pct.toFixed(0)}%</span>
                    </div>
                    <div style={{ background: "#1e293b", borderRadius: 3, height: 6, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3 }} />
                    </div>
                  </div>
                );
              })}

              <div style={{ marginTop: 20, background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "14px 16px" }}>
                <div style={{ fontSize: "0.72rem", fontWeight: 600, color: COLORS.blue, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Annotator Time Saved</div>
                <div style={{ fontSize: "0.82rem", color: "#94a3b8", lineHeight: 1.6 }}>
                  Without triage: annotators review <strong style={{ color: COLORS.text }}>{stats.total} sessions</strong><br />
                  With triage: annotators review <strong style={{ color: COLORS.yellow }}>{stats.review} sessions</strong><br />
                  <strong style={{ color: COLORS.green }}>{stats.approved + stats.rejected} sessions</strong> handled automatically<br />
                  Estimated time saved: <strong style={{ color: COLORS.purple }}>~{Math.round((stats.approved * 0.8 + stats.rejected * 0.5) / 60)} hours/day</strong>
                </div>
              </div>
            </div>
          </div>

          <SectionHeader>Quality Signal Distribution Across All Sessions</SectionHeader>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
            {[
              { label: "SNR Distribution", key: "snr_db", max: 32, threshold: SNR_REJECT_THRESHOLD, unit: "dB", buckets: 8 },
              { label: "Drift Score Distribution", key: "drift_score", max: 1, threshold: DRIFT_REVIEW_THRESHOLD, unit: "", buckets: 10 },
              { label: "Confidence Distribution", key: "classifier_confidence", max: 1, threshold: CONF_REVIEW_THRESHOLD, unit: "%", buckets: 10 },
            ].map(({ label, key, max, threshold, unit, buckets }) => {
              const vals = triaged.map(s => s[key]);
              const hist = Array.from({ length: buckets }, (_, i) => {
                const lo = (i / buckets) * max, hi = ((i + 1) / buckets) * max;
                return { lo, hi, count: vals.filter(v => v >= lo && v < hi).length };
              });
              const maxCount = Math.max(...hist.map(h => h.count));
              return (
                <div key={key} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 9, padding: "14px 16px" }}>
                  <div style={{ fontSize: "0.7rem", fontWeight: 600, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>{label}</div>
                  <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 80 }}>
                    {hist.map((h, i) => {
                      const isThreshold = h.lo <= threshold && h.hi > threshold;
                      const isPast = h.lo >= threshold;
                      const barColor = !isPast ? COLORS.red + "90" : COLORS.green + "90";
                      return (
                        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                          <div style={{ width: "100%", height: `${(h.count / maxCount) * 72}px`, background: barColor, borderRadius: "2px 2px 0 0", border: isThreshold ? `1px solid ${COLORS.red}` : "none" }} />
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.62rem", color: COLORS.textDim, marginTop: 4 }}>
                    <span>0{unit}</span>
                    <span style={{ color: COLORS.red }}>threshold: {threshold}{unit}</span>
                    <span>{max}{unit}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
  )
}

{/* TAB: Session Explorer */ }
{
  activeTab === "explorer" && (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
        {[
          ["Decision", decisionFilter, setDecisionFilter, [["all", "All decisions"], ["AUTO_APPROVE", "Auto-approved"], ["REVIEW", "Needs review"], ["REJECT", "Rejected"]]],
          ["Event Type", eventFilter, setEventFilter, [["all", "All events"], ...EVENT_TYPES.map(t => [t, EVENT_LABELS[t]])]],
        ].map(([label, val, setter, options]) => (
          <div key={label}>
            <div style={{ fontSize: "0.65rem", fontWeight: 600, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>{label}</div>
            <select value={val} onChange={e => setter(e.target.value)} style={{ width: "100%", background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.text, padding: "7px 10px", fontSize: "0.82rem" }}>
              {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        ))}
      </div>

      <div style={{ fontSize: "0.72rem", color: COLORS.textDim, marginBottom: 10 }}>{filtered.length} sessions</div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.76rem" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
              {["ID", "Time", "Device", "Event", "SNR (dB)", "Drift", "Confidence", "Decision", "Primary Factor"].map(h => (
                <th key={h} style={{ padding: "7px 10px", textAlign: "left", color: COLORS.textDim, fontWeight: 600, fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.08em", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 40).map(s => (
              <tr key={s.id} style={{ borderBottom: `1px solid #0a0e18` }}>
                <td style={{ padding: "6px 10px", color: COLORS.textMuted, fontFamily: "monospace" }}>{s.id}</td>
                <td style={{ padding: "6px 10px", color: COLORS.textDim, whiteSpace: "nowrap" }}>{s.timestamp.toLocaleTimeString("en-US", { hour12: false })}</td>
                <td style={{ padding: "6px 10px", color: COLORS.textMuted, fontFamily: "monospace" }}>{s.device}</td>
                <td style={{ padding: "6px 10px" }}><EventBadge type={s.event_type} /></td>
                <td style={{ padding: "6px 10px", color: s.snr_db >= SNR_REJECT_THRESHOLD ? COLORS.green : COLORS.red, fontFamily: "monospace" }}>{s.snr_db}</td>
                <td style={{ padding: "6px 10px", color: s.drift_score > DRIFT_REVIEW_THRESHOLD ? COLORS.yellow : COLORS.textDim, fontFamily: "monospace" }}>{s.drift_score.toFixed(3)}</td>
                <td style={{ padding: "6px 10px", color: s.classifier_confidence >= CONF_REVIEW_THRESHOLD ? COLORS.green : COLORS.yellow, fontFamily: "monospace" }}>{(s.classifier_confidence * 100).toFixed(1)}%</td>
                <td style={{ padding: "6px 10px" }}><DecisionBadge decision={s.triage.decision} /></td>
                <td style={{ padding: "6px 10px", color: COLORS.textDim, fontSize: "0.7rem" }}>{FACTOR_LABELS[s.triage.primary_factor]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

{/* TAB: How It Works */ }
{
  activeTab === "how" && (
    <div style={{ maxWidth: 720 }}>
      <SectionHeader>The Annotation Bottleneck Problem</SectionHeader>
      <p style={{ fontSize: "0.86rem", color: "#94a3b8", lineHeight: 1.7, marginBottom: 20 }}>
        Cherish collects radar data in-house from devices deployed in people's homes. As the number of devices scales up, the volume of incoming sessions grows faster than a human annotation team can review. The core problem is not data collection — it is annotation throughput.
      </p>

      <SectionHeader>The Three Quality Gates</SectionHeader>
      {[
        {
          title: "Gate 1: Signal Quality (SNR)",
          color: COLORS.red,
          content: `Signal-to-Noise Ratio measures how strong the actual radar reflection is compared to background noise. A session with SNR below ${SNR_REJECT_THRESHOLD} dB is dominated by noise — even a human annotator cannot reliably label what happened. Annotating these sessions adds incorrect labels to the training dataset, which degrades model performance. These sessions are rejected immediately.`
        },
        {
          title: "Gate 2: Distribution Drift",
          color: COLORS.yellow,
          content: `When a device is installed in a new environment — tile walls, a different room geometry, furniture placement — the statistical distribution of its radar data shifts from the training baseline. The classifier may produce high-confidence predictions on out-of-distribution data, but those predictions are unreliable. Drift is detected by comparing session feature statistics against the baseline using Z-score analysis. Drifted sessions are flagged for human review — they are also the most valuable sessions to annotate, as they expand the training distribution.`
        },
        {
          title: "Gate 3: Classifier Confidence",
          color: COLORS.blue,
          content: `Low classifier confidence indicates the model encountered something ambiguous — a posture, movement, or environmental condition it has not seen enough of during training. These sessions are the highest-value annotation targets: they represent genuine edge cases that, once labeled and added to training data, most improve model performance. They are surfaced to human annotators as a priority.`
        },
      ].map(({ title, color, content }) => (
        <div key={title} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderLeft: `3px solid ${color}`, borderRadius: 8, padding: "14px 18px", marginBottom: 12 }}>
          <div style={{ fontSize: "0.82rem", fontWeight: 600, color, marginBottom: 6 }}>{title}</div>
          <div style={{ fontSize: "0.82rem", color: "#94a3b8", lineHeight: 1.65 }}>{content}</div>
        </div>
      ))}

      <SectionHeader style={{ marginTop: 20 }}>Priority Ordering in the Review Queue</SectionHeader>
      <p style={{ fontSize: "0.86rem", color: "#94a3b8", lineHeight: 1.7 }}>
        Fall events are surfaced first regardless of other quality scores — a missed or incorrectly labeled fall event is a patient safety issue with real consequences. Within each event type, sessions are ordered by drift score: the more a session deviates from the training distribution, the more valuable its annotation.
      </p>
    </div>
  )
}

{/* Footer */ }
      <div style={{ marginTop: 44, paddingTop: 18, borderTop: `1px solid ${COLORS.border}`, display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "#334155" }}>
        <span>Built by <strong style={{ color: COLORS.textMuted }}>Anju Vilashni Nandhakumar</strong> · MS AI, Northeastern University</span>
        <a href="https://www.vxanju.com" style={{ color: COLORS.blue, textDecoration: "none" }}>www.vxanju.com</a>
      </div>

      <style>{`
        * { box-sizing: border-box; }
        select option { background: #0d1117; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #0a0e18; }
        ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 3px; }
      `}</style>
    </div >
  );
}