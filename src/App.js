import { useState, useEffect } from "react";
export default function App() {
  const [tab, setTab] = useState("arbitrage");
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("https://gamma-api.polymarket.com/markets?active=true&limit=50")
      .then(r => r.json())
      .then(data => setMarkets(data))
      .catch(e => console.error(e));
  }, []);

  return (
    <div style={{ background: "#0a0e1a", color: "#dce3f0", minHeight: "100vh", padding: "20px", fontFamily: "DM Sans" }}>
      <h1 style={{ color: "#00ffb2", fontSize: 28 }}>⚡ POLYMARKET EDGE v5</h1>
      <p style={{ color: "#3a4f6a" }}>🤖 AI-Powered Trading Intelligence</p>
      
      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        {["arbitrage", "mispriced", "whales", "strategies"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ background: tab === t ? "#7c6cf0" : "#1a2235", color: tab === t ? "#fff" : "#5a687f", border: "1px solid #151c2c", padding: "10px 16px", borderRadius: 6, cursor: "pointer" }}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      <div style={{ background: "rgba(0,255,178,0.05)", border: "1px solid rgba(0,255,178,0.2)", borderRadius: 10, padding: 20 }}>
        {tab === "arbitrage" && (
          <div>
            <h2 style={{ color: "#dce3f0", marginBottom: 10 }}>⚡ Arbitrage Opportunities</h2>
            <p style={{ color: "#3a4f6a" }}>{markets.length} markets loaded</p>
            {markets.slice(0, 5).map(m => (
              <div key={m.id} style={{ padding: 10, borderBottom: "1px solid #0d1220", color: "#dce3f0" }}>
                {m.question}
              </div>
            ))}
          </div>
        )}
        {tab === "mispriced" && <h2>🎯 Mispriced Markets</h2>}
        {tab === "whales" && <h2>🐋 Whale Intelligence</h2>}
        {tab === "strategies" && <h2>🎲 AI Strategies</h2>}
      </div>
    </div>
  );
}
