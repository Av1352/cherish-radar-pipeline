import { useState, useEffect, useCallback } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, ScatterChart, Scatter } from "recharts";

// ── Data Generation ────────────────────────────────────────────────────────
const EVENT_TYPES = ["breathing_rate", "presence_detection", "fall_event", "motion_pattern"];
const EVENT_COLORS = { breathing_rate: "#22d3ee", presence_detection: "#3b82f6", fall_event: "#f87171", motion_pattern: "#fbbf24" };
const EVENT_LABELS = { breathing_rate: "Breathing", presence_detection: "Presence", fall_event: "Fall", motion_pattern: "Motion" };
const LOCATIONS = ["Bedroom", "Living Room", "Bathroom", "Hallway", "Kitchen"];
const DEVICES = Array.from({ length: 12 }, (_, i) => `RDR-${String(i + 1).padStart(3, "0")}`);

function seededRandom(seed) {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
}

function generateSessions(count = 200) {
  const rng = seededRandom(Date.now() % 10000 + 42);
  const now = Date.now();
  const weights = [0.45, 0.30, 0.08, 0.17];
  const sessions = [];

  for (let i = 0; i < count; i++) {
    const r = rng();
    let eventType, cum = 0;
    for (let j = 0; j < weights.length; j++) { cum += weights[j]; if (r < cum) { eventType = EVENT_TYPES[j]; break; } }
    eventType = eventType || EVENT_TYPES[3];

    const baseQuality = { breathing_rate: 0.87, presence_detection: 0.92, fall_event: 0.78, motion_pattern: 0.83 };
    const quality = Math.min(1, Math.max(0.3, baseQuality[eventType] + (rng() - 0.5) * 0.16));
    const autoConf = Math.min(1, Math.max(0.4, quality * 0.95 + (rng() - 0.5) * 0.1));
    const needsReview = autoConf < 0.75 || eventType === "fall_event";
    const ageMs = rng() * 43200000;
    const driftScore = Math.max(0, (rng() * 0.3) + (ageMs / 43200000) * 0.15);

    sessions.push({
      id: `S${String(i + 1).padStart(5, "0")}`,
      timestamp: new Date(now - ageMs),
      device: DEVICES[Math.floor(rng() * DEVICES.length)],
      location: LOCATIONS[Math.floor(rng() * LOCATIONS.length)],
      eventType,
      quality: Math.round(quality * 1000) / 1000,
      autoConf: Math.round(autoConf * 1000) / 1000,
      needsReview,
      driftScore: Math.round(driftScore * 1000) / 1000,
      snrDb: Math.round((15 + rng() * 12) * 10) / 10,
      status: !needsReview ? "auto_labeled" : rng() > 0.35 ? "pending" : "reviewed",
    });
  }

  return sessions.sort((a, b) => b.timestamp - a.timestamp);
}

function generateThroughput() {
  const rng = seededRandom(99);
  return Array.from({ length: 24 }, (_, i) => {
    const h = new Date(); h.setHours(h.getHours() - (23 - i));
    const peak = h.getHours() >= 8 && h.getHours() <= 20;
    return { hour: `${String(h.getHours()).padStart(2, "0")}:00`, sessions: Math.round(50 + rng() * 60 + (peak ? 20 : -10)), quality: Math.round((0.78 + rng() * 0.16) * 1000) / 1000 };
  });
}

// ── Sub Components ─────────────────────────────────────────────────────────

function MetricCard({ label, value, delta, deltaPositive, accent }) {
  return (
    <div style={{ background: "linear-gradient(135deg, #0f172a 0%, #1a2540 100%)", border: "1px solid #1e3a5f", borderRadius: 12, padding: "18px 20px", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: accent || "linear-gradient(90deg, #3b82f6, #06b6d4)" }} />
      <div style={{ fontSize: "0.68rem", fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: "2rem", fontWeight: 700, color: "#f0f9ff", fontFamily: "'JetBrains Mono', monospace", lineHeight: 1, marginBottom: 4 }}>{value}</div>
      {delta && <div style={{ fontSize: "0.75rem", color: deltaPositive ? "#22c55e" : "#ef4444", fontFamily: "monospace" }}>{delta}</div>}
    </div>
  );
}

function EventBadge({ type }) {
  const colors = { fall_event: { bg: "#450a0a", color: "#fca5a5", border: "#7f1d1d" }, presence_detection: { bg: "#0a2540", color: "#7dd3fc", border: "#1e3a5f" }, breathing_rate: { bg: "#0a2520", color: "#6ee7b7", border: "#064e3b" }, motion_pattern: { bg: "#2d1a00", color: "#fcd34d", border: "#78350f" } };
  const c = colors[type] || colors.motion_pattern;
  return <span style={{ padding: "2px 7px", borderRadius: 4, fontSize: "0.65rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", background: c.bg, color: c.color, border: `1px solid ${c.border}` }}>{EVENT_LABELS[type]}</span>;
}

function StatusBadge({ status }) {
  const map = { auto_labeled: { color: "#22c55e", label: "auto-labeled" }, pending: { color: "#f59e0b", label: "pending" }, reviewed: { color: "#3b82f6", label: "reviewed" } };
  const s = map[status] || map.pending;
  return <span style={{ fontSize: "0.72rem", color: s.color, fontFamily: "monospace" }}>{s.label}</span>;
}

function SectionHeader({ children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      <span style={{ fontSize: "0.65rem", fontWeight: 700, color: "#3b82f6", textTransform: "uppercase", letterSpacing: "0.12em", whiteSpace: "nowrap" }}>{children}</span>
      <div style={{ flex: 1, height: 1, background: "#1e293b" }} />
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0f172a", border: "1px solid #1e3a5f", borderRadius: 8, padding: "8px 12px", fontSize: "0.78rem", color: "#cbd5e1" }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => <div key={i} style={{ color: p.color }}>{p.name}: {typeof p.value === "number" && p.value < 2 ? p.value.toFixed(3) : p.value}</div>)}
    </div>
  );
};

// ── Main Dashboard ─────────────────────────────────────────────────────────
export default function App() {
  const [sessions] = useState(() => generateSessions(200));
  const [throughput] = useState(() => generateThroughput());
  const [activeTab, setActiveTab] = useState("ingestion");
  const [tick, setTick] = useState(0);
  const [eventFilter, setEventFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [deviceFilter, setDeviceFilter] = useState("all");

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 3000);
    return () => clearInterval(interval);
  }, []);

  const totalSessions = sessions.length;
  const autoLabeled = sessions.filter(s => s.status === "auto_labeled").length;
  const pending = sessions.filter(s => s.status === "pending").length;
  const avgQuality = (sessions.reduce((a, s) => a + s.quality, 0) / totalSessions).toFixed(3);
  const driftFlagged = sessions.filter(s => s.driftScore > 0.3).length;
  const fallEvents = sessions.filter(s => s.eventType === "fall_event").length;

  const eventDist = EVENT_TYPES.map(t => ({ name: EVENT_LABELS[t], value: sessions.filter(s => s.eventType === t).length, color: EVENT_COLORS[t] }));

  const confBuckets = Array.from({ length: 10 }, (_, i) => {
    const lo = i * 0.1, hi = lo + 0.1;
    const bucket = { range: `${lo.toFixed(1)}–${hi.toFixed(1)}` };
    EVENT_TYPES.forEach(t => { bucket[t] = sessions.filter(s => s.eventType === t && s.autoConf >= lo && s.autoConf < hi).length; });
    return bucket;
  });

  const driftByDevice = DEVICES.map(d => {
    const devSessions = sessions.filter(s => s.device === d && s.driftScore > 0.3);
    if (!devSessions.length) return null;
    return { device: d, count: devSessions.length, avgDrift: (devSessions.reduce((a, s) => a + s.driftScore, 0) / devSessions.length).toFixed(3), avgQuality: (devSessions.reduce((a, s) => a + s.quality, 0) / devSessions.length).toFixed(3) };
  }).filter(Boolean).sort((a, b) => b.avgDrift - a.avgDrift);

  const filteredSessions = sessions.filter(s => (eventFilter === "all" || s.eventType === eventFilter) && (statusFilter === "all" || s.status === statusFilter) && (deviceFilter === "all" || s.device === deviceFilter));

  const tabs = [{ id: "ingestion", label: "📥 Ingestion" }, { id: "labeling", label: "🏷 Labeling Queue" }, { id: "quality", label: "📊 Quality & Drift" }, { id: "explorer", label: "🔍 Session Explorer" }];

  return (
    <div style={{ minHeight: "100vh", background: "#080d18", color: "#e2e8f0", fontFamily: "'Inter', -apple-system, sans-serif", padding: "32px 40px" }}>

      {/* Header */}
      <div style={{ paddingBottom: 28, borderBottom: "1px solid #1e293b", marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "#3b82f6", textTransform: "uppercase", letterSpacing: "0.1em", background: "#0a1628", padding: "3px 10px", borderRadius: 4, border: "1px solid #1e3a5f" }}>📡 Radar Health Monitoring</span>
          <span style={{ fontSize: "0.72rem", color: "#475569" }}>Cherish Health · Pipeline Operations</span>
        </div>
        <h1 style={{ fontSize: "2.2rem", fontWeight: 700, color: "#f0f9ff", letterSpacing: "-0.02em", lineHeight: 1.1, margin: "0 0 8px 0" }}>Data Pipeline Monitor</h1>
        <p style={{ fontSize: "0.88rem", color: "#64748b", maxWidth: 620, lineHeight: 1.6, margin: "0 0 14px 0" }}>
          Real-time visibility into radar session ingestion, automated labeling confidence, quality scoring, and distribution drift — built to support scaling in-home health monitoring operations.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", display: "inline-block", animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: "0.78rem", color: "#22c55e", fontWeight: 500 }}>Pipeline Active</span>
          <span style={{ fontSize: "0.72rem", color: "#475569", marginLeft: 8 }}>Refreshes every 3s</span>
        </div>
      </div>

      {/* KPI Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14, marginBottom: 32 }}>
        <MetricCard label="Sessions (24h)" value={totalSessions} delta="↑ 12% vs yesterday" deltaPositive />
        <MetricCard label="Auto-labeled" value={autoLabeled} delta={`${(autoLabeled / totalSessions * 100).toFixed(0)}% coverage`} deltaPositive accent="linear-gradient(90deg, #22c55e, #06b6d4)" />
        <MetricCard label="Pending Review" value={pending} delta={pending > 20 ? "↑ needs attention" : "✓ within SLA"} deltaPositive={pending <= 20} accent="linear-gradient(90deg, #f59e0b, #ef4444)" />
        <MetricCard label="Avg Quality" value={avgQuality} delta="Target: 0.850" deltaPositive={parseFloat(avgQuality) >= 0.85} accent={parseFloat(avgQuality) >= 0.85 ? "linear-gradient(90deg, #22c55e, #3b82f6)" : "linear-gradient(90deg, #f59e0b, #ef4444)"} />
        <MetricCard label="Drift Flagged" value={driftFlagged} delta={driftFlagged > 10 ? "⚠ review distribution" : "✓ stable"} deltaPositive={driftFlagged <= 10} accent={driftFlagged > 10 ? "linear-gradient(90deg, #ef4444, #f59e0b)" : "linear-gradient(90deg, #22c55e, #06b6d4)"} />
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "1px solid #1e293b" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{ background: activeTab === t.id ? "#0f172a" : "transparent", color: activeTab === t.id ? "#3b82f6" : "#64748b", border: "none", borderBottom: activeTab === t.id ? "2px solid #3b82f6" : "2px solid transparent", borderRadius: "6px 6px 0 0", padding: "8px 16px", fontSize: "0.82rem", fontWeight: 500, cursor: "pointer", transition: "all 0.15s" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: Ingestion */}
      {activeTab === "ingestion" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20, marginBottom: 28 }}>
            <div>
              <SectionHeader>Session Throughput · Last 24 Hours</SectionHeader>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={throughput} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                  <XAxis dataKey="hour" tick={{ fill: "#475569", fontSize: 11 }} axisLine={false} tickLine={false} interval={3} />
                  <YAxis tick={{ fill: "#475569", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Line type="monotone" dataKey="sessions" stroke="#3b82f6" strokeWidth={2} dot={false} name="Sessions" />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div>
              <SectionHeader>Event Distribution</SectionHeader>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={eventDist} cx="50%" cy="50%" innerRadius={55} outerRadius={80} dataKey="value" stroke="none">
                    {eventDist.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [v, n]} contentStyle={{ background: "#0f172a", border: "1px solid #1e3a5f", borderRadius: 8, fontSize: 12, color: "#cbd5e1" }} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                {eventDist.map(e => (
                  <div key={e.name} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.72rem", color: "#94a3b8" }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: e.color }} />
                    {e.name} ({e.value})
                  </div>
                ))}
              </div>
            </div>
          </div>

          <SectionHeader>Recent Ingestion Feed</SectionHeader>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {sessions.slice(0, 10).map(s => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 14, background: "#0d1424", border: "1px solid #1e293b", borderRadius: 8, padding: "9px 14px", fontFamily: "monospace", fontSize: "0.78rem" }}>
                <span style={{ color: "#475569", minWidth: 70 }}>{s.timestamp.toLocaleTimeString("en-US", { hour12: false })}</span>
                <EventBadge type={s.eventType} />
                <span style={{ color: "#64748b", minWidth: 80 }}>{s.device}</span>
                <span style={{ color: "#475569", minWidth: 100 }}>{s.location}</span>
                <span style={{ color: s.quality >= 0.85 ? "#22c55e" : s.quality >= 0.70 ? "#f59e0b" : "#ef4444", minWidth: 90 }}>Q: {s.quality.toFixed(3)}</span>
                <StatusBadge status={s.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab: Labeling Queue */}
      {activeTab === "labeling" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20, marginBottom: 24 }}>
            <div>
              <SectionHeader>Auto-Label Confidence Distribution</SectionHeader>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={confBuckets} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                  <XAxis dataKey="range" tick={{ fill: "#475569", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#475569", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  {EVENT_TYPES.map(t => <Bar key={t} dataKey={t} stackId="a" fill={EVENT_COLORS[t]} name={EVENT_LABELS[t]} />)}
                </BarChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 6, fontSize: "0.72rem", color: "#ef4444", fontFamily: "monospace" }}>
                <span style={{ width: 20, borderBottom: "1px dashed #ef4444", display: "inline-block" }} /> Review threshold: 0.75
              </div>
            </div>
            <div>
              <SectionHeader>Queue Breakdown</SectionHeader>
              {[["Auto-labeled", autoLabeled, "#22c55e"], ["Pending review", pending, "#f59e0b"], ["Human reviewed", totalSessions - autoLabeled - pending, "#3b82f6"]].map(([label, count, color]) => (
                <div key={label} style={{ marginBottom: 18 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, fontSize: "0.78rem" }}>
                    <span style={{ color: "#94a3b8" }}>{label}</span>
                    <span style={{ color, fontFamily: "monospace" }}>{count} · {(count / totalSessions * 100).toFixed(0)}%</span>
                  </div>
                  <div style={{ background: "#1e293b", borderRadius: 4, height: 5, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${count / totalSessions * 100}%`, background: color, borderRadius: 4 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <SectionHeader>Sessions Requiring Review</SectionHeader>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #1e293b" }}>
                  {["Session", "Time", "Device", "Event", "Confidence", "Quality", "Location"].map(h => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#475569", fontWeight: 600, fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessions.filter(s => s.status === "pending").slice(0, 10).map(s => (
                  <tr key={s.id} style={{ borderBottom: "1px solid #0f172a" }}>
                    <td style={{ padding: "8px 12px", color: "#64748b", fontFamily: "monospace" }}>{s.id}</td>
                    <td style={{ padding: "8px 12px", color: "#475569" }}>{s.timestamp.toLocaleTimeString("en-US", { hour12: false })}</td>
                    <td style={{ padding: "8px 12px", color: "#64748b", fontFamily: "monospace" }}>{s.device}</td>
                    <td style={{ padding: "8px 12px" }}><EventBadge type={s.eventType} /></td>
                    <td style={{ padding: "8px 12px", color: s.autoConf < 0.65 ? "#ef4444" : "#f59e0b", fontFamily: "monospace" }}>{s.autoConf.toFixed(3)}</td>
                    <td style={{ padding: "8px 12px", color: s.quality >= 0.85 ? "#22c55e" : "#f59e0b", fontFamily: "monospace" }}>{s.quality.toFixed(3)}</td>
                    <td style={{ padding: "8px 12px", color: "#64748b" }}>{s.location}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Quality & Drift */}
      {activeTab === "quality" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
            <div>
              <SectionHeader>Avg Quality Score · 24h</SectionHeader>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={throughput} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                  <XAxis dataKey="hour" tick={{ fill: "#475569", fontSize: 11 }} axisLine={false} tickLine={false} interval={3} />
                  <YAxis domain={[0.6, 1.0]} tick={{ fill: "#475569", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Line type="monotone" dataKey="quality" stroke="#06b6d4" strokeWidth={2} dot={false} name="Avg quality" />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div>
              <SectionHeader>Quality by Event Type</SectionHeader>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 8 }}>
                {EVENT_TYPES.map(t => {
                  const avg = sessions.filter(s => s.eventType === t).reduce((a, s) => a + s.quality, 0) / sessions.filter(s => s.eventType === t).length;
                  return (
                    <div key={t}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: "0.78rem" }}>
                        <span style={{ color: "#94a3b8" }}>{EVENT_LABELS[t]}</span>
                        <span style={{ color: EVENT_COLORS[t], fontFamily: "monospace" }}>{avg.toFixed(3)}</span>
                      </div>
                      <div style={{ background: "#1e293b", borderRadius: 4, height: 6, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${avg * 100}%`, background: EVENT_COLORS[t], borderRadius: 4 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <SectionHeader>Distribution Drift Alerts by Device</SectionHeader>
          {driftByDevice.length > 0 ? driftByDevice.slice(0, 6).map(d => (
            <div key={d.device} style={{ background: parseFloat(d.avgDrift) > 0.5 ? "linear-gradient(135deg, #1a0a0a, #2d1515)" : "linear-gradient(135deg, #0a1a0a, #152d15)", border: `1px solid ${parseFloat(d.avgDrift) > 0.5 ? "#7f1d1d" : "#064e3b"}`, borderLeft: `3px solid ${parseFloat(d.avgDrift) > 0.5 ? "#ef4444" : "#22c55e"}`, borderRadius: 8, padding: "10px 14px", marginBottom: 8, display: "flex", alignItems: "center", gap: 16, fontSize: "0.8rem" }}>
              <span style={{ fontWeight: 600, color: parseFloat(d.avgDrift) > 0.5 ? "#fca5a5" : "#6ee7b7", fontFamily: "monospace", minWidth: 90 }}>{parseFloat(d.avgDrift) > 0.5 ? "⚠ " : "↗ "}{d.device}</span>
              <span style={{ color: "#94a3b8" }}>Drift: <b style={{ fontFamily: "monospace", color: "#e2e8f0" }}>{d.avgDrift}</b></span>
              <span style={{ color: "#64748b" }}>{d.count} flagged sessions</span>
              <span style={{ color: "#94a3b8" }}>Avg quality: <b style={{ fontFamily: "monospace", color: "#e2e8f0" }}>{d.avgQuality}</b></span>
            </div>
          )) : (
            <div style={{ background: "linear-gradient(135deg, #0a1a0a, #152d15)", border: "1px solid #064e3b", borderLeft: "3px solid #22c55e", borderRadius: 8, padding: "12px 16px", color: "#6ee7b7", fontWeight: 600 }}>✓ No drift detected — all devices within normal distribution bounds.</div>
          )}
        </div>
      )}

      {/* Tab: Session Explorer */}
      {activeTab === "explorer" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
            {[
              ["Event Type", eventFilter, setEventFilter, ["all", ...EVENT_TYPES], (v) => v === "all" ? "All events" : EVENT_LABELS[v] || v],
              ["Label Status", statusFilter, setStatusFilter, ["all", "auto_labeled", "pending", "reviewed"], (v) => v === "all" ? "All statuses" : v.replace("_", " ")],
              ["Device", deviceFilter, setDeviceFilter, ["all", ...DEVICES], (v) => v === "all" ? "All devices" : v],
            ].map(([label, val, setter, options, fmt]) => (
              <div key={label}>
                <div style={{ fontSize: "0.68rem", fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>{label}</div>
                <select value={val} onChange={e => setter(e.target.value)} style={{ width: "100%", background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, color: "#e2e8f0", padding: "7px 10px", fontSize: "0.82rem", cursor: "pointer" }}>
                  {options.map(o => <option key={o} value={o}>{fmt(o)}</option>)}
                </select>
              </div>
            ))}
          </div>

          <div style={{ fontSize: "0.75rem", color: "#475569", marginBottom: 12 }}>{filteredSessions.length} sessions matching filters</div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #1e293b" }}>
                  {["Session", "Time", "Device", "Location", "Event", "Quality", "Confidence", "Status", "Drift", "SNR (dB)"].map(h => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#475569", fontWeight: 600, fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.08em", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredSessions.slice(0, 30).map(s => (
                  <tr key={s.id} style={{ borderBottom: "1px solid #0a0e18" }}>
                    <td style={{ padding: "7px 12px", color: "#64748b", fontFamily: "monospace" }}>{s.id}</td>
                    <td style={{ padding: "7px 12px", color: "#475569", whiteSpace: "nowrap" }}>{s.timestamp.toLocaleTimeString("en-US", { hour12: false })}</td>
                    <td style={{ padding: "7px 12px", color: "#64748b", fontFamily: "monospace" }}>{s.device}</td>
                    <td style={{ padding: "7px 12px", color: "#475569" }}>{s.location}</td>
                    <td style={{ padding: "7px 12px" }}><EventBadge type={s.eventType} /></td>
                    <td style={{ padding: "7px 12px", color: s.quality >= 0.85 ? "#22c55e" : "#f59e0b", fontFamily: "monospace" }}>{s.quality.toFixed(3)}</td>
                    <td style={{ padding: "7px 12px", color: s.autoConf >= 0.75 ? "#94a3b8" : "#ef4444", fontFamily: "monospace" }}>{s.autoConf.toFixed(3)}</td>
                    <td style={{ padding: "7px 12px" }}><StatusBadge status={s.status} /></td>
                    <td style={{ padding: "7px 12px", color: s.driftScore > 0.3 ? "#ef4444" : "#475569", fontFamily: "monospace" }}>{s.driftScore.toFixed(3)}</td>
                    <td style={{ padding: "7px 12px", color: "#64748b", fontFamily: "monospace" }}>{s.snrDb}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop: 48, paddingTop: 20, borderTop: "1px solid #1e293b", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.72rem", color: "#334155" }}>
        <span>Built by <strong style={{ color: "#64748b" }}>Anju Vilashni Nandhakumar</strong> · MS AI, Northeastern University</span>
        <a href="https://www.vxanju.com" style={{ color: "#3b82f6", textDecoration: "none" }}>www.vxanju.com</a>
      </div>

      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
    </div>
  );
}