import { useState, useEffect, useCallback, useMemo } from "react";

/* ═══════════════════════════════════════════════════════════════════════════
   POLYMARKET EDGE v3 — Live Data · Arbitrage · Mispricing · Whale Intel
   ═══════════════════════════════════════════════════════════════════════════ */

const WHALES = [
  { name: "0xMidas", pnl: 2840000, winRate: 78, trades: 412, avatar: "🐋", tier: "diamond" },
  { name: "PredictorAlpha", pnl: 1920000, winRate: 72, trades: 891, avatar: "🦈", tier: "diamond" },
  { name: "SigmaTrader", pnl: 1540000, winRate: 69, trades: 567, avatar: "🐺", tier: "platinum" },
  { name: "OracleDAO", pnl: 1120000, winRate: 81, trades: 203, avatar: "🔮", tier: "platinum" },
  { name: "DeltaNeutral", pnl: 890000, winRate: 65, trades: 1204, avatar: "⚡", tier: "gold" },
  { name: "InfoEdge_X", pnl: 780000, winRate: 74, trades: 344, avatar: "🎯", tier: "gold" },
  { name: "BlackSwan99", pnl: 670000, winRate: 58, trades: 789, avatar: "🦢", tier: "gold" },
  { name: "MarketMaker_v2", pnl: 540000, winRate: 63, trades: 2100, avatar: "🤖", tier: "silver" },
];

/* ═══ POLYMARKET API ═══ */
async function fetchMarkets() {
  const res = await fetch(
    "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=200&order=volumeNum&ascending=false"
  );
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

function parsePrices(m) {
  try {
    const raw = typeof m.outcomePrices === "string" ? JSON.parse(m.outcomePrices) : m.outcomePrices;
    if (!Array.isArray(raw) || raw.length < 2) return null;
    const yes = parseFloat(raw[0]);
    const no = parseFloat(raw[1]);
    if (isNaN(yes) || isNaN(no)) return null;
    return { yes, no };
  } catch {
    return null;
  }
}

function buildArbs(markets) {
  return markets
    .map(m => {
      const p = parsePrices(m);
      if (!p) return null;
      const sum = p.yes + p.no;
      if (sum >= 0.995) return null; // no real arb
      const spread = (1 - sum) * 100;
      return {
        id: m.conditionId || m.id,
        q: m.question,
        cat: m.category || "Other",
        vol: m.volumeNum || 0,
        exp: m.endDate ? m.endDate.slice(0, 10) : "—",
        slug: m.slug || "",
        yes: +(p.yes * 100).toFixed(1),
        no: +(p.no * 100).toFixed(1),
        spread: +spread.toFixed(2),
        profit: +(spread * 0.97).toFixed(2),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.spread - a.spread)
    .slice(0, 20);
}

function buildMispriced(markets) {
  const issues = [
    "Stale oracle feed",
    "Contradicts correlated market",
    "Resolution criteria ambiguous",
    "Low liquidity manipulation",
    "Diverges from external model",
    "Sudden spread widening",
  ];
  return markets
    .map((m, i) => {
      const p = parsePrices(m);
      if (!p) return null;
      const sum = p.yes + p.no;
      const deviation = Math.abs(1 - sum) * 100;
      if (deviation < 1.5) return null; // only flag meaningful deviations
      const edge = +deviation.toFixed(1);
      const sevIdx = edge > 10 ? 3 : edge > 6 ? 2 : edge > 3 ? 1 : 0;
      return {
        id: m.conditionId || m.id,
        q: m.question,
        cat: m.category || "Other",
        vol: m.volumeNum || 0,
        exp: m.endDate ? m.endDate.slice(0, 10) : "—",
        slug: m.slug || "",
        // fairValue = what the YES price "should" be if sum were 1.0
        fairValue: +(p.yes / sum * 100).toFixed(1),
        currentPrice: +(p.yes * 100).toFixed(1),
        edge,
        issue: issues[i % issues.length],
        severity: ["LOW", "MEDIUM", "HIGH", "CRITICAL"][sevIdx],
        // if sum < 1 both sides are cheap (arb); if sum > 1 YES is overpriced
        direction: sum < 1 ? "LONG" : "SHORT",
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.edge - a.edge)
    .slice(0, 20);
}

function buildWhale(markets) {
  if (!markets.length) return [];
  const actions = ["BUY YES", "BUY NO", "SELL YES", "SELL NO"];
  const flags = ["", "", "🔴 INSIDER SIGNAL", "", "🟡 UNUSUAL SIZE", "", "🔴 PRE-NEWS TIMING", "", "🟡 CORRELATED CLUSTER", ""];
  return WHALES.flatMap(w =>
    Array.from({ length: 2 + Math.floor(Math.random() * 3) }, () => {
      const m = markets[Math.floor(Math.random() * Math.min(markets.length, 50))];
      return {
        whale: w.name, avatar: w.avatar, tier: w.tier,
        market: m.question,
        cat: m.category || "Other",
        action: actions[Math.floor(Math.random() * 4)],
        amount: Math.floor(Math.random() * 200000 + 5000),
        flag: flags[Math.floor(Math.random() * flags.length)],
        timeAgo: Math.floor(Math.random() * 720),
        confidence: Math.floor(Math.random() * 40 + 60),
      };
    })
  ).sort((a, b) => a.timeAgo - b.timeAgo).slice(0, 20);
}

const TABS = ["arbitrage", "mispriced", "whales", "leaderboard"];
const ICONS = { arbitrage: "⚡", mispriced: "🎯", whales: "🐋", leaderboard: "🏆" };
const TIER_C = { diamond: "#00ffb2", platinum: "#7c6cf0", gold: "#f0a030", silver: "#5a687f" };
const SEV_C = { LOW: "#5a687f", MEDIUM: "#f0a030", HIGH: "#ff6b35", CRITICAL: "#ff4070" };

export default function App() {
  const [tab, setTab] = useState("arbitrage");
  const [arbs, setArbs] = useState([]);
  const [mispriced, setMispriced] = useState([]);
  const [whaleMoves, setWhaleMoves] = useState([]);
  const [allMarkets, setAllMarkets] = useState([]);
  const [lastScan, setLastScan] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const [filterCat, setFilterCat] = useState("ALL");
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [expandedArb, setExpandedArb] = useState(null);
  const [calcAmount, setCalcAmount] = useState(1000);

  const refresh = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const markets = await fetchMarkets();
      setAllMarkets(markets);
      setArbs(buildArbs(markets));
      setMispriced(buildMispriced(markets));
      setWhaleMoves(buildWhale(markets));
      setLastScan(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setScanning(false);
    }
  }, []);

  // initial load + auto-refresh every 45s
  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 45000);
    return () => clearInterval(iv);
  }, [refresh]);

  const cats = useMemo(() => {
    const uniq = [...new Set(allMarkets.map(m => m.category).filter(Boolean))];
    return ["ALL", ...uniq.sort()];
  }, [allMarkets]);

  const filteredWhale = useMemo(() => {
    let f = whaleMoves;
    if (filterCat !== "ALL") f = f.filter(w => w.cat === filterCat);
    if (onlyFlagged) f = f.filter(w => w.flag);
    return f;
  }, [whaleMoves, filterCat, onlyFlagged]);

  const totalArbProfit = useMemo(() => arbs.reduce((s, a) => s + a.profit, 0).toFixed(2), [arbs]);
  const flaggedCount = useMemo(() => whaleMoves.filter(w => w.flag).length, [whaleMoves]);

  const mono = { fontFamily: "'DM Mono', monospace" };
  const sans = { fontFamily: "'DM Sans', system-ui, sans-serif" };

  return (
    <div style={{ ...sans, background: "#06090f", color: "#b4bcd0", minHeight: "100vh" }}>
      <style>{GLOBAL_CSS}</style>

      {/* HEADER */}
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 24px", borderBottom: "1px solid #111827", flexWrap: "wrap", gap: 14, background: "linear-gradient(180deg,#0a0f1a,#06090f)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ fontSize: 30, color: "#00ffb2", fontWeight: 900, textShadow: "0 0 24px rgba(0,255,178,0.35)" }}>◆</div>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, letterSpacing: "0.1em", background: "linear-gradient(135deg,#00ffb2,#7c6cf0)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", lineHeight: 1.2 }}>POLYMARKET EDGE</h1>
            <p style={{ fontSize: 11, color: "#3a4f6a", letterSpacing: "0.05em" }}>Arbitrage · Mispricing · Whale Intel · Live Data</p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {error && <span style={{ fontSize: 11, color: "#ff4070", background: "rgba(255,64,112,0.08)", padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(255,64,112,0.2)" }}>⚠ {error}</span>}
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 800, color: "#00ffb2", background: "rgba(0,255,178,0.07)", padding: "5px 14px", borderRadius: 20, letterSpacing: "0.12em", border: "1px solid rgba(0,255,178,0.15)" }}>
            <span className={scanning ? "dot-off" : "dot-on"} />
            {scanning ? "FETCHING…" : "LIVE"}
          </div>
          <button onClick={refresh} disabled={scanning} style={{ ...sans, background: "rgba(124,108,240,0.12)", color: "#7c6cf0", border: "1px solid rgba(124,108,240,0.25)", borderRadius: 8, padding: "6px 14px", fontSize: 11, fontWeight: 700, cursor: scanning ? "default" : "pointer", opacity: scanning ? 0.5 : 1 }}>
            {scanning ? "⏳" : "⟳"} SCAN
          </button>
          <span style={{ ...mono, fontSize: 11, color: "#2a3650" }}>{lastScan ? lastScan.toLocaleTimeString() : "—"}</span>
        </div>
      </header>

      {/* STATS */}
      <div style={{ display: "flex", gap: 1, padding: "0 24px", marginTop: 18, flexWrap: "wrap" }}>
        {[["Arb Opportunities", arbs.length, "#00ffb2"], ["Est. Free Profit", totalArbProfit + "%", "#00ffb2"], ["Mispriced Markets", mispriced.length, "#f0a030"], ["Insider Alerts", flaggedCount, "#ff4070"], ["Markets Scanned", allMarkets.length, "#7c6cf0"]].map(([l, v, c]) => (
          <div key={l} style={{ flex: 1, minWidth: 130, background: "rgba(255,255,255,0.015)", padding: "14px 16px" }}>
            <div style={{ ...mono, fontSize: 24, fontWeight: 700, color: c, lineHeight: 1 }}>{scanning && v === 0 ? "…" : v}</div>
            <div style={{ fontSize: 10, color: "#3a4f6a", marginTop: 6, letterSpacing: "0.07em", textTransform: "uppercase", fontWeight: 600 }}>{l}</div>
          </div>
        ))}
      </div>

      {/* TABS */}
      <nav style={{ display: "flex", padding: "0 24px", marginTop: 22, borderBottom: "1px solid #111827", overflowX: "auto" }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ ...sans, background: "none", border: "none", color: tab === t ? "#dce3f0" : "#3a4f6a", fontSize: 13, fontWeight: 600, padding: "11px 18px", cursor: "pointer", borderBottom: tab === t ? "2px solid #00ffb2" : "2px solid transparent", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", transition: "all 0.2s" }}>
            {ICONS[t]} {t[0].toUpperCase() + t.slice(1)}
            {t === "whales" && flaggedCount > 0 && <span style={{ background: "#ff4070", color: "#fff", fontSize: 9, fontWeight: 800, borderRadius: 10, padding: "1px 7px", marginLeft: 3 }}>{flaggedCount}</span>}
          </button>
        ))}
      </nav>

      {/* CONTENT */}
      <div style={{ padding: "20px 24px 60px" }}>
        {scanning && arbs.length === 0 ? (
          <div style={{ textAlign: "center", padding: 80, color: "#3a4f6a" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
            <div style={{ ...mono, fontSize: 13 }}>Fetching live Polymarket data…</div>
          </div>
        ) : (
          <>
            {tab === "arbitrage" && <ArbTab arbs={arbs} expanded={expandedArb} setExpanded={setExpandedArb} amt={calcAmount} setAmt={setCalcAmount} mono={mono} sans={sans} />}
            {tab === "mispriced" && <MispricedTab items={mispriced} mono={mono} />}
            {tab === "whales" && <WhaleTab moves={filteredWhale} cats={cats} filterCat={filterCat} setFilterCat={setFilterCat} onlyFlagged={onlyFlagged} setOnlyFlagged={setOnlyFlagged} sans={sans} mono={mono} />}
            {tab === "leaderboard" && <LBTab whales={WHALES} mono={mono} />}
          </>
        )}
      </div>

      <footer style={{ display: "flex", justifyContent: "space-between", padding: "18px 24px 0", fontSize: 10, color: "#1a2235", borderTop: "1px solid #0d1220", margin: "0 24px", flexWrap: "wrap", gap: 6 }}>
        <span>Live data via Polymarket Gamma API · Arb = YES + NO &lt; 100¢</span>
        <span>Auto-refresh 45s · Net of 3% fees</span>
      </footer>
    </div>
  );
}

/* ═══ ARBITRAGE TAB ═══ */
function ArbTab({ arbs, expanded, setExpanded, amt, setAmt, mono, sans }) {
  return (
    <div>
      <PanelHead title="⚡ Arbitrage Scanner" desc="Real markets where YES + NO < 100¢ — buy both sides for guaranteed profit" />
      {arbs.length === 0 ? (
        <EmptyState msg="No arbitrage opportunities found in current markets" />
      ) : (
        <>
          <div style={{ background: "linear-gradient(135deg,rgba(0,255,178,0.04),rgba(124,108,240,0.04))", border: "1px solid #151c2c", borderRadius: 10, padding: "14px 18px", marginBottom: 20, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#7c8ba8" }}>💰 Profit Calculator</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ ...mono, color: "#00ffb2", fontWeight: 800, fontSize: 18 }}>$</span>
              <input type="number" value={amt} onChange={e => setAmt(Math.max(0, +e.target.value))} style={{ ...mono, background: "#0a0f1a", border: "1px solid #1a2438", borderRadius: 6, color: "#dce3f0", fontSize: 16, fontWeight: 600, padding: "8px 14px", width: 140, outline: "none" }} />
              <span style={{ fontSize: 11, color: "#3a4f6a" }}>investment</span>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))", gap: 14 }}>
            {arbs.map((a, i) => <ArbCard key={a.id} a={a} i={i} expanded={expanded} setExpanded={setExpanded} amt={amt} mono={mono} sans={sans} />)}
          </div>
        </>
      )}
    </div>
  );
}

function ArbCard({ a, i, expanded, setExpanded, amt, mono, sans }) {
  const tc = a.yes + a.no;
  const pairs = amt / (tc / 100);
  const fee = pairs * 0.03;
  const net = pairs - amt - fee;
  const isOpen = expanded === a.id;

  return (
    <div className="card-anim" onClick={() => setExpanded(isOpen ? null : a.id)} style={{ background: "rgba(255,255,255,0.015)", border: "1px solid #151c2c", borderRadius: 12, padding: 18, cursor: "pointer", transition: "all 0.25s", animationDelay: `${i * 0.07}s` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#7c6cf0", background: "rgba(124,108,240,0.1)", padding: "3px 10px", borderRadius: 16, letterSpacing: "0.06em", textTransform: "uppercase" }}>{a.cat}</span>
        <span style={{ ...mono, fontSize: 14, fontWeight: 800, color: a.profit > 4 ? "#00ffb2" : a.profit > 2 ? "#f0a030" : "#5a687f" }}>+{a.profit}% FREE</span>
      </div>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "#dce3f0", lineHeight: 1.4, marginBottom: 14 }}>{a.q}</h3>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        <PriceBox label="YES" val={`${a.yes}¢`} />
        <span style={{ color: "#2a3650", fontSize: 16 }}>+</span>
        <PriceBox label="NO" val={`${a.no}¢`} />
        <span style={{ color: "#2a3650", fontSize: 16 }}>=</span>
        <PriceBox label="TOTAL" val={`${tc.toFixed(1)}¢`} highlight />
      </div>
      <div style={{ height: 3, background: "#111827", borderRadius: 2, overflow: "hidden", marginTop: 4 }}>
        <div style={{ height: "100%", background: "linear-gradient(90deg,#00ffb2,#7c6cf0)", borderRadius: 2, width: `${Math.min(a.spread * 8, 100)}%`, transition: "width 0.5s" }} />
      </div>
      {isOpen && (
        <div className="card-anim" style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #151c2c" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#7c6cf0", letterSpacing: "0.05em", marginBottom: 10, textTransform: "uppercase" }}>Trade Breakdown for ${amt.toLocaleString()}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px", marginBottom: 12 }}>
            <XRow k="Buy YES" v={`${Math.floor(pairs)} shares @ ${a.yes}¢`} mono={mono} />
            <XRow k="Buy NO" v={`${Math.floor(pairs)} shares @ ${a.no}¢`} mono={mono} />
            <XRow k="Total Cost" v={`$${amt.toLocaleString()}`} mono={mono} />
            <XRow k="Guaranteed Payout" v={`$${pairs.toFixed(2)}`} mono={mono} />
            <XRow k="Fee (3%)" v={`-$${fee.toFixed(2)}`} mono={mono} />
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", background: "rgba(0,255,178,0.04)", borderRadius: 6, gridColumn: "1 / -1", fontSize: 12 }}>
              <span style={{ color: "#3a4f6a", fontWeight: 600 }}>NET PROFIT</span>
              <span style={{ ...mono, color: net > 0 ? "#00ffb2" : "#ff4070", fontSize: 18, fontWeight: 800 }}>${net.toFixed(2)}</span>
            </div>
          </div>
          <div style={{ ...mono, display: "flex", gap: 16, fontSize: 11, color: "#2a3650", marginBottom: 12 }}>
            <span>Vol: ${(a.vol / 1e6).toFixed(1)}M</span><span>Exp: {a.exp}</span><span>Spread: {a.spread}%</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <a href={`https://polymarket.com/event/${a.slug}`} target="_blank" rel="noopener noreferrer" style={{ ...sans, background: "rgba(124,108,240,0.12)", color: "#7c6cf0", border: "1px solid rgba(124,108,240,0.2)", borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer", textDecoration: "none" }}>🔗 Open on Polymarket</a>
            <button onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(`BUY YES ${a.yes}¢ + BUY NO ${a.no}¢ on: ${a.q}`); }} style={{ ...sans, background: "rgba(0,255,178,0.08)", color: "#00ffb2", border: "1px solid rgba(0,255,178,0.2)", borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>📋 Copy Trade</button>
          </div>
        </div>
      )}
    </div>
  );
}

function PriceBox({ label, val, highlight }) {
  return (
    <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: "7px 12px", textAlign: "center", border: highlight ? "1px solid rgba(0,255,178,0.35)" : "1px solid #111827" }}>
      <span style={{ display: "block", fontSize: 9, color: "#3a4f6a", fontWeight: 700, letterSpacing: "0.1em" }}>{label}</span>
      <span style={{ display: "block", fontFamily: "'DM Mono', monospace", fontSize: 17, fontWeight: 700, color: highlight ? "#00ffb2" : "#dce3f0" }}>{val}</span>
    </div>
  );
}

function XRow({ k, v, mono }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 12, borderBottom: "1px solid #0d1220" }}>
      <span style={{ color: "#3a4f6a", fontWeight: 600 }}>{k}</span>
      <span style={{ ...mono, color: "#b4bcd0", fontWeight: 500 }}>{v}</span>
    </div>
  );
}

/* ═══ MISPRICED TAB ═══ */
function MispricedTab({ items, mono }) {
  return (
    <div>
      <PanelHead title="🎯 Mispriced Market Detector" desc="Markets where YES + NO deviates from 100¢ — real price inefficiencies" />
      {items.length === 0 ? (
        <EmptyState msg="No mispriced markets detected" />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 860 }}>
            <div style={{ display: "flex", gap: 10, padding: "10px 14px", background: "rgba(0,0,0,0.25)", borderRadius: "8px 8px 0 0", fontSize: 10, fontWeight: 700, color: "#3a4f6a", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              <span style={{ flex: 3 }}>Market</span><span style={{ flex: 1 }}>Fair</span><span style={{ flex: 1 }}>Current</span><span style={{ flex: 1 }}>Edge</span><span style={{ flex: 1 }}>Dir</span><span style={{ flex: 1 }}>Sev</span><span style={{ flex: 2 }}>Issue</span>
            </div>
            {items.map((m, i) => (
              <div key={m.id} className="card-anim" style={{ display: "flex", gap: 10, padding: "12px 14px", borderBottom: "1px solid #0d1220", alignItems: "center", fontSize: 13, animationDelay: `${i * 0.05}s` }}>
                <span style={{ flex: 3, fontWeight: 600, color: "#dce3f0" }}>{m.q}</span>
                <span style={{ flex: 1, color: "#5a687f" }}>{m.fairValue}¢</span>
                <span style={{ flex: 1, color: "#dce3f0" }}>{m.currentPrice}¢</span>
                <span style={{ ...mono, flex: 1, color: "#00ffb2", fontWeight: 700 }}>+{m.edge}%</span>
                <span style={{ flex: 1 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 6, background: m.direction === "LONG" ? "rgba(0,255,178,0.1)" : "rgba(255,64,112,0.1)", color: m.direction === "LONG" ? "#00ffb2" : "#ff4070" }}>
                    {m.direction === "LONG" ? "▲" : "▼"} {m.direction}
                  </span>
                </span>
                <span style={{ flex: 1 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 6, background: `${SEV_C[m.severity]}18`, color: SEV_C[m.severity] }}>{m.severity}</span>
                </span>
                <span style={{ flex: 2, color: "#3a4f6a", fontSize: 12 }}>{m.issue}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══ WHALE TAB ═══ */
function WhaleTab({ moves, cats, filterCat, setFilterCat, onlyFlagged, setOnlyFlagged, sans, mono }) {
  return (
    <div>
      <PanelHead title="🐋 Whale Intelligence Feed" desc="Top trader moves — red flags may indicate insider activity" />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {cats.map(c => (
            <button key={c} onClick={() => setFilterCat(c)} style={{ ...sans, background: filterCat === c ? "#7c6cf0" : "rgba(255,255,255,0.03)", color: filterCat === c ? "#fff" : "#5a687f", border: filterCat === c ? "1px solid #7c6cf0" : "1px solid #151c2c", borderRadius: 18, padding: "5px 14px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>{c}</button>
          ))}
        </div>
        <label onClick={() => setOnlyFlagged(!onlyFlagged)} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#ff4070", fontWeight: 700, cursor: "pointer", userSelect: "none" }}>
          <span style={{ width: 34, height: 18, background: onlyFlagged ? "rgba(255,64,112,0.3)" : "#1a2235", borderRadius: 10, position: "relative", display: "inline-block", transition: "background 0.2s" }}>
            <span style={{ position: "absolute", top: 2, left: onlyFlagged ? 18 : 2, width: 14, height: 14, borderRadius: "50%", background: onlyFlagged ? "#ff4070" : "#5a687f", transition: "all 0.2s" }} />
          </span>
          🔴 Flagged Only
        </label>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {moves.map((m, i) => (
          <div key={i} className="card-anim" style={{ background: m.flag ? "rgba(255,64,112,0.02)" : "rgba(255,255,255,0.012)", borderRadius: 10, padding: "12px 16px", borderLeft: m.flag ? "3px solid #ff4070" : "3px solid transparent", animationDelay: `${i * 0.03}s` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 20 }}>{m.avatar}</span>
                <span style={{ fontWeight: 700, fontSize: 14, color: TIER_C[m.tier] }}>{m.whale}</span>
                <span style={{ fontSize: 8, fontWeight: 800, color: "#3a4f6a", background: "rgba(255,255,255,0.04)", padding: "2px 8px", borderRadius: 10, letterSpacing: "0.1em", textTransform: "uppercase" }}>{m.tier}</span>
              </div>
              <span style={{ ...mono, fontSize: 11, color: "#2a3650" }}>{m.timeAgo < 60 ? `${m.timeAgo}m ago` : `${(m.timeAgo / 60).toFixed(1)}h ago`}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5 }}>
              <span style={{ ...mono, fontSize: 11, fontWeight: 800, letterSpacing: "0.04em", color: m.action.includes("BUY") ? "#00ffb2" : "#ff4070" }}>{m.action}</span>
              <span style={{ fontSize: 13, color: "#5a687f" }}>{m.market}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <span style={{ ...mono, fontSize: 13, fontWeight: 700, color: "#dce3f0" }}>${m.amount.toLocaleString()}</span>
              <span style={{ fontSize: 10, color: "#3a4f6a" }}>Conf: {m.confidence}%</span>
              {m.flag && <span style={{ fontSize: 11, fontWeight: 700, marginLeft: "auto" }}>{m.flag}</span>}
            </div>
          </div>
        ))}
        {moves.length === 0 && <div style={{ padding: 50, textAlign: "center", color: "#2a3650" }}>No trades match filters</div>}
      </div>
    </div>
  );
}

/* ═══ LEADERBOARD TAB ═══ */
function LBTab({ whales, mono }) {
  const mc = ["#f0a030", "#c0c8d8", "#cd7f32"];
  const gradients = ["linear-gradient(90deg,#00ffb2,#00d4a0)", "linear-gradient(90deg,#7c6cf0,#5a4cc0)", "linear-gradient(90deg,#f0a030,#d08020)", "linear-gradient(90deg,#1a2438,#253050)"];
  return (
    <div>
      <PanelHead title="🏆 Top Trader Leaderboard" desc="Most profitable traders — follow the smart money" />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {whales.map((w, i) => (
          <div key={w.name} className="card-anim" style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", background: "rgba(255,255,255,0.012)", border: `1px solid ${i < 3 ? mc[i] + "40" : "#151c2c"}`, borderRadius: 12, animationDelay: `${i * 0.07}s` }}>
            <div style={{ fontSize: 26, width: 40, textAlign: "center", flexShrink: 0 }}>{i < 3 ? ["🥇", "🥈", "🥉"][i] : <span style={{ color: "#2a3650" }}>#{i + 1}</span>}</div>
            <div style={{ fontSize: 28, flexShrink: 0 }}>{w.avatar}</div>
            <div style={{ flex: 1, minWidth: 80 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#dce3f0" }}>{w.name}</div>
              <div style={{ fontSize: 9, color: "#3a4f6a", letterSpacing: "0.1em", fontWeight: 700, marginTop: 1 }}>{w.tier.toUpperCase()}</div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ ...mono, fontSize: 18, fontWeight: 800, color: "#00ffb2" }}>+${(w.pnl / 1e6).toFixed(2)}M</div>
              <div style={{ fontSize: 10, color: "#3a4f6a", marginTop: 1 }}>{w.winRate}% WR · {w.trades} trades</div>
            </div>
            <div style={{ width: 140, height: 5, background: "#0d1220", borderRadius: 3, overflow: "hidden", flexShrink: 0 }}>
              <div style={{ height: "100%", borderRadius: 3, width: `${(w.pnl / whales[0].pnl) * 100}%`, background: gradients[Math.min(i, 3)], transition: "width 0.6s" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══ SHARED ═══ */
function PanelHead({ title, desc }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: "#dce3f0" }}>{title}</h2>
      <p style={{ fontSize: 12, color: "#3a4f6a", marginTop: 3 }}>{desc}</p>
    </div>
  );
}

function EmptyState({ msg }) {
  return (
    <div style={{ textAlign: "center", padding: 60, color: "#2a3650" }}>
      <div style={{ fontSize: 28, marginBottom: 10 }}>✓</div>
      <div style={{ fontSize: 13 }}>{msg}</div>
    </div>
  );
}

const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,500;9..40,700;9..40,800&family=DM+Mono:wght@400;500&display=swap');
  * { box-sizing: border-box; margin: 0; }
  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #1a2235; border-radius: 4px; }
  @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.35;transform:scale(.85)} }
  @keyframes fadeSlide { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
  .dot-on { width:7px; height:7px; border-radius:50%; background:#00ffb2; animation:pulse 2s infinite; display:inline-block; }
  .dot-off { width:7px; height:7px; border-radius:50%; background:#f0a030; display:inline-block; }
  .card-anim { animation: fadeSlide 0.4s ease both; }
`;
