import { useState, useMemo, useCallback, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";

const COLORS = ["#E8443A", "#2563EB", "#16A34A", "#D97706", "#8B5CF6", "#EC4899"];

function loadStateFromURL() {
  try {
    const params = new URLSearchParams(window.location.search);
    const data = params.get("d");
    if (!data) return null;
    return JSON.parse(decodeURIComponent(atob(data)));
  } catch (e) { return null; }
}

function FormattedNumberInput({ value, onChange, ...rest }) {
  const [isFocused, setIsFocused] = useState(false);
  const [raw, setRaw] = useState("");
  const formatted = value != null && value !== "" ? Number(value).toLocaleString("en-US") : "";
  const handleFocus = useCallback(() => { setIsFocused(true); setRaw(value != null && value !== 0 ? String(value) : ""); }, [value]);
  const handleBlur = useCallback(() => { setIsFocused(false); const num = parseFloat(raw.replace(/,/g, "")); if (!isNaN(num)) onChange(num); else if (raw === "") onChange(0); }, [raw, onChange]);
  const handleChange = useCallback((e) => { const v = e.target.value.replace(/,/g, ""); if (v === "" || v === "-" || /^-?\d*\.?\d*$/.test(v)) { setRaw(v); const num = parseFloat(v); if (!isNaN(num)) onChange(num); } }, [onChange]);
  return <input type="text" inputMode="decimal" value={isFocused ? raw : formatted} onFocus={handleFocus} onBlur={handleBlur} onChange={handleChange} {...rest} />;
}

const defaultProposals = [
  { id: 1, name: "הצעה נוכחית", depositFee: 6, accumulatedFee: 0.5 },
  { id: 2, name: "הצעה חדשה", depositFee: 1.49, accumulatedFee: 0.01 },
];

function formatCurrency(val) {
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(val);
}
function formatPercent(val) { return val.toFixed(2) + "%"; }

export default function PensionCalculator() {
  const initial = typeof window !== "undefined" ? loadStateFromURL() : null;
  const [proposals, setProposals] = useState(initial?.proposals || defaultProposals);
  const [salary, setSalary] = useState(initial?.salary ?? 26000);
  const [employeePct, setEmployeePct] = useState(initial?.employeePct ?? 6);
  const [employerPct, setEmployerPct] = useState(initial?.employerPct ?? 6.5);
  const [severancePct, setSeverancePct] = useState(initial?.severancePct ?? 6);
  const [currentBalance, setCurrentBalance] = useState(initial?.currentBalance ?? 300000);
  const [annualReturn, setAnnualReturn] = useState(initial?.annualReturn ?? 4);
  const [nextId, setNextId] = useState(initial?.proposals ? Math.max(...initial.proposals.map((p) => p.id)) + 1 : 3);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Sync state to URL (works when self-hosted)
  useEffect(() => {
    try {
      const state = { proposals, salary, employeePct, employerPct, severancePct, currentBalance, annualReturn };
      const encoded = btoa(encodeURIComponent(JSON.stringify(state)));
      window.history.replaceState(null, "", `${window.location.pathname}?d=${encoded}`);
    } catch (e) {}
  }, [proposals, salary, employeePct, employerPct, severancePct, currentBalance, annualReturn]);

  const totalPct = employeePct + employerPct + severancePct;
  const monthlyDeposit = Math.round(salary * (totalPct / 100));
  const YEARS = 30;

  const addProposal = () => { setProposals([...proposals, { id: nextId, name: `הצעה ${nextId}`, depositFee: 0, accumulatedFee: 0 }]); setNextId(nextId + 1); };
  const removeProposal = (id) => { if (proposals.length > 1) setProposals(proposals.filter((p) => p.id !== id)); };
  const updateProposal = (id, field, value) => { setProposals(proposals.map((p) => (p.id === id ? { ...p, [field]: value } : p))); };

  const annualFeesData = useMemo(() => {
    const months = YEARS * 12, monthlyReturn = annualReturn / 100 / 12;
    let maxBal = currentBalance;
    const ts = proposals.map(() => ({ balance: currentBalance }));
    for (let m = 1; m <= months; m++) {
      proposals.forEach((p, i) => { ts[i].balance += monthlyDeposit * (1 - p.depositFee / 100); ts[i].balance -= ts[i].balance * (p.accumulatedFee / 100 / 12); ts[i].balance *= 1 + monthlyReturn; if (ts[i].balance > maxBal) maxBal = ts[i].balance; });
    }
    const steps = 80, data = [], ad = monthlyDeposit * 12;
    for (let s = 0; s <= steps; s++) {
      const bal = (maxBal * s) / steps, point = { balance: Math.round(bal) };
      proposals.forEach((p) => { point[`annual_${p.id}`] = Math.round(ad * (p.depositFee / 100) + bal * (p.accumulatedFee / 100)); });
      data.push(point);
    }
    return data;
  }, [proposals, monthlyDeposit, annualReturn, currentBalance]);

  const crossovers = useMemo(() => {
    if (proposals.length < 2 || annualFeesData.length < 2) return [];
    const results = [];
    for (let i = 1; i < annualFeesData.length; i++) {
      const prev = annualFeesData[i - 1], curr = annualFeesData[i];
      for (let a = 0; a < proposals.length; a++) {
        for (let b = a + 1; b < proposals.length; b++) {
          const ka = `annual_${proposals[a].id}`, kb = `annual_${proposals[b].id}`;
          const dP = prev[ka] - prev[kb], dC = curr[ka] - curr[kb];
          if (dP * dC < 0) { const r = Math.abs(dP) / (Math.abs(dP) + Math.abs(dC)); results.push({ balance: Math.round(prev.balance + r * (curr.balance - prev.balance)), between: [proposals[a], proposals[b]] }); }
        }
      }
    }
    return results;
  }, [annualFeesData, proposals]);

  const recommendations = useMemo(() => {
    if (proposals.length < 2) return null;
    const ad = monthlyDeposit * 12;
    const costsNow = proposals.map((p) => ({ ...p, annualFee: ad * (p.depositFee / 100) + currentBalance * (p.accumulatedFee / 100) })).sort((a, b) => a.annualFee - b.annualFee);
    const best = costsNow[0], bestColor = COLORS[proposals.findIndex((p) => p.id === best.id) % COLORS.length];
    const fc = crossovers.filter((c) => c.balance > currentBalance).sort((a, b) => a.balance - b.balance);
    let nextCrossover = null;
    if (fc.length > 0) {
      const cross = fc[0]; const mr = annualReturn / 100 / 12;
      let bal = currentBalance, months = 0;
      const adf = proposals.reduce((s, p) => s + p.depositFee, 0) / proposals.length;
      const aaf = proposals.reduce((s, p) => s + p.accumulatedFee, 0) / proposals.length;
      while (bal < cross.balance && months < YEARS * 12) { bal += monthlyDeposit * (1 - adf / 100); bal -= bal * (aaf / 100 / 12); bal *= 1 + mr; months++; }
      const yrs = Math.floor(months / 12), mos = months % 12;
      const timeStr = yrs > 0 ? (mos > 0 ? `${yrs} שנים ו-${mos} חודשים` : `${yrs} שנים`) : `${mos} חודשים`;
      const ca = proposals.map((p) => ({ ...p, annualFee: ad * (p.depositFee / 100) + cross.balance * (p.accumulatedFee / 100) })).sort((a, b) => a.annualFee - b.annualFee);
      nextCrossover = { balance: cross.balance, timeStr, cheapestAfter: ca[0], cheapestAfterColor: COLORS[proposals.findIndex((p) => p.id === ca[0].id) % COLORS.length] };
    }
    return { best, bestColor, nextCrossover, costsNow };
  }, [proposals, currentBalance, monthlyDeposit, annualReturn, crossovers]);

  const balanceChartData = useMemo(() => {
    const months = YEARS * 12, mr = annualReturn / 100 / 12, data = [];
    const state = proposals.map(() => ({ balance: currentBalance, totalFees: 0 }));
    for (let m = 0; m <= months; m++) {
      const point = { month: m, year: (m / 12).toFixed(1) };
      proposals.forEach((p, i) => {
        if (m > 0) { const df = monthlyDeposit * (p.depositFee / 100); state[i].totalFees += df; state[i].balance += monthlyDeposit - df; const af = state[i].balance * (p.accumulatedFee / 100 / 12); state[i].totalFees += af; state[i].balance -= af; state[i].balance *= 1 + mr; }
        point[`balance_${p.id}`] = Math.round(state[i].balance); point[`fees_${p.id}`] = Math.round(state[i].totalFees);
      });
      if (m % 3 === 0) data.push(point);
    }
    return data;
  }, [proposals, monthlyDeposit, annualReturn, currentBalance]);

  const summary = useMemo(() => {
    if (!balanceChartData.length) return [];
    const last = balanceChartData[balanceChartData.length - 1];
    return proposals.map((p, i) => ({ ...p, totalFees: last[`fees_${p.id}`] || 0, finalBalance: last[`balance_${p.id}`] || 0, color: COLORS[i % COLORS.length] })).sort((a, b) => a.totalFees - b.totalFees);
  }, [balanceChartData, proposals]);

  const bestProposal = summary.length ? summary[0] : null;
  const worstProposal = summary.length ? summary[summary.length - 1] : null;
  const savings = bestProposal && worstProposal ? worstProposal.totalFees - bestProposal.totalFees : 0;

  const tooltipStyle = { background: "#1E293B", border: "1px solid #334155", borderRadius: 10, direction: "rtl", textAlign: "right" };

  return (
    <div dir="rtl" style={{ fontFamily: "'Rubik', 'Heebo', sans-serif", background: "#0B1120", color: "#E2E8F0", minHeight: "100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rubik:wght@300;400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        input[type="number"], input[type="text"] {
          background: #1E293B; border: 1px solid #334155; color: #E2E8F0;
          border-radius: 6px; padding: 6px 10px; font-family: inherit; font-size: 13px;
          width: 100%; transition: border-color 0.2s;
        }
        input:focus { outline: none; border-color: #60A5FA; }
        .card { background: linear-gradient(145deg, #1E293B 0%, #162032 100%); border: 1px solid #1E3A5F; border-radius: 14px; padding: 18px; }
        .btn { background: #2563EB; color: white; border: none; border-radius: 8px; padding: 6px 14px; font-family: inherit; font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
        .btn:hover { background: #3B82F6; }
        .btn-x { background: transparent; color: #F87171; border: 1px solid #7F1D1D; border-radius: 6px; padding: 2px 8px; font-size: 12px; cursor: pointer; font-family: inherit; transition: all 0.2s; line-height: 1.4; }
        .btn-x:hover { background: #7F1D1D; color: white; }
        label { font-size: 11px; color: #94A3B8; margin-bottom: 3px; display: block; font-weight: 500; }
        .winner-tag { display: inline-block; background: #10B981; color: #022c22; padding: 1px 8px; border-radius: 20px; font-size: 10px; font-weight: 700; margin-right: 4px; }
        .adv-toggle { background: none; border: 1px solid #334155; color: #94A3B8; border-radius: 6px; padding: 6px 12px; font-family: inherit; font-size: 12px; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; gap: 6px; width: 100%; justify-content: center; }
        .adv-toggle:hover { border-color: #60A5FA; color: #E2E8F0; }
        .rec-card { background: #0F1A2E; border-radius: 10px; padding: 12px; border: 1px solid #1E3A5F; }
        .savings-badge { background: linear-gradient(135deg, #065F46 0%, #064E3B 100%); border: 1px solid #10B981; border-radius: 10px; padding: 12px 18px; display: inline-flex; align-items: center; gap: 8px; }
        .two-col { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr); gap: 16px; align-items: start; }
        .proposal-row {
          display: grid; grid-template-columns: 1.2fr 0.8fr 0.8fr auto;
          gap: 8px; align-items: end; padding: 10px 12px;
          background: #0F1A2E; border-radius: 10px; border: 1px solid #1E293B;
          transition: border-color 0.2s;
        }
        .proposal-row:hover { border-color: #334155; }
        @media (max-width: 900px) {
          .two-col { grid-template-columns: 1fr; }
        }
        @media (max-width: 500px) {
          .proposal-row { grid-template-columns: 1fr 1fr; }
        }
      `}</style>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 16px" }}>
        {/* Header */}
        <div style={{ marginBottom: 24, textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "#60A5FA", fontWeight: 600, letterSpacing: 2, marginBottom: 6 }}>PENSION FEE ANALYZER</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#F1F5F9", marginBottom: 4 }}>מחשבון דמי ניהול פנסיה</h1>
          <p style={{ color: "#64748B", fontSize: 13 }}>השוו בין הצעות וגלו כמה תחסכו לאורך השנים</p>
        </div>

        <div className="two-col">
          {/* RIGHT COLUMN - Inputs, Recommendations, Summary */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Parameters */}
            <div className="card">
              <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "#94A3B8" }}>⚙️ פרמטרים</h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div><label>שכר ברוטו חודשי (₪)</label><FormattedNumberInput value={salary} onChange={setSalary} /></div>
                <div><label>צבירה נוכחית (₪)</label><FormattedNumberInput value={currentBalance} onChange={setCurrentBalance} /></div>
              </div>
              <div style={{ marginTop: 10, padding: "8px 10px", background: "#0F1A2E", borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                <span style={{ fontSize: 12, color: "#64748B" }}>הפרשה: <span style={{ color: "#60A5FA", fontWeight: 600 }}>{totalPct.toFixed(1)}%</span></span>
                <span style={{ fontSize: 12, color: "#64748B" }}>הפקדה חודשית: <span style={{ color: "#10B981", fontWeight: 700, fontSize: 14 }}>{formatCurrency(monthlyDeposit)}</span></span>
              </div>
              <div style={{ marginTop: 10 }}>
                <button className="adv-toggle" onClick={() => setAdvancedOpen(!advancedOpen)}>
                  הגדרות מתקדמות
                  <span style={{ transform: advancedOpen ? "rotate(-90deg)" : "rotate(180deg)", transition: "transform 0.2s", display: "inline-block", fontSize: 9 }}>▶</span>
                </button>
                {advancedOpen && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
                    <div><label>הפרשת עובד (%)</label><input type="number" value={employeePct} onChange={(e) => setEmployeePct(+e.target.value)} min={0} max={7} step={0.5} /></div>
                    <div><label>מעסיק — תגמולים (%)</label><input type="number" value={employerPct} onChange={(e) => setEmployerPct(+e.target.value)} min={0} max={7.5} step={0.5} /></div>
                    <div><label>מעסיק — פיצויים (%)</label><input type="number" value={severancePct} onChange={(e) => setSeverancePct(+e.target.value)} min={0} max={8.33} step={0.5} /></div>
                    <div><label>תשואה שנתית (%)</label><input type="number" value={annualReturn} onChange={(e) => setAnnualReturn(+e.target.value)} min={0} max={20} step={0.5} /></div>
                  </div>
                )}
              </div>
            </div>

            {/* Proposals */}
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <h2 style={{ fontSize: 14, fontWeight: 600, color: "#94A3B8" }}>📋 הצעות</h2>
                <button className="btn" onClick={addProposal}>+ הוסף</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {proposals.map((p, i) => (
                  <div key={p.id} className="proposal-row" style={{ borderRight: `3px solid ${COLORS[i % COLORS.length]}` }}>
                    <div><label>שם</label><input type="text" value={p.name} onChange={(e) => updateProposal(p.id, "name", e.target.value)} /></div>
                    <div><label>מהפקדה %</label><input type="number" value={p.depositFee} onChange={(e) => updateProposal(p.id, "depositFee", +e.target.value)} min={0} max={10} step={0.01} /></div>
                    <div><label>מצבירה %</label><input type="number" value={p.accumulatedFee} onChange={(e) => updateProposal(p.id, "accumulatedFee", +e.target.value)} min={0} max={2} step={0.01} /></div>
                    <div style={{ paddingBottom: 1 }}><button className="btn-x" onClick={() => removeProposal(p.id)} disabled={proposals.length <= 1}>✕</button></div>
                  </div>
                ))}
              </div>
            </div>

            {/* Recommendations */}
            {recommendations && (
              <div className="card">
                <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: "#94A3B8" }}>🎯 המלצה</h2>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div className="rec-card" style={{ borderRight: `3px solid ${recommendations.bestColor}` }}>
                    <div style={{ fontSize: 12, color: "#64748B", marginBottom: 4 }}>ההצעה המשתלמת ביותר כרגע</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#10B981" }}>{recommendations.best.name}</div>
                    <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 3 }}>
                      דמי ניהול שנתיים: {formatCurrency(recommendations.best.annualFee)}
                      {recommendations.costsNow.length > 1 && <span style={{ color: "#64748B" }}> (חיסכון {formatCurrency(recommendations.costsNow[recommendations.costsNow.length - 1].annualFee - recommendations.best.annualFee)}/שנה)</span>}
                    </div>
                  </div>
                  {recommendations.nextCrossover ? (
                    <div className="rec-card" style={{ borderRight: "3px solid #F59E0B" }}>
                      <div style={{ fontSize: 12, color: "#64748B", marginBottom: 4 }}>נקודת החלטה הבאה</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#F59E0B" }}>בצבירה של {formatCurrency(recommendations.nextCrossover.balance)}</div>
                      <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 3 }}>בעוד כ-{recommendations.nextCrossover.timeStr}</div>
                      <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>
                        אחרי: <span style={{ color: recommendations.nextCrossover.cheapestAfterColor, fontWeight: 600 }}>{recommendations.nextCrossover.cheapestAfter.name}</span> הופכת למשתלמת יותר
                      </div>
                    </div>
                  ) : (
                    <div className="rec-card" style={{ borderRight: "3px solid #10B981" }}>
                      <div style={{ fontSize: 12, color: "#64748B", marginBottom: 3 }}>נקודת החלטה הבאה</div>
                      <div style={{ fontSize: 13, color: "#6EE7B7" }}>✓ "{recommendations.best.name}" נשארת המשתלמת לכל טווח הצבירה</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Savings */}
            {savings > 0 && (
              <div style={{ textAlign: "center" }}>
                <div className="savings-badge">
                  <span style={{ fontSize: 20 }}>💰</span>
                  <div>
                    <div style={{ fontSize: 12, color: "#6EE7B7" }}>חיסכון ב-{YEARS} שנים עם "{bestProposal.name}"</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: "#10B981" }}>{formatCurrency(savings)}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Summary Table */}
            <div className="card">
              <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: "#94A3B8" }}>📊 סיכום — {YEARS} שנים</h2>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 4px", fontSize: 13 }}>
                  <thead>
                    <tr style={{ fontSize: 11, color: "#64748B" }}>
                      <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 500 }}>הצעה</th>
                      <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 500 }}>הפקדה</th>
                      <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 500 }}>צבירה</th>
                      <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 500 }}>סה״כ דמ״נ</th>
                      <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 500 }}>יתרה</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((p, i) => (
                      <tr key={p.id} style={{ background: i === 0 ? "rgba(16,185,129,0.08)" : "#0F1A2E" }}>
                        <td style={{ padding: "8px", borderRadius: "0 8px 8px 0", borderRight: `3px solid ${p.color}` }}>
                          <span style={{ fontWeight: 600 }}>{p.name}</span>
                          {i === 0 && <span className="winner-tag">הכי משתלם</span>}
                        </td>
                        <td style={{ padding: "8px" }}>{formatPercent(p.depositFee)}</td>
                        <td style={{ padding: "8px" }}>{formatPercent(p.accumulatedFee)}</td>
                        <td style={{ padding: "8px", fontWeight: 600, color: i === 0 ? "#10B981" : "#F87171" }}>{formatCurrency(p.totalFees)}</td>
                        <td style={{ padding: "8px", borderRadius: "8px 0 0 8px", fontWeight: 600 }}>{formatCurrency(p.finalBalance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* LEFT COLUMN - Graphs */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Annual Fees Chart */}
            <div className="card">
              <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: "#94A3B8" }}>📈 דמי ניהול שנתיים לפי צבירה</h2>
              <p style={{ fontSize: 11, color: "#64748B", marginBottom: 12 }}>ציר X = סכום הצבירה{currentBalance > 0 ? ". הקו המקווקו = הצבירה הנוכחית." : "."}</p>
              <div style={{ width: "100%", height: 340 }}>
                <ResponsiveContainer>
                  <LineChart data={annualFeesData} margin={{ top: 20, right: 10, left: 10, bottom: 10 }}>
                    <XAxis dataKey="balance" stroke="#475569" tick={{ fill: "#94A3B8", fontSize: 11 }}
                      tickFormatter={(v) => (v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v)}
                      label={{ value: "₪ צבירה", position: "insideBottom", offset: -5, fill: "#64748B", fontSize: 11 }}
                      interval={Math.floor(annualFeesData.length / 6)}
                    />
                    <YAxis stroke="#475569" tick={{ fill: "#94A3B8", fontSize: 11 }}
                      tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v)}
                      label={{ value: "₪ שנתי", angle: 90, position: "insideRight", offset: 10, fill: "#64748B", fontSize: 11 }}
                    />
                    {currentBalance > 0 && <ReferenceLine x={currentBalance} stroke="#60A5FA" strokeDasharray="6 4" strokeWidth={1.5} label={{ value: "הצבירה שלי", fill: "#60A5FA", fontSize: 10, position: "top" }} />}
                    <Tooltip
                      formatter={(v, name) => { const p = proposals.find((p) => `annual_${p.id}` === name); return [formatCurrency(v), p ? p.name : name]; }}
                      labelFormatter={(l) => `צבירה: ${formatCurrency(l)}`}
                      contentStyle={tooltipStyle} itemStyle={{ color: "#E2E8F0", direction: "rtl" }} labelStyle={{ color: "#94A3B8", marginBottom: 4, direction: "rtl", textAlign: "right" }}
                    />
                    <Legend formatter={(v) => { const p = proposals.find((p) => `annual_${p.id}` === v); return p ? p.name : v; }} wrapperStyle={{ direction: "rtl", paddingTop: 8 }} />
                    {proposals.map((p, i) => (
                      <Line key={p.id} type="monotone" dataKey={`annual_${p.id}`} stroke={COLORS[i % COLORS.length]} strokeWidth={2.5} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Balance Chart */}
            <div className="card">
              <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "#94A3B8" }}>💼 יתרה צבורה — {YEARS} שנים</h2>
              <div style={{ width: "100%", height: 340 }}>
                <ResponsiveContainer>
                  <LineChart data={balanceChartData} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
                    <XAxis dataKey="year" stroke="#475569" tick={{ fill: "#94A3B8", fontSize: 11 }}
                      label={{ value: "שנים", position: "insideBottom", offset: -5, fill: "#64748B", fontSize: 11 }}
                      interval={Math.floor(balanceChartData.length / 6)}
                    />
                    <YAxis stroke="#475569" tick={{ fill: "#94A3B8", fontSize: 11 }}
                      tickFormatter={(v) => (v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v)}
                      label={{ value: "₪ יתרה", angle: 90, position: "insideRight", offset: 10, fill: "#64748B", fontSize: 11 }}
                    />
                    <Tooltip
                      formatter={(v, name) => { const p = proposals.find((p) => `balance_${p.id}` === name); return [formatCurrency(v), p ? p.name : name]; }}
                      labelFormatter={(l) => `שנה ${l}`}
                      contentStyle={tooltipStyle} itemStyle={{ color: "#E2E8F0", direction: "rtl" }} labelStyle={{ color: "#94A3B8", marginBottom: 4, direction: "rtl", textAlign: "right" }}
                    />
                    <Legend formatter={(v) => { const p = proposals.find((p) => `balance_${p.id}` === v); return p ? p.name : v; }} wrapperStyle={{ direction: "rtl", paddingTop: 8 }} />
                    {proposals.map((p, i) => (
                      <Line key={p.id} type="monotone" dataKey={`balance_${p.id}`} stroke={COLORS[i % COLORS.length]} strokeWidth={2.5} dot={false} strokeDasharray={i > 0 ? "6 3" : "0"} activeDot={{ r: 4, strokeWidth: 0 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>

        <div style={{ textAlign: "center", marginTop: 20, color: "#475569", fontSize: 11 }}>
          * החישוב מבוסס על תשואה קבועה והפקדה חודשית קבועה. בפועל התשואה משתנה.
        </div>
      </div>
    </div>
  );
}
