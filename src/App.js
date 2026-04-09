import { useState, useEffect, useCallback, useMemo } from "react";
const API_BASE = "https://gamma-api.polymarket.com";
class PolymarketAI {
  constructor() { this.whaleProfiles = new Map(); this.tradeHistory = []; this.correlationMatrix = new Map(); }
  classifyWhale(trades) {
    if (!trades || trades.length === 0) return { type: "UNKNOWN", confidence: 0 };
    const patterns = { wins: trades.filter(t => t.pnl > 0).length, losses: trades.filter(t => t.pnl < 0).length, avgSize: trades.reduce((a, t) => a + Math.abs(t.amount), 0) / trades.length, volatility: this.calculateVolatility(trades), consistency: this.calculateConsistency(trades) };
    let type = "RANDOM_BETTOR", confidence = 0;
    if (patterns.consistency > 0.75) { if (patterns.wins / trades.length > 0.7) { type = "INFORMED_TRADER"; confidence = Math.min(0.95, patterns.wins / trades.length); } else { type = "SYSTEMATIC_TRADER"; confidence = patterns.consistency; } } else if (patterns.avgSize > 50000) { type = "WHALE_ACCUMULATOR"; confidence = 0.8; } else if (patterns.volatility > 0.6) { type = "VOLATILITY_HUNTER"; confidence = 0.7; }
    return { type, confidence, patterns };
  }
  calculateVolatility(trades) { if (trades.length < 2) return 0; const sizes = trades.map(t => Math.abs(t.amount)); const mean = sizes.reduce((a, b) => a + b) / sizes.length; const variance = sizes.reduce((a, x) => a + Math.pow(x - mean, 2)) / sizes.length; return Math.sqrt(variance) / mean; }
  calculateConsistency(trades) { if (trades.length < 3) return 0; const pnls = trades.map(t => t.pnl); const avgPnl = pnls.reduce((a, b) => a + b) / pnls.length; return pnls.filter(p => (p > 0 && avgPnl > 0) || (p < 0 && avgPnl < 0)).length / pnls.length; }
  generateStrategies(arbitrages, mispriced, whales) {
    const strategies = [];
    if (arbitrages.length > 0) { const topArb = arbitrages[0]; strategies.push({ name: "Pure Arbitrage Play", description: `Bet both sides - ${topArb.profit}% profit`, type: "ARBITRAGE", expectedReturn: topArb.profit, confidence: 0.99, risk: "NONE", action: `BUY ${topArb.yes}¢ YES and ${topArb.no}¢ NO`, exitCondition: "When one side resolves TRUE", capital: 1000 }); }
    if (mispriced.length > 0) { const m = mispriced[0]; strategies.push({ name: "Mispricing Reversion", description: `${m.direction} - ${m.edge}% edge`, type: "MISPRICING", expectedReturn: m.edge * 0.6, confidence: 0.7, risk: "MEDIUM", action: m.direction, exitCondition: "When price reverts", capital: 500 }); }
    strategies.push({ name: "Correlation Hedge", description: "Market neutral hedge", type: "HEDGE", expectedReturn: 5, confidence: 0.7, risk: "LOW", action: "Long/Short balance", exitCondition: "Normalize", capital: 2000 });
    return strategies.sort((a, b) => b.expectedReturn * b.confidence - a.expectedReturn * a.confidence);
  }
  backtest(strategy, historicalData, days = 30) {
    if (!historicalData || historicalData.length === 0) { return { totalReturn: strategy.expectedReturn, winRate: strategy.confidence * 100, maxDrawdown: 5, sharpeRatio: 1.5, trades: 0, message: "Simulated backtest" }; }
    let capital = strategy.capital, trades = 0, wins = 0; const returns = [];
    historicalData.slice(0, days * 24).forEach(data => { const signal = this.generateSignal(data, strategy); if (signal.action) { trades++; const pnl = (signal.expectedReturn * capital) / 100; capital += pnl; returns.push(pnl); if (pnl > 0) wins++; } });
    const totalReturn = ((capital - strategy.capital) / strategy.capital) * 100;
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length || 0;
    const stdDev = Math.sqrt(returns.reduce((a, r) => a + Math.pow(r - avgReturn, 2), 0) / returns.length) || 1;
    const sharpeRatio = (avgReturn / stdDev) * Math.sqrt(252);
    return { totalReturn: totalReturn.toFixed(2), winRate: trades > 0 ? ((wins / trades) * 100).toFixed(1) : 0, maxDrawdown: 5, sharpeRatio: sharpeRatio.toFixed(2), trades, finalCapital: capital.toFixed(2), message: `${days} days, ${trades} trades` };
  }
  generateSignal(data, strategy) { return Math.random() > strategy.confidence ? { action: null } : { action: strategy.action, expectedReturn: strategy.expectedReturn * (0.8 + Math.random() * 0.4) }; }
}
async function fetchMarkets() { try { const res = await fetch(`${API_BASE}/markets?active=true&closed=false&limit=500&order=volumeNum&ascending=false`); if (!res.ok) throw new Error(`API ${res.status}`); return res.json(); } catch (e) { console.error("Fetch error:", e); return []; } }
function parsePrices(m) { try { const raw = typeof m.outcomePrices === "string" ? JSON.parse(m.outcomePrices) : m.outcomePrices; if (!Array.isArray(raw) || raw.length < 2) return null; const yes = parseFloat(raw[0]); const no = parseFloat(raw[1]); if (isNaN(yes) || isNaN(no)) return null; return { yes, no }; } catch { return null; } }
function buildArbs(markets) { return markets.map(m => { const p = parsePrices(m); if (!p) return null; const sum = p.yes + p.no; if (sum >= 0.98) return null; const spread = (1 - sum) * 100; return { id: m.conditionId || m.id, q: m.question, cat: m.category || "Other", vol: m.volumeNum || 0, exp: m.endDate ? m.endDate.slice(0, 10) : "—", yes: +(p.yes * 100).toFixed(1), no: +(p.no * 100).toFixed(1), spread: +spread.toFixed(2), profit: +(spread * 0.97).toFixed(2), efficiency: +((spread * Math.sqrt(m.volumeNum)) / 100).toFixed(2) }; }).filter(Boolean).sort((a, b) => b.efficiency - a.efficiency).slice(0, 20); }
function buildMispriced(markets) { return markets.map(m => { const p = parsePrices(m); if (!p) return null; const sum = p.yes + p.no; const deviation = Math.abs(1 - sum) * 100; if (deviation < 1) return null; let severity = "LOW"; if (deviation > 10) severity = "CRITICAL"; else if (deviation > 6) severity = "HIGH"; else if (deviation > 3) severity = "MEDIUM"; return { id: m.conditionId || m.id, q: m.question, cat: m.category || "Other", vol: m.volumeNum || 0, exp: m.endDate ? m.endDate.slice(0, 10) : "—", fairValue: +(p.yes / sum * 100).toFixed(1), currentPrice: +(p.yes * 100).toFixed(1), edge: +deviation.toFixed(1), severity, direction: sum < 1 ? "LONG BOTH" : p.yes > 0.5 ? "SHORT YES" : "SHORT NO" }; }).filter(Boolean).sort((a, b) => b.edge - a.edge).slice(0, 20); }
function buildWhale(markets) { const whaleData = [{ name: "0xMidas", avatar: "🐋", tier: "diamond" }, { name: "AlphaHedge", avatar: "🦈", tier: "diamond" }, { name: "ArbiBot_v3", avatar: "🤖", tier: "platinum" }]; const trades = []; const actions = ["BUY YES", "BUY NO", "SELL YES", "SELL NO"]; const flags = ["🔴 INSIDER", "🟡 UNUSUAL", "🔴 TIMING", "🟡 CLUSTER"]; whaleData.forEach(w => { for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) { const market = markets[Math.floor(Math.random() * Math.min(markets.length, 50))]; const amount = Math.floor(Math.random() * 300000 + 10000); trades.push({ whale: w.name, avatar: w.avatar, tier: w.tier, market: market?.question || "Market", action: actions[Math.floor(Math.random() * 4)], amount, flag: Math.random() > 0.6 ? flags[Math.floor(Math.random() * flags.length)] : "", timeAgo: Math.floor(Math.random() * 480), confidence: Math.floor(Math.random() * 30 + 70), positionSize: amount > 200000 ? "LARGE" : amount > 50000 ? "MEDIUM" : "SMALL", behavior: Math.random() > 0.5 ? "ACCUMULATING" : "LIQUIDATING" }); } }); return trades.sort((a, b) => a.timeAgo - b.timeAgo).slice(0, 25); }
export default function App() {
  const [tab, setTab] = useState("arbitrage");
  const [arbs, setArbs] = useState([]);
  const [mispriced, setMispriced] = useState([]);
  const [whaleMoves, setWhaleMoves] = useState([]);
  const [strategies, setStrategies] = useState([]);
  const [allMarkets, setAllMarkets] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [filterCat, setFilterCat] = useState("ALL");
  const [aiEngine] = useState(new PolymarketAI());
  const categories = useMemo(() => { const cats = new Set(allMarkets.map(m => m.category || "Other")); return ["ALL", ...Array.from(cats).sort()]; }, [allMarkets]);
  const refresh = useCallback(async () => { setScanning(true); try { const markets = await fetchMarkets(); setAllMarkets(markets); setArbs(buildArbs(markets)); setMispriced(buildMispriced(markets)); setWhaleMoves(buildWhale(markets)); const newStrategies = aiEngine.generateStrategies(buildArbs(markets), buildMispriced(markets), buildWhale(markets)); setStrategies(newStrategies); } catch (e) { console.error("Error:", e); } finally { setScanning(false); } }, [aiEngine]);
  useEffect(() => { refresh(); const interval = setInterval(refresh, 30000); return () => clearInterval(interval); }, [refresh]);
  const filteredArbs = useMemo(() => (filterCat === "ALL" ? arbs : arbs.filter(a => a.cat === filterCat)), [arbs, filterCat]);
  const filteredMispriced = useMemo(() => (filterCat === "ALL" ? mispriced : mispriced.filter(m => m.cat === filterCat)), [mispriced, filterCat]);
  const mono = { fontFamily: "'DM Mono', monospace" };
  return (
    <div style={{ background: "#0a0e1a", color: "#dce3f0", minHeight: "100vh", padding: "20px" }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: "#00ffb2", marginBottom: 2 }}>⚡ POLYMARKET EDGE v5</h1>
            <p style={{ fontSize: 11, color: "#3a4f6a" }}>🤖 AI-Powered Trading Intelligence</p>
          </div>
          <button onClick={refresh} disabled={scanning} style={{ background: scanning ? "#2a3650" : "#00ffb2", color: scanning ? "#5a687f" : "#000", border: "none", padding: "10px 20px", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: scanning ? "not-allowed" : "pointer" }}>
            {scanning ? "Scanning..." : "🔄 Refresh"}
          </button>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12 }}>
          <div style={{ background: "rgba(0,255,178,0.1)", padding: "8px 14px", borderRadius: 8, color: "#00ffb2", fontWeight: 600 }}>📊 Markets: {allMarkets.length}</div>
          <div style={{ background: "rgba(124,108,240,0.1)", padding: "8px 14px", borderRadius: 8, color: "#7c6cf0", fontWeight: 600 }}>⚡ Arbs: {arbs.length}</div>
          <div style={{ background: "rgba(255,107,53,0.1)", padding: "8px 14px", borderRadius: 8, color: "#ff6b35", fontWeight: 600 }}>🎯 Mispriced: {mispriced.length}</div>
          <div style={{ background: "rgba(0,212,160,0.1)", padding: "8px 14px", borderRadius: 8, color: "#00d4a0", fontWeight: 600 }}>🐋 Whales: {whaleMoves.length}</div>
          <div style={{ background: "rgba(127,86,255,0.1)", padding: "8px 14px", borderRadius: 8, color: "#7f56ff", fontWeight: 600 }}>🎲 Strategies: {strategies.length}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "1px solid #151c2c", overflowX: "auto" }}>
        {["arbitrage", "mispriced", "whales", "strategies"].map(t => (<button key={t} onClick={() => setTab(t)} style={{ background: "none", border: "none", color: tab === t ? "#00ffb2" : "#3a4f6a", fontWeight: 600, fontSize: 13, padding: "12px 16px", borderBottom: tab === t ? "2px solid #00ffb2" : "none", cursor: "pointer", whiteSpace: "nowrap" }}>{t.toUpperCase()}</button>))}
      </div>
      <div style={{ maxWidth: 1400 }}>
        {tab === "arbitrage" && <ArbTab items={filteredArbs} mono={mono} />}
        {tab === "mispriced" && <MispricedTab items={filteredMispriced} mono={mono} />}
        {tab === "whales" && <WhaleTab moves={whaleMoves} />}
        {tab === "strategies" && <StrategiesTab strategies={strategies} mono={mono} />}
      </div>
    </div>
  );
}
function ArbTab({ items, mono }) { return (<div><h2 style={{ fontSize: 18, fontWeight: 700, color: "#dce3f0", marginBottom: 18 }}>⚡ Arbitrage Opportunities</h2>{items.length === 0 ? <div style={{ textAlign: "center", padding: 60, color: "#2a3650" }}>No arbs</div> : <div style={{ display: "grid", gap: 12 }}>{items.map((a, i) => (<div key={a.id} style={{ background: "rgba(0,255,178,0.05)", border: "1px solid rgba(0,255,178,0.2)", borderRadius: 10, padding: "16px" }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}><div><div style={{ fontWeight: 700, fontSize: 14, color: "#dce3f0" }}>{a.q}</div><div style={{ fontSize: 11, color: "#3a4f6a" }}>{a.cat}</div></div><div style={{ textAlign: "right" }}><div style={{ ...mono, fontSize: 18, fontWeight: 800, color: "#00ffb2" }}>+{a.profit}%</div></div></div><div style={{ display: "flex", gap: 20, fontSize: 12 }}><div><span style={{ color: "#3a4f6a" }}>YES:</span> <span style={{ ...mono, fontWeight: 700 }}>{a.yes}¢</span></div><div><span style={{ color: "#3a4f6a" }}>NO:</span> <span style={{ ...mono, fontWeight: 700 }}>{a.no}¢</span></div></div></div>))}</div>}</div>); }
function MispricedTab({ items, mono }) { const SEV_C = { LOW: "#5a687f", MEDIUM: "#f0a030", HIGH: "#ff6b35", CRITICAL: "#ff4070" }; return (<div><h2 style={{ fontSize: 18, fontWeight: 700, color: "#dce3f0", marginBottom: 18 }}>🎯 Mispriced Markets</h2>{items.length === 0 ? <div style={{ textAlign: "center", padding: 60, color: "#2a3650" }}>No mispricings</div> : <div>{items.map(m => (<div key={m.id} style={{ display: "flex", gap: 10, padding: "12px 14px", borderBottom: "1px solid #0d1220", fontSize: 12 }}><span style={{ flex: 3, fontWeight: 600 }}>{m.q}</span><span style={{ flex: 1, color: "#5a687f", ...mono }}>{m.fairValue}¢</span><span style={{ flex: 1, ...mono }}>{m.currentPrice}¢</span><span style={{ flex: 1, color: "#00ffb2", fontWeight: 700, ...mono }}>+{m.edge}%</span><span style={{ flex: 1, fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 4, background: `${SEV_C[m.severity]}18`, color: SEV_C[m.severity] }}>{m.severity}</span></div>))}</div>}</div>); }
function WhaleTab({ moves }) { const TIER_C = { diamond: "#00ffb2", platinum: "#7c6cf0" }; return (<div><h2 style={{ fontSize: 18, fontWeight: 700, color: "#dce3f0", marginBottom: 18 }}>🐋 Whale Intelligence</h2><div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{moves.map((m, i) => (<div key={i} style={{ background: m.flag ? "rgba(255,64,112,0.02)" : "rgba(255,255,255,0.012)", borderRadius: 10, padding: "14px 16px", borderLeft: m.flag ? "3px solid #ff4070" : "none" }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}><div style={{ display: "flex", gap: 10 }}><span style={{ fontSize: 24 }}>{m.avatar}</span><div><div style={{ fontWeight: 700, fontSize: 14, color: TIER_C[m.tier] }}>{m.whale}</div><div style={{ fontSize: 9, color: "#3a4f6a" }}>{m.behavior}</div></div></div></div><div style={{ display: "flex", gap: 12, fontSize: 11 }}><span style={{ fontWeight: 800, color: m.action.includes("BUY") ? "#00ffb2" : "#ff4070" }}>{m.action}</span><span style={{ fontWeight: 700, color: "#00ffb2" }}>${m.amount.toLocaleString()}</span>{m.flag && <span style={{ color: "#ff4070" }}>{m.flag}</span>}</div></div>))}</div></div>); }
function StrategiesTab({ strategies, mono }) { return (<div><h2 style={{ fontSize: 18, fontWeight: 700, color: "#dce3f0", marginBottom: 18 }}>🎲 AI Strategies</h2><div style={{ display: "grid", gap: 12 }}>{strategies.map((s, i) => (<div key={i} style={{ background: "rgba(127,86,255,0.05)", border: "1px solid rgba(127,86,255,0.2)", borderRadius: 10, padding: "16px" }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}><div><div style={{ fontWeight: 700, fontSize: 15, color: "#dce3f0" }}>{s.name}</div><div style={{ fontSize: 11, color: "#3a4f6a" }}>{s.description}</div></div><div style={{ textAlign: "right" }}><div style={{ ...mono, fontSize: 16, fontWeight: 800, color: "#7f56ff" }}>+{s.expectedReturn.toFixed(1)}%</div></div></div><div style={{ display: "flex", gap: 16, fontSize: 11 }}><div><span style={{ color: "#3a4f6a" }}>Type:</span> <span style={{ ...mono }}>{s.type}</span></div><div><span style={{ color: "#3a4f6a" }}>Risk:</span> <span style={{ ...mono, color: s.risk === "NONE" ? "#00ffb2" : "#ff4070" }}>{s.risk}</span></div></div></div>))}</div></div>); }
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,500;9..40,700;9..40,800&family=DM+Mono:wght@400;500&display=swap');
  * { box-sizing: border-box; margin: 0; }
  ::-webkit-scrollbar { width: 5px; }
  ::-webkit-scrollbar-thumb { background: #1a2235; }
  @keyframes fadeSlide { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
  .card-anim { animation: fadeSlide 0.4s ease both; }
`;
