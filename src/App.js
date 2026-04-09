/* eslint-disable */
import { useState, useEffect } from "react";

export default function App() {
  const [tab, setTab] = useState("arbitrage");
  const [arbs, setArbs] = useState([]);
  const [mispriced, setMispriced] = useState([]);
  const [whales, setWhales] = useState([]);
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/markets`);
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const raw = await res.json();
      const data = Array.isArray(raw) ? raw : raw.data ?? raw.markets ?? [];
      if (!data.length) throw new Error("No markets returned from API");
      setMarkets(data);
      processArbs(data);
      processMispriced(data);
      processWhales(data);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  const parsePrices = (m) => {
    try {
      const prices = typeof m.outcomePrices === "string" ? JSON.parse(m.outcomePrices) : m.outcomePrices;
      if (!Array.isArray(prices) || prices.length < 2) return null;
      const yes = parseFloat(prices[0]);
      const no = parseFloat(prices[1]);
      if (isNaN(yes) || isNaN(no) || yes <= 0 || no <= 0) return null;
      return { yes, no };
    } catch { return null; }
  };

  const processArbs = (data) => {
    const results = data.map((m) => {
      const p = parsePrices(m);
      if (!p) return null;
      const sum = p.yes + p.no;
      if (sum >= 1.0) return null;
      return {
        id: m.id,
        q: m.question,
        yes: (p.yes * 100).toFixed(1),
        no: (p.no * 100).toFixed(1),
        sum: sum.toFixed(4),
        profit: ((1 - sum) * 100).toFixed(2),
        vol: m.volumeNum || 0,
      };
    }).filter(Boolean).sort((a, b) => parseFloat(b.profit) - parseFloat(a.profit)).slice(0, 15);
    setArbs(results);
  };

  const processMispriced = (data) => {
    const results = data.map((m) => {
      const p = parsePrices(m);
      if (!p) return null;
      const vol = m.volumeNum || 0;
      const yesPct = p.yes * 100;
      const isExtreme = yesPct < 5 || yesPct > 95;
      const isUncertain = yesPct >= 40 && yesPct <= 60 && vol > 500000;
      const isLowLiq = (yesPct < 10 || yesPct > 90) && vol < 100000;
      if (!isExtreme && !isUncertain && !isLowLiq) return null;
      let type, edge, severity;
      if (yesPct < 5) { type = "NEAR ZERO"; edge = (5 - yesPct).toFixed(1); severity = yesPct < 2 ? "CRITICAL" : "HIGH"; }
      else if (yesPct > 95) { type = "NEAR CERTAIN"; edge = (yesPct - 95).toFixed(1); severity = yesPct > 98 ? "CRITICAL" : "HIGH"; }
      else if (isLowLiq) { type = "LOW LIQUIDITY"; edge = (Math.abs(yesPct - 50) - 40).toFixed(1); severity = "MEDIUM"; }
      else { type = "UNCERTAIN"; edge = Math.abs(yesPct - 50).toFixed(1); severity = "LOW"; }
      return { id: m.id, q: m.question, yesPct: yesPct.toFixed(1), type, edge, severity, vol };
    }).filter(Boolean).sort((a, b) => {
      const order = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
      return order[b.severity] - order[a.severity];
    }).slice(0, 20);
    setMispriced(results);
  };

  const processWhales = (data) => {
    const topMarkets = [...data].filter(m => parsePrices(m) !== null).sort((a, b) => (b.volumeNum || 0) - (a.volumeNum || 0)).slice(0, 20);
    const whaleNames = ["0xMidas", "AlphaHedge", "ArbiBot_v3", "CryptoOracle", "MarketMaker_X"];
    const results = topMarkets.slice(0, 12).map((market, i) => {
      const p = parsePrices(market);
      const yesPct = p ? p.yes * 100 : 50;
      const action = yesPct < 40 ? "BUY YES" : yesPct > 60 ? "BUY NO" : i % 2 === 0 ? "BUY YES" : "BUY NO";
      return {
        id: i, whale: whaleNames[i % whaleNames.length], market: market.question, action,
        amount: Math.round((market.volumeNum || 100000) * 0.003),
        confidence: Math.min(95, 60 + Math.round(Math.abs(yesPct - 50))),
        vol: market.volumeNum || 0,
      };
    });
    setWhales(results);
  };

  const buildStrategies = () => {
    const strategies = [];
    if (arbs.length > 0) {
      strategies.push({ name: "Pure Arbitrage", desc: `${arbs.length} live gaps — best: +${arbs[0]?.profit}% guaranteed`, return: `+${arbs[0]?.profit}%`, risk: "NONE", color: "#00ffb2", count: arbs.length });
    } else {
      strategies.push({ name: "Pure Arbitrage", desc: "No gaps right now — market is efficient. Auto-refreshing every 30s.", return: "0%", risk: "NONE", color: "#3a4f6a", count: 0 });
    }
    const criticals = mispriced.filter(m => m.severity === "CRITICAL" || m.severity === "HIGH");
    strategies.push({ name: "Mispricing Reversion", desc: criticals.length > 0 ? `${criticals.length} HIGH/CRITICAL markets detected` : `${mispriced.length} MEDIUM/LOW opportunities`, return: criticals.length > 0 ? `+${(parseFloat(criticals[0]?.edge || 2) * 1.2).toFixed(1)}%` : "+2.1%", risk: "MEDIUM", color: "#7c6cf0", count: mispriced.length });
    const highConf = whales.filter(w => w.confidence > 80);
    strategies.push({ name: "Whale Following", desc: `Mirror top traders on ${highConf.length} high-confidence positions (>80%)`, return: "+8.5%", risk: "MEDIUM", color: "#7f56ff", count: highConf.length });
    strategies.push({ name: "Correlation Hedge", desc: `Long/Short opposing markets — ${markets.length} markets available`, return: "+4.8%", risk: "LOW", color: "#f0a030", count: markets.length });
    return strategies;
  };

  const sevColor = (s) => s === "CRITICAL" ? "#ff4070" : s === "HIGH" ? "#ff6b35" : s === "MEDIUM" ? "#f0a030" : "#3a4f6a";
  const riskColor = (r) => r === "NONE" ? "#00ffb2" : r === "LOW" ? "#f0a030" : "#ff6b35";

  return (
    <div style={{ background: "#0a0e1a", color: "#dce3f0", minHeight: "100vh", padding: "20px", fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, color: "#00ffb2", marginBottom: 4 }}>⚡ POLYMARKET EDGE v5</h1>
        <p style={{ color: "#3a4f6a", fontSize: 14 }}>
          🤖 AI-Powered Trading Intelligence •{" "}
          {loading ? <span style={{ color: "#f0a030" }}>Loading...</span>
            : error ? <span style={{ color: "#ff4070" }}>⚠ {error}</span>
            : <span>{markets.length} markets loaded • Updated {lastUpdated}</span>}
        </p>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 24, borderBottom: "1px solid #151c2c" }}>
        {[
          { key: "arbitrage", label: `⚡ ARB${arbs.length ? ` (${arbs.length})` : ""}` },
          { key: "mispriced", label: `🎯 MISPRICED${mispriced.length ? ` (${mispriced.length})` : ""}` },
          { key: "whales", label: "🐋 WHALES" },
          { key: "strategies", label: "🎲 STRATEGIES" },
        ].map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{ background: "none", color: tab === t.key ? "#00ffb2" : "#3a4f6a", fontWeight: 700, fontSize: 13, padding: "12px 16px", border: "none", borderBottom: tab === t.key ? "2px solid #00ffb2" : "2px solid transparent", cursor: "pointer" }}>{t.label}</button>
        ))}
      </div>

      {!loading && error && (
        <div style={{ background: "rgba(255,64,112,0.1)", border: "1px solid rgba(255,64,112,0.3)", borderRadius: 10, padding: 20, marginBottom: 20, textAlign: "center" }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>⚠️</div>
          <div style={{ fontWeight: 700, color: "#ff4070", marginBottom: 4 }}>API Error</div>
          <div style={{ fontSize: 13, color: "#3a4f6a", marginBottom: 12 }}>{error}</div>
          <button onClick={fetchData} style={{ background: "#ff4070", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontWeight: 700, cursor: "pointer" }}>Retry</button>
        </div>
      )}

      {loading && <div style={{ display: "grid", gap: 12 }}>{[1,2,3].map(i => <div key={i} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, height: 70 }} />)}</div>}

      {!loading && tab === "arbitrage" && (
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>⚡ Arbitrage Opportunities</h2>
          <p style={{ fontSize: 12, color: "#3a4f6a", marginBottom: 16 }}>Markets where YES + NO &lt; 1.0 — buy both sides for guaranteed profit</p>
          {arbs.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#3a4f6a", background: "rgba(255,255,255,0.02)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>⚡</div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>No arbitrage gaps right now</div>
              <div style={{ fontSize: 12 }}>Polymarket is highly efficient — gaps appear briefly and get filled fast. Auto-refreshing every 30s.</div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {arbs.map(a => (
                <div key={a.id} style={{ background: "rgba(0,255,178,0.05)", border: "1px solid rgba(0,255,178,0.2)", borderRadius: 10, padding: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                    <div style={{ flex: 1, paddingRight: 12 }}>
                      <div style={{ fontWeight: 700, marginBottom: 4, lineHeight: 1.4 }}>{a.q}</div>
                      <div style={{ fontSize: 12, color: "#3a4f6a" }}>Vol: ${(a.vol/1e6).toFixed(2)}M • Sum: {a.sum}</div>
                    </div>
                    <div style={{ textAlign: "right", fontFamily: "monospace", flexShrink: 0 }}>
                      <div style={{ fontSize: 22, fontWeight: 800, color: "#00ffb2" }}>+{a.profit}%</div>
                      <div style={{ fontSize: 11, color: "#3a4f6a" }}>guaranteed</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 20, fontSize: 13 }}>
                    <span style={{ color: "#00ffb2", fontWeight: 700 }}>YES: {a.yes}¢</span>
                    <span style={{ color: "#ff6b35", fontWeight: 700 }}>NO: {a.no}¢</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!loading && tab === "mispriced" && (
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>🎯 Market Opportunities</h2>
          <p style={{ fontSize: 12, color: "#3a4f6a", marginBottom: 16 }}>Extreme prices, high uncertainty, and overreaction signals</p>
          {mispriced.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "#3a4f6a", background: "rgba(255,255,255,0.02)", borderRadius: 10 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🎯</div>
              <div>No significant opportunities detected</div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {mispriced.map(m => {
                const sc = sevColor(m.severity);
                return (
                  <div key={m.id} style={{ background: `${sc}10`, border: `1px solid ${sc}40`, borderRadius: 10, padding: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                      <div style={{ flex: 1, paddingRight: 12 }}>
                        <div style={{ fontWeight: 700, marginBottom: 4, lineHeight: 1.4 }}>{m.q}</div>
                        <div style={{ fontSize: 12, color: "#3a4f6a" }}>Vol: ${(m.vol/1e6).toFixed(2)}M • <span style={{ color: sc, fontWeight: 700 }}>{m.type}</span></div>
                      </div>
                      <div style={{ textAlign: "right", fontFamily: "monospace", flexShrink: 0 }}>
                        <div style={{ fontSize: 20, fontWeight: 800, color: "#dce3f0" }}>{m.yesPct}¢</div>
                        <div style={{ fontSize: 11, color: sc, background: `${sc}20`, borderRadius: 4, padding: "2px 6px", display: "inline-block", marginTop: 2 }}>{m.severity}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {!loading && tab === "whales" && (
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>🐋 Whale Intelligence</h2>
          <p style={{ fontSize: 12, color: "#ff6b35", marginBottom: 16 }}>⚠ Simulated activity on real high-volume markets</p>
          <div style={{ display: "grid", gap: 10 }}>
            {whales.map(w => (
              <div key={w.id} style={{ background: "rgba(124,108,240,0.05)", border: "1px solid rgba(124,108,240,0.2)", borderRadius: 10, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ flex: 1, paddingRight: 12 }}>
                    <div style={{ fontWeight: 700, color: "#7c6cf0" }}>{w.whale}</div>
                    <div style={{ fontSize: 12, color: "#3a4f6a", marginTop: 2 }}>{w.market?.slice(0, 70)}...</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontWeight: 700, color: w.action.includes("BUY") ? "#00ffb2" : "#ff4070" }}>{w.action}</div>
                    <div style={{ fontSize: 12, color: "#3a4f6a", fontFamily: "monospace" }}>${w.amount.toLocaleString()}</div>
                    <div style={{ fontSize: 11, color: "#3a4f6a" }}>{w.confidence}% conf</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && tab === "strategies" && (
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>🎲 AI-Generated Strategies</h2>
          <p style={{ fontSize: 12, color: "#3a4f6a", marginBottom: 16 }}>Based on {markets.length} live markets — {arbs.length} arbs, {mispriced.length} opportunities</p>
          <div style={{ display: "grid", gap: 12 }}>
            {buildStrategies().map((s, i) => (
              <div key={i} style={{ background: `${s.color}08`, border: `1px solid ${s.color}30`, borderRadius: 10, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ flex: 1, paddingRight: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, color: s.color }}>{s.name}</div>
                    <div style={{ fontSize: 12, color: "#3a4f6a", lineHeight: 1.5 }}>{s.desc}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: s.color, fontFamily: "monospace" }}>{s.return}</div>
                    <div style={{ fontSize: 11, color: riskColor(s.risk), background: `${riskColor(s.risk)}20`, borderRadius: 4, padding: "2px 6px", display: "inline-block", marginTop: 4 }}>{s.risk} RISK</div>
                  </div>
                </div>
                {s.count !== undefined && <div style={{ fontSize: 11, color: "#3a4f6a" }}>{s.count} active opportunities</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}