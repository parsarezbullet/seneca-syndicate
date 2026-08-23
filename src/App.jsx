import { useState, useEffect, useCallback } from "react";
import { supabase, bookings, flightLogs, isOverlapError } from "./supabaseClient";

/* ============================================================================
   SENECA SYNDICATE — booking + flight-log record keeping (Supabase, mobile-first)
   EDIT MEMBERS + PINS HERE. PINs are lightweight, not real security.
   ============================================================================ */
const BRAND = { ink: "#1A312C", teal: "#428475", mint: "#89D7B7", cream: "#FFF4E1" };

const MEMBERS = [
  { id: "parsa", name: "Parsa", pin: "7190", color: "#237A55", fg: BRAND.cream }, // green
  { id: "ali_r", name: "Ali R.", pin: "1219", color: "#C2632B", fg: BRAND.cream }, // orange
  { id: "ali_b", name: "Ali B.", pin: "1896", color: "#335F9E", fg: BRAND.cream }, // blue
];
const VIEW_PIN = "0000";
const TAIL = "N1896S";
/* Club rule: every member replaces 25 gallons of fuel for each Hobbs hour flown. */
const FUEL_PER_HOBBS_HOUR = 25;

/* ------------------------------ helpers ----------------------------------- */
const pad = (n) => String(n).padStart(2, "0");
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const startOfWeek = (d) => addDays(d, -d.getDay());
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const sameDay = (a, b) => fmtDate(a) === fmtDate(b);
const todayStr = () => fmtDate(new Date());
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MO_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pretty12 = (hhmm) => { if (!hhmm) return ""; let [h, m] = hhmm.split(":").map(Number); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return `${h}:${pad(m)} ${ap}`; };
const memberById = (id) => MEMBERS.find((m) => m.id === id) || MEMBERS[0];
const spanStart = (b) => `${b.startDate}T${b.startTime}`;
const spanEnd = (b) => `${b.endDate}T${b.endTime}`;
const isMulti = (b) => b.startDate !== b.endDate;
const coversDay = (b, ds) => b.startDate <= ds && ds <= b.endDate;
const overlap = (aS, aE, bS, bE) => aS < bE && bS < aE;
const fmtCardDate = (ds) => { const d = parseDate(ds); return `${WD[d.getDay()]} ${MO[d.getMonth()]} ${d.getDate()}`; };
const rangeLabel = (b) => isMulti(b)
  ? `${fmtCardDate(b.startDate)}, ${pretty12(b.startTime)}  →  ${fmtCardDate(b.endDate)}, ${pretty12(b.endTime)}`
  : `${fmtCardDate(b.startDate)} · ${pretty12(b.startTime)} – ${pretty12(b.endTime)}`;
const n1 = (v) => (v == null || v === "" ? "—" : Number(v).toFixed(1));
const money = (v) => (v == null || v === "" ? "—" : `$${Number(v).toFixed(2)}`);
const sum = (arr) => arr.reduce((a, b) => a + (Number(b) || 0), 0);
/* fuel duty: gallons a flight obliges you to put back, and how you stand against it */
const galDue = (hobbsTime) => (hobbsTime == null || hobbsTime === "" ? null : Number(hobbsTime) * FUEL_PER_HOBBS_HOUR);
const balLabel = (b) => (Math.abs(b) < 0.05 ? "even" : b < 0 ? `${Math.abs(b).toFixed(1)} gal short` : `${b.toFixed(1)} gal over`);
const balColor = (b) => (b < -0.05 ? "#b3261e" : BRAND.teal);

/* =============================== app ====================================== */
export default function App() {
  const [user, setUser] = useState(null);
  return (
    <div style={{ fontFamily: "system-ui, -apple-system, sans-serif", color: BRAND.ink }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        body { margin: 0; }
        .ss-display { font-family: 'Space Grotesk', system-ui, sans-serif; }
        .ss-mono { font-family: 'Space Mono', ui-monospace, monospace; }
        .ss-root *:focus-visible { outline: 2px solid ${BRAND.teal}; outline-offset: 2px; border-radius: 6px; }
        .ss-btn { transition: filter .12s ease, transform .06s ease; }
        .ss-btn:active { transform: scale(.98); }
        .ss-strip { transition: transform .1s ease, box-shadow .1s ease; }
        .ss-strip:active { transform: scale(.99); }
        .ss-pick { transition: transform .12s ease, box-shadow .12s ease, opacity .12s ease; position: relative; }
        @media (prefers-reduced-motion: reduce){ .ss-btn,.ss-strip,.ss-pick{transition:none} }
        .ss-wrap { position: fixed; inset: 0; background: rgba(26,49,44,.55); display: flex; align-items: flex-end; justify-content: center; z-index: 60; }
        .ss-sheet { background:#fff; width:100%; max-width:480px; border-radius:22px 22px 0 0; padding:20px; padding-bottom: max(20px, env(safe-area-inset-bottom)); max-height:93vh; overflow-y:auto; box-shadow:0 -12px 40px rgba(26,49,44,.32); }
        @media (min-width:600px){ .ss-wrap{align-items:center} .ss-sheet{border-radius:22px; max-height:90vh; box-shadow:0 20px 50px rgba(26,49,44,.3)} }
        .ss-bar { position: fixed; left:0; right:0; bottom:0; z-index:40; background:${BRAND.cream}; border-top:1px solid #e6ded0; padding:12px 14px; padding-bottom: max(12px, env(safe-area-inset-bottom)); }
        .ss-in { width:100%; padding:13px 14px; font-size:16px; border-radius:12px; border:1px solid ${BRAND.mint}; background:${BRAND.cream}; color:${BRAND.ink}; }
      `}</style>
      <div className="ss-root" style={{ minHeight: "100vh", background: BRAND.cream }}>
        {user ? <Scheduler user={user} onLogout={() => setUser(null)} /> : <Login onLogin={setUser} />}
      </div>
    </div>
  );
}

/* =============================== login ==================================== */
function Login({ onLogin }) {
  const [sel, setSel] = useState(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const enter = () => {
    const m = MEMBERS.find((x) => x.id === sel);
    if (!m) { setErr("Tap your name first, then enter your PIN."); return; }
    if (pin === m.pin) onLogin(m); else { setErr("That PIN doesn't match. Try again."); setPin(""); }
  };
  const view = () => {
    if (pin === VIEW_PIN || MEMBERS.some((m) => m.pin === pin)) onLogin({ id: "viewer", name: "Viewer", readOnly: true });
    else { setErr("Enter a valid PIN to view."); setPin(""); }
  };
  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "100vh", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <Wordmark center />
        <p className="ss-mono" style={{ textAlign: "center", marginTop: 6, marginBottom: 26, opacity: 0.7, letterSpacing: 1 }}>{TAIL} · PIPER SENECA V</p>
        <div style={{ background: "#fff", borderRadius: 20, padding: 22, border: `1px solid ${BRAND.mint}`, boxShadow: "0 10px 30px rgba(26,49,44,.08)" }}>
          <label className="ss-display" style={{ fontWeight: 600, fontSize: 15, display: "block", marginBottom: 10 }}>Who's flying?</label>
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            {MEMBERS.map((m) => {
              const active = sel === m.id, dim = sel && !active;
              return (
                <button key={m.id} className="ss-pick ss-btn" aria-pressed={active} onClick={() => { setSel(m.id); setErr(""); }}
                  style={{ flex: 1, minHeight: 54, cursor: "pointer", borderRadius: 14, border: active ? `3px solid ${BRAND.ink}` : "3px solid transparent",
                    background: m.color, color: m.fg, fontWeight: active ? 700 : 600, fontSize: 15, opacity: dim ? 0.45 : 1,
                    transform: active ? "translateY(-2px) scale(1.04)" : "none", boxShadow: active ? "0 8px 20px rgba(26,49,44,.28)" : "none" }}>
                  {m.name}
                  {active && <span style={{ position: "absolute", top: -8, right: -8, width: 24, height: 24, borderRadius: "50%", background: BRAND.ink, color: BRAND.cream, fontSize: 14, lineHeight: "24px", border: `2px solid ${BRAND.cream}` }}>✓</span>}
                </button>
              );
            })}
          </div>
          <div className="ss-mono" style={{ minHeight: 18, fontSize: 12, marginBottom: 8, color: sel ? BRAND.teal : "transparent" }}>{sel ? `Selected — ${memberById(sel).name}` : "·"}</div>
          <label className="ss-display" style={{ fontWeight: 600, fontSize: 15, display: "block", marginBottom: 10 }}>PIN</label>
          <input className="ss-mono ss-in" type="password" inputMode="numeric" value={pin} placeholder="••••"
            onChange={(e) => { setPin(e.target.value); setErr(""); }} onKeyDown={(e) => e.key === "Enter" && enter()} style={{ fontSize: 18, letterSpacing: 4 }} />
          {err && <p style={{ color: "#b3261e", fontSize: 13, marginTop: 10, marginBottom: 0 }}>{err}</p>}
          <button className="ss-btn" onClick={enter} style={{ width: "100%", minHeight: 52, marginTop: 18, cursor: "pointer", borderRadius: 14, border: "none", background: BRAND.ink, color: BRAND.cream, fontWeight: 700, fontSize: 16 }}>Sign in</button>
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0 14px" }}>
            <span style={{ flex: 1, height: 1, background: "#e6ded0" }} /><span className="ss-mono" style={{ fontSize: 11, opacity: 0.5 }}>OR</span><span style={{ flex: 1, height: 1, background: "#e6ded0" }} />
          </div>
          <button className="ss-btn" onClick={view} style={{ width: "100%", minHeight: 48, cursor: "pointer", borderRadius: 14, border: `1px solid ${BRAND.teal}`, background: "transparent", color: BRAND.teal, fontWeight: 600, fontSize: 15 }}>View only (read-only)</button>
        </div>
      </div>
    </div>
  );
}

/* ============================== scheduler ================================= */
function Scheduler({ user, onLogout }) {
  const readOnly = !!user.readOnly;
  const [reservations, setReservations] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [banner, setBanner] = useState(null);
  const [view, setView] = useState("upcoming"); // 'upcoming' | 'month' | 'logbook'
  const [anchor, setAnchor] = useState(() => new Date());
  const [sheet, setSheet] = useState(null);
  const [daySheet, setDaySheet] = useState(null);
  const [logSheet, setLogSheet] = useState(null);
  const today = new Date();

  const refresh = useCallback(async () => {
    try { const [b, l] = await Promise.all([bookings.list(), flightLogs.list()]); setReservations(b); setLogs(l); setLoadError(false); }
    catch { setLoadError(true); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    refresh();
    const ch = supabase.channel("ss-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, () => refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "flight_logs" }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [refresh]);

  const conflictFor = (draft) => reservations.find((r) => r.id !== draft.id && overlap(spanStart(draft), spanEnd(draft), spanStart(r), spanEnd(r)));
  const saveReservation = async (draft) => {
    try {
      if (draft.id) { const u = await bookings.update(draft); setReservations((rs) => rs.map((r) => (r.id === u.id ? u : r))); }
      else { const c = await bookings.create(draft); setReservations((rs) => [...rs, c]); }
      setSheet(null); setBanner(null);
    } catch (e) { setBanner(isOverlapError(e) ? "That time was just taken — pick another slot." : "Couldn't save. Check your connection."); }
  };
  const deleteReservation = async (id) => {
    try { await bookings.remove(id); setReservations((rs) => rs.filter((r) => r.id !== id)); setSheet(null); setBanner(null); }
    catch { setBanner("Couldn't delete. Try again."); }
  };
  const saveLog = async (draft) => {
    try {
      if (draft.id) { const u = await flightLogs.update(draft); setLogs((ls) => ls.map((r) => (r.id === u.id ? u : r))); }
      else { const c = await flightLogs.create(draft); setLogs((ls) => [c, ...ls]); }
      setLogSheet(null); setBanner(null);
    } catch { setBanner("Couldn't save the flight log. Check your entries and try again."); }
  };
  const deleteLog = async (id) => {
    try { await flightLogs.remove(id); setLogs((ls) => ls.filter((r) => r.id !== id)); setLogSheet(null); setBanner(null); }
    catch { setBanner("Couldn't delete the log. Try again."); }
  };

  const openNew = (presetDate) => setSheet({ presetDate: presetDate || todayStr() });
  const latestEnds = {
    hobbs: logs.find((l) => l.hobbsEnd != null)?.hobbsEnd,
    fuel: logs.find((l) => l.fuelEnd != null)?.fuelEnd,
  };
  const primaryAction = view === "logbook"
    ? { label: "＋  Log a flight", onClick: () => setLogSheet({}) }
    : { label: "✈  Book the plane", onClick: () => openNew(todayStr()) };

  return (
    <div style={{ paddingBottom: readOnly ? 24 : 96 }}>
      <header style={{ background: BRAND.ink, color: BRAND.cream, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Wordmark small />
          <span className="ss-mono" style={{ fontSize: 11, padding: "3px 7px", borderRadius: 6, border: `1px solid ${BRAND.mint}`, color: BRAND.mint, letterSpacing: 1 }}>{TAIL}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {readOnly ? <span className="ss-mono" style={{ fontSize: 11, padding: "3px 9px", borderRadius: 999, background: BRAND.teal, color: BRAND.cream }}>READ-ONLY</span>
            : <span style={{ fontSize: 13 }}><span style={{ opacity: 0.6 }}>PIC </span><strong>{user.name}</strong></span>}
          <button className="ss-btn" onClick={onLogout} style={{ cursor: "pointer", background: "transparent", color: BRAND.cream, border: `1px solid ${BRAND.teal}`, borderRadius: 8, padding: "6px 11px", fontSize: 13, minHeight: 36 }}>Sign out</button>
        </div>
      </header>

      <div style={{ maxWidth: 760, margin: "0 auto", padding: "14px 14px 0" }}>
        <div style={{ display: "flex", border: `1px solid ${BRAND.ink}`, borderRadius: 12, overflow: "hidden" }}>
          {[["upcoming", "Upcoming"], ["month", "Month"], ["logbook", "Logbook"]].map(([k, lbl]) => (
            <button key={k} className="ss-btn" onClick={() => setView(k)}
              style={{ flex: 1, cursor: "pointer", border: "none", padding: "11px 6px", fontSize: 14.5, fontWeight: 600, minHeight: 46, background: view === k ? BRAND.ink : "transparent", color: view === k ? BRAND.cream : BRAND.ink }}>{lbl}</button>
          ))}
        </div>
      </div>

      {banner && (
        <div style={{ maxWidth: 760, margin: "12px auto 0", padding: "0 14px" }}>
          <div style={{ background: "#fdecea", color: "#b3261e", border: "1px solid #f5c2bd", borderRadius: 12, padding: "11px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 13.5 }}>{banner}</span>
            <button className="ss-btn" onClick={() => setBanner(null)} style={{ cursor: "pointer", border: "none", background: "transparent", color: "#b3261e", fontSize: 20, lineHeight: 1 }}>×</button>
          </div>
        </div>
      )}

      <div style={{ maxWidth: 760, margin: "0 auto", padding: "16px 14px 8px" }}>
        {loading ? <p className="ss-mono" style={{ opacity: 0.6 }}>Loading…</p>
          : loadError ? <p className="ss-mono" style={{ color: "#b3261e" }}>Couldn't reach Supabase. Make sure the schema has been run.</p>
          : view === "upcoming" ? <UpcomingList reservations={reservations} user={user} readOnly={readOnly} onEdit={(b) => setSheet({ reservation: b })} />
          : view === "month" ? <MonthView anchor={anchor} setAnchor={setAnchor} today={today} reservations={reservations} logs={logs} onDay={setDaySheet} />
          : <Logbook logs={logs} user={user} readOnly={readOnly} onEdit={(l) => setLogSheet({ log: l })} latestEnds={latestEnds} />}
      </div>

      {view !== "logbook" && (
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "4px 14px 24px", display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          {MEMBERS.map((m) => (
            <span key={m.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
              <span style={{ width: 13, height: 13, borderRadius: 4, background: m.color, border: `1px solid ${BRAND.ink}33` }} />{m.name}
            </span>
          ))}
          <span className="ss-mono" style={{ fontSize: 10.5, opacity: 0.4, marginLeft: "auto" }}>live · supabase</span>
        </div>
      )}

      {!readOnly && (
        <div className="ss-bar">
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <button className="ss-btn" onClick={primaryAction.onClick}
              style={{ width: "100%", minHeight: 54, cursor: "pointer", border: "none", borderRadius: 15, background: BRAND.teal, color: BRAND.cream, fontWeight: 700, fontSize: 17 }}>{primaryAction.label}</button>
          </div>
        </div>
      )}

      {sheet && <BookingSheet user={user} initial={sheet.reservation} presetDate={sheet.presetDate} conflictFor={conflictFor} onSave={saveReservation} onDelete={deleteReservation} onClose={() => setSheet(null)} />}
      {daySheet && <DaySheet dateStr={daySheet} reservations={reservations} logs={logs} user={user} readOnly={readOnly}
        onEdit={(b) => { setDaySheet(null); setSheet({ reservation: b }); }}
        onEditLog={(l) => { setDaySheet(null); setLogSheet({ log: l }); }}
        onBook={() => { const d = daySheet; setDaySheet(null); openNew(d); }}
        onLogDay={() => { const d = daySheet; setDaySheet(null); setLogSheet({ presetDate: d }); }}
        onClose={() => setDaySheet(null)} />}
      {logSheet && <FlightLogSheet user={user} initial={logSheet.log} presetDate={logSheet.presetDate} latestEnds={latestEnds} onSave={saveLog} onDelete={deleteLog} onClose={() => setLogSheet(null)} />}
    </div>
  );
}

/* ----------------------------- upcoming list ------------------------------ */
function UpcomingList({ reservations, user, readOnly, onEdit }) {
  const t = todayStr();
  const list = reservations.filter((r) => r.endDate >= t).sort((a, b) => spanStart(a).localeCompare(spanStart(b)));
  if (list.length === 0) return (
    <div style={{ textAlign: "center", padding: "40px 16px", background: "#fff", borderRadius: 16, border: "1px dashed #d9cfbd" }}>
      <div style={{ fontSize: 34 }}>🛩️</div>
      <p className="ss-display" style={{ fontWeight: 600, margin: "8px 0 4px" }}>The plane is wide open</p>
      <p style={{ fontSize: 13.5, opacity: 0.7, margin: 0 }}>{readOnly ? "No bookings yet." : "Tap “Book the plane” below to grab a slot or plan a trip."}</p>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {list.map((b) => { const mine = !readOnly && b.userId === user.id; return <BookingCard key={b.id} b={b} mine={mine} onClick={mine ? () => onEdit(b) : undefined} />; })}
    </div>
  );
}
function BookingCard({ b, mine, onClick }) {
  const m = memberById(b.userId);
  return (
    <button onClick={onClick} className="ss-strip" style={{ textAlign: "left", width: "100%", display: "block", cursor: mine ? "pointer" : "default", border: "none", borderLeft: `6px solid ${BRAND.ink}`, borderRadius: 14, padding: "13px 15px", background: m.color, color: m.fg }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 15.5 }}>{m.name}</span>
        {isMulti(b) && <span className="ss-mono" style={{ fontSize: 10, padding: "2px 8px", borderRadius: 999, background: "rgba(0,0,0,.18)" }}>MULTI-DAY</span>}
      </div>
      <div className="ss-mono" style={{ fontSize: 13, fontWeight: 700, marginTop: 5 }}>{rangeLabel(b)}</div>
      {b.note && <div style={{ fontSize: 12.5, opacity: 0.9, marginTop: 4 }}>{b.note}</div>}
      {mine && <div style={{ fontSize: 11, opacity: 0.8, marginTop: 6 }}>Tap to edit</div>}
    </button>
  );
}

/* ------------------------------- month view ------------------------------- */
function MonthView({ anchor, setAnchor, today, reservations, logs, onDay }) {
  const gridStart = startOfWeek(startOfMonth(anchor));
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const month = anchor.getMonth();
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 8 }}>
        <button className="ss-btn" onClick={() => setAnchor(addMonths(anchor, -1))} style={navStyle}>‹</button>
        <div style={{ textAlign: "center" }}>
          <div className="ss-display" style={{ fontSize: 18, fontWeight: 700 }}>{MO_FULL[anchor.getMonth()]} {anchor.getFullYear()}</div>
          <button className="ss-btn" onClick={() => setAnchor(new Date())} style={{ cursor: "pointer", border: "none", background: "transparent", color: BRAND.teal, fontSize: 12.5, fontWeight: 600, padding: 2 }}>Jump to today</button>
        </div>
        <button className="ss-btn" onClick={() => setAnchor(addMonths(anchor, 1))} style={navStyle}>›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, marginBottom: 4 }}>
        {WD.map((w) => <div key={w} className="ss-mono" style={{ textAlign: "center", fontSize: 10, opacity: 0.5 }}>{w[0]}</div>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gridAutoRows: "minmax(56px,1fr)", gap: 4 }}>
        {cells.map((d) => {
          const ds = fmtDate(d), inMonth = d.getMonth() === month, isToday = sameDay(d, today);
          const covering = reservations.filter((r) => coversDay(r, ds));
          const flown = logs.filter((l) => l.date === ds);
          const bg = covering.length === 1 ? memberById(covering[0].userId).color + "33" : covering.length > 1 ? BRAND.mint + "55" : (inMonth ? "#fff" : "#faf6ec");
          return (
            <button key={ds} className="ss-btn" onClick={() => onDay(ds)} style={{ cursor: "pointer", border: `1px solid ${isToday ? BRAND.teal : "#e6ded0"}`, borderRadius: 10, background: bg, padding: 5, display: "flex", flexDirection: "column", alignItems: "stretch", gap: 4, opacity: inMonth ? 1 : 0.5, minHeight: 56 }}>
              <span className="ss-display" style={{ fontSize: 13, fontWeight: isToday ? 700 : 600, alignSelf: "flex-start", background: isToday ? BRAND.teal : "transparent", color: isToday ? BRAND.cream : BRAND.ink, borderRadius: 6, minWidth: 21, textAlign: "center", padding: isToday ? "1px 5px" : "1px 0", lineHeight: "16px" }}>{d.getDate()}</span>
              <div style={{ display: "flex", gap: 3, flexWrap: "wrap", alignItems: "center" }}>
                {covering.slice(0, 4).map((b) => <span key={b.id} style={{ width: 7, height: 7, borderRadius: "50%", background: memberById(b.userId).color, border: `1px solid ${BRAND.ink}44` }} />)}
                {flown.slice(0, 3).map((l) => <span key={l.id} style={{ fontSize: 9, lineHeight: 1, color: memberById(l.userId).color }}>✈</span>)}
              </div>
            </button>
          );
        })}
      </div>
      <p className="ss-mono" style={{ fontSize: 11, opacity: 0.5, marginTop: 10, textAlign: "center" }}>● booked · ✈ flown — tap any day for details.</p>
    </div>
  );
}
const navStyle = { cursor: "pointer", border: `1px solid ${BRAND.ink}`, background: "transparent", color: BRAND.ink, borderRadius: 10, width: 44, height: 44, fontSize: 22, lineHeight: 1, fontWeight: 700 };

/* -------------------------------- day sheet ------------------------------- */
function DaySheet({ dateStr, reservations, logs, user, readOnly, onEdit, onEditLog, onBook, onLogDay, onClose }) {
  const dayRes = reservations.filter((r) => coversDay(r, dateStr)).sort((a, b) => spanStart(a).localeCompare(spanStart(b)));
  const dayFlown = logs.filter((l) => l.date === dateStr);
  return (
    <div className="ss-wrap" onClick={onClose}>
      <div className="ss-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetHead title={fmtCardDate(dateStr)} onClose={onClose} />

        {dayRes.length === 0 && dayFlown.length === 0
          ? <p style={{ fontSize: 14, opacity: 0.7, margin: "0 0 16px" }}>Nothing booked — the plane's free this day.</p>
          : null}

        {dayRes.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
            {dayRes.map((b) => { const mine = !readOnly && b.userId === user.id; return <BookingCard key={b.id} b={b} mine={mine} onClick={mine ? () => onEdit(b) : undefined} />; })}
          </div>
        )}

        {dayFlown.length > 0 && (
          <>
            <div className="ss-mono" style={{ fontSize: 11, opacity: 0.55, letterSpacing: 1, margin: "2px 0 8px" }}>✈ FLOWN THIS DAY</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
              {dayFlown.map((l) => { const mine = !readOnly && l.userId === user.id; return <LogCard key={l.id} l={l} mine={mine} onClick={mine ? () => onEditLog(l) : undefined} />; })}
            </div>
          </>
        )}

        {!readOnly && (
          <div style={{ display: "flex", gap: 10 }}>
            <button className="ss-btn" onClick={onBook} style={{ cursor: "pointer", minHeight: 52, flex: 1, border: "none", background: BRAND.teal, color: BRAND.cream, borderRadius: 14, fontWeight: 700, fontSize: 15 }}>✈  Book</button>
            <button className="ss-btn" onClick={onLogDay} style={{ cursor: "pointer", minHeight: 52, flex: 1, border: `1px solid ${BRAND.ink}`, background: "transparent", color: BRAND.ink, borderRadius: 14, fontWeight: 700, fontSize: 15 }}>＋  Log flight</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------- logbook --------------------------------- */
function Logbook({ logs, user, readOnly, onEdit, latestEnds }) {
  return (
    <div>
      {/* aircraft status */}
      <div style={{ background: BRAND.ink, color: BRAND.cream, borderRadius: 16, padding: "16px 18px", marginBottom: 14 }}>
        <div className="ss-mono" style={{ fontSize: 11, opacity: 0.6, letterSpacing: 1, marginBottom: 8 }}>AIRCRAFT NOW · {TAIL}</div>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          <Stat label="Hobbs" value={n1(latestEnds.hobbs)} />
          <Stat label="Fuel (gal)" value={n1(latestEnds.fuel)} />
        </div>
        <div className="ss-mono" style={{ fontSize: 11.5, marginTop: 13, paddingTop: 11, borderTop: `1px solid rgba(137,215,183,.3)`, color: BRAND.mint, letterSpacing: 0.4 }}>
          FUEL DUTY · {FUEL_PER_HOBBS_HOUR} GAL PER HOBBS HOUR
        </div>
        <div style={{ fontSize: 12.5, opacity: 0.75, marginTop: 4 }}>
          Every member puts back {FUEL_PER_HOBBS_HOUR} gallons for each Hobbs hour they fly.
        </div>
      </div>

      {/* per-member usage */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 16 }}>
        {MEMBERS.map((m) => {
          const mine = logs.filter((l) => l.userId === m.id);
          const hrs = sum(mine.map((l) => l.hobbsTime));
          const fuel$ = sum(mine.map((l) => l.fuelCost));
          const bal = sum(mine.map((l) => l.fuelAdded)) - sum(mine.map((l) => galDue(l.hobbsTime)));
          return (
            <div key={m.id} style={{ background: "#fff", border: `1px solid #e6ded0`, borderTop: `4px solid ${m.color}`, borderRadius: 12, padding: "10px 11px" }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>{m.name}</div>
              <div className="ss-mono" style={{ fontSize: 12.5 }}>{hrs.toFixed(1)} hrs</div>
              <div className="ss-mono" style={{ fontSize: 12, opacity: 0.7 }}>{money(fuel$)} fuel</div>
              <div className="ss-mono" style={{ fontSize: 11.5, fontWeight: 700, marginTop: 6, paddingTop: 6, borderTop: "1px solid #f0e9dc", color: mine.length ? balColor(bal) : "inherit", opacity: mine.length ? 1 : 0.4 }}>
                {mine.length ? balLabel(bal) : "—"}
              </div>
            </div>
          );
        })}
      </div>

      {logs.length === 0 ? (
        <div style={{ textAlign: "center", padding: "34px 16px", background: "#fff", borderRadius: 16, border: "1px dashed #d9cfbd" }}>
          <div style={{ fontSize: 30 }}>📋</div>
          <p className="ss-display" style={{ fontWeight: 600, margin: "8px 0 4px" }}>No flights logged yet</p>
          <p style={{ fontSize: 13.5, opacity: 0.7, margin: 0 }}>{readOnly ? "" : "After you fly, tap “Log a flight” to record Hobbs and fuel."}</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {logs.map((l) => { const mine = !readOnly && l.userId === user.id; return <LogCard key={l.id} l={l} mine={mine} onClick={mine ? () => onEdit(l) : undefined} />; })}
        </div>
      )}
    </div>
  );
}
function Stat({ label, value }) {
  return (<div><div className="ss-display" style={{ fontSize: 24, fontWeight: 700, lineHeight: 1 }}>{value}</div><div className="ss-mono" style={{ fontSize: 10.5, opacity: 0.65, marginTop: 3 }}>{label}</div></div>);
}
function LogCard({ l, mine, onClick }) {
  const m = memberById(l.userId);
  const due = galDue(l.hobbsTime);
  const bal = due == null ? null : (Number(l.fuelAdded) || 0) - due;
  return (
    <button onClick={onClick} className="ss-strip" style={{ textAlign: "left", width: "100%", display: "block", cursor: mine ? "pointer" : "default", border: "1px solid #e6ded0", borderLeft: `6px solid ${m.color}`, borderRadius: 14, padding: "13px 15px", background: "#fff", color: BRAND.ink }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{fmtCardDate(l.date)}</span>
        <span className="ss-mono" style={{ fontSize: 11.5, opacity: 0.7 }}>{m.name}</span>
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 8 }}>
        <Mini label="Hobbs" value={l.hobbsTime != null ? `${n1(l.hobbsTime)} hr` : "—"} />
        <Mini label="Burned" value={l.fuelBurned != null ? `${n1(l.fuelBurned)} gal` : "—"} />
        <Mini label="Added" value={l.fuelAdded != null ? `${n1(l.fuelAdded)} gal` : "—"} />
        <Mini label="Fuel $" value={money(l.fuelCost)} />
      </div>
      {due != null && (
        <div className="ss-mono" style={{ fontSize: 11.5, fontWeight: 700, marginTop: 8, color: balColor(bal) }}>
          {n1(due)} gal due · {n1(l.fuelAdded ?? 0)} added · {balLabel(bal)}
        </div>
      )}
      <div className="ss-mono" style={{ fontSize: 10.5, opacity: 0.55, marginTop: 8 }}>
        Hobbs {n1(l.hobbsStart)}→{n1(l.hobbsEnd)}
      </div>
      {l.notes && <div style={{ fontSize: 12.5, opacity: 0.85, marginTop: 6 }}>{l.notes}</div>}
      {mine && <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>Tap to edit</div>}
    </button>
  );
}
function Mini({ label, value }) {
  return (<div><div className="ss-mono" style={{ fontSize: 13.5, fontWeight: 700 }}>{value}</div><div className="ss-mono" style={{ fontSize: 9.5, opacity: 0.55, letterSpacing: 0.5 }}>{label.toUpperCase()}</div></div>);
}

/* ------------------------------ booking sheet ----------------------------- */
function BookingSheet({ user, initial, presetDate, conflictFor, onSave, onDelete, onClose }) {
  const editing = !!initial;
  const startInit = initial?.startDate || presetDate || todayStr();
  const [multi, setMulti] = useState(editing ? initial.startDate !== initial.endDate : false);
  const [startDate, setStartDate] = useState(startInit);
  const [endDate, setEndDate] = useState(initial?.endDate || startInit);
  const [startTime, setStartTime] = useState(initial?.startTime || "09:00");
  const [endTime, setEndTime] = useState(initial?.endTime || "11:00");
  const [note, setNote] = useState(initial?.note || "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const goMulti = (on) => { setMulti(on); setErr(""); if (on && endDate < startDate) setEndDate(startDate); };
  const onStartDate = (v) => { setStartDate(v); setErr(""); if (!multi || endDate < v) setEndDate(v); };
  const submit = async () => {
    const ed = multi ? endDate : startDate;
    if (!startDate) { setErr("Pick a date."); return; }
    const draft = { id: initial?.id, userId: user.id, startDate, startTime, endDate: ed, endTime, note: note.trim() };
    if (spanEnd(draft) <= spanStart(draft)) { setErr(multi ? "The end must be after the start." : "End time must be after start time."); return; }
    const clash = conflictFor(draft);
    if (clash) { setErr(`Overlaps ${memberById(clash.userId).name}'s booking (${rangeLabel(clash)}).`); return; }
    setBusy(true); await onSave(draft); setBusy(false);
  };
  return (
    <div className="ss-wrap" onClick={onClose}>
      <div className="ss-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetHead title={editing ? "Edit booking" : "Book the plane"} sub={`${TAIL} · ${user.name}`} onClose={onClose} />
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          {[[false, "A few hours"], [true, "Multi-day trip"]].map(([val, lbl]) => (
            <button key={lbl} className="ss-btn" onClick={() => goMulti(val)} style={{ flex: 1, minHeight: 50, cursor: "pointer", borderRadius: 13, fontWeight: 700, fontSize: 14.5, border: multi === val ? `2px solid ${BRAND.ink}` : "2px solid #e6ded0", background: multi === val ? BRAND.ink : "#fff", color: multi === val ? BRAND.cream : BRAND.ink }}>{lbl}</button>
          ))}
        </div>
        {!multi ? (
          <>
            <Field label="Day"><input type="date" className="ss-in" value={startDate} onChange={(e) => onStartDate(e.target.value)} /></Field>
            <div style={{ display: "flex", gap: 12 }}>
              <Field label="From"><input type="time" className="ss-in" value={startTime} onChange={(e) => { setStartTime(e.target.value); setErr(""); }} /></Field>
              <Field label="To"><input type="time" className="ss-in" value={endTime} onChange={(e) => { setEndTime(e.target.value); setErr(""); }} /></Field>
            </div>
          </>
        ) : (
          <>
            <label className="ss-display" style={labelStyle}>Starts</label>
            <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
              <input type="date" className="ss-in" value={startDate} onChange={(e) => onStartDate(e.target.value)} style={{ flex: 1.4 }} />
              <input type="time" className="ss-in" value={startTime} onChange={(e) => { setStartTime(e.target.value); setErr(""); }} style={{ flex: 1 }} />
            </div>
            <label className="ss-display" style={labelStyle}>Ends</label>
            <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
              <input type="date" className="ss-in" value={endDate} min={startDate} onChange={(e) => { setEndDate(e.target.value); setErr(""); }} style={{ flex: 1.4 }} />
              <input type="time" className="ss-in" value={endTime} onChange={(e) => { setEndTime(e.target.value); setErr(""); }} style={{ flex: 1 }} />
            </div>
          </>
        )}
        <Field label="Note (optional)"><input type="text" className="ss-in" value={note} maxLength={60} placeholder="XC to KSBA, IFR practice…" onChange={(e) => setNote(e.target.value)} /></Field>
        {err && <p style={{ color: "#b3261e", fontSize: 13.5, margin: "2px 0 0" }}>{err}</p>}
        <SheetActions editing={editing} busy={busy} onDelete={() => onDelete(initial.id)} onSubmit={submit} submitLabel={editing ? "Save" : "Reserve"} />
      </div>
    </div>
  );
}

/* ----------------------------- flight log sheet --------------------------- */
function FlightLogSheet({ user, initial, presetDate, latestEnds, onSave, onDelete, onClose }) {
  const editing = !!initial;
  const [date, setDate] = useState(initial?.date || presetDate || todayStr());
  const [hobbsStart, setHobbsStart] = useState(initial?.hobbsStart ?? latestEnds.hobbs ?? "");
  const [hobbsEnd, setHobbsEnd] = useState(initial?.hobbsEnd ?? "");
  const [fuelStart, setFuelStart] = useState(initial?.fuelStart ?? latestEnds.fuel ?? "");
  const [fuelEnd, setFuelEnd] = useState(initial?.fuelEnd ?? "");
  const [fuelAdded, setFuelAdded] = useState(initial?.fuelAdded ?? "");
  const [fuelCost, setFuelCost] = useState(initial?.fuelCost ?? "");
  const [notes, setNotes] = useState(initial?.notes || "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const ck = (a, b) => a !== "" && a != null && b !== "" && b != null && Number(b) < Number(a);
  const numOr = (v) => (v === "" || v == null ? null : Number(v));
  const hrsNow = (() => { const a = numOr(hobbsStart), b = numOr(hobbsEnd); return a != null && b != null && b >= a ? b - a : null; })();
  const dueNow = hrsNow == null ? null : hrsNow * FUEL_PER_HOBBS_HOUR;
  const addedNow = numOr(fuelAdded) ?? 0;
  const balNow = dueNow == null ? null : addedNow - dueNow;
  const submit = async () => {
    if (!date) { setErr("Pick the flight date."); return; }
    if (ck(hobbsStart, hobbsEnd)) { setErr("Hobbs end can't be less than Hobbs start."); return; }
    const draft = { id: initial?.id, userId: user.id, bookingId: initial?.bookingId, date,
      hobbsStart, hobbsEnd, fuelStart, fuelEnd, fuelAdded, fuelCost, notes: notes.trim() };
    setBusy(true); await onSave(draft); setBusy(false);
  };
  return (
    <div className="ss-wrap" onClick={onClose}>
      <div className="ss-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetHead title={editing ? "Edit flight log" : "Log a flight"} sub={`${TAIL} · ${user.name}`} onClose={onClose} />
        <Field label="Flight date"><input type="date" className="ss-in" value={date} onChange={(e) => { setDate(e.target.value); setErr(""); }} /></Field>
        <Pair label="Hobbs" a={hobbsStart} setA={setHobbsStart} b={hobbsEnd} setB={setHobbsEnd} clr={() => setErr("")} />
        <Pair label="Fuel on board (gal)" a={fuelStart} setA={setFuelStart} b={fuelEnd} setB={setFuelEnd} clr={() => setErr("")} />
        <div style={{ display: "flex", gap: 12 }}>
          <Field label="Fuel added (gal)"><input type="number" inputMode="decimal" step="0.1" className="ss-in" value={fuelAdded} onChange={(e) => setFuelAdded(e.target.value)} placeholder="—" /></Field>
          <Field label="Fuel cost ($)"><input type="number" inputMode="decimal" step="0.01" className="ss-in" value={fuelCost} onChange={(e) => setFuelCost(e.target.value)} placeholder="—" /></Field>
        </div>
        <div style={{ borderRadius: 12, border: `1px solid ${BRAND.mint}`, background: "#F2FAF6", padding: "11px 13px", marginBottom: 14 }}>
          <div className="ss-mono" style={{ fontSize: 10.5, letterSpacing: 1, opacity: 0.7 }}>FUEL DUTY · {FUEL_PER_HOBBS_HOUR} GAL PER HOBBS HOUR</div>
          {dueNow == null ? (
            <div style={{ fontSize: 13, marginTop: 5, opacity: 0.75 }}>Enter Hobbs start and end to see what you owe.</div>
          ) : (
            <>
              <div style={{ fontSize: 13.5, marginTop: 5 }}>{n1(hrsNow)} hr × {FUEL_PER_HOBBS_HOUR} = <strong>{n1(dueNow)} gal</strong> required</div>
              <div style={{ fontSize: 13.5, marginTop: 3, fontWeight: 700, color: balColor(balNow) }}>{n1(addedNow)} gal added → {balLabel(balNow)}</div>
            </>
          )}
        </div>
        <Field label="Notes (optional)"><input type="text" className="ss-in" value={notes} maxLength={120} placeholder="Squawks, oil added, destinations…" onChange={(e) => setNotes(e.target.value)} /></Field>
        {err && <p style={{ color: "#b3261e", fontSize: 13.5, margin: "2px 0 0" }}>{err}</p>}
        <p className="ss-mono" style={{ fontSize: 11, opacity: 0.5, marginTop: 10 }}>Hobbs time and fuel burned are calculated for you.</p>
        <SheetActions editing={editing} busy={busy} onDelete={() => onDelete(initial.id)} onSubmit={submit} submitLabel={editing ? "Save" : "Save log"} />
      </div>
    </div>
  );
}
function Pair({ label, a, setA, b, setB, clr }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label className="ss-display" style={labelStyle}>{label}</label>
      <div style={{ display: "flex", gap: 12 }}>
        <input type="number" inputMode="decimal" step="0.1" className="ss-in" value={a ?? ""} onChange={(e) => { setA(e.target.value); clr(); }} placeholder="start" />
        <input type="number" inputMode="decimal" step="0.1" className="ss-in" value={b ?? ""} onChange={(e) => { setB(e.target.value); clr(); }} placeholder="end" />
      </div>
    </div>
  );
}

/* ------------------------------- shared bits ------------------------------ */
function SheetHead({ title, sub, onClose }) {
  return (
    <div style={{ marginBottom: sub ? 16 : 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 className="ss-display" style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{title}</h3>
        <button className="ss-btn" onClick={onClose} style={{ cursor: "pointer", border: "none", background: "transparent", fontSize: 24, lineHeight: 1, color: BRAND.ink }}>×</button>
      </div>
      {sub && <p className="ss-mono" style={{ margin: "4px 0 0", fontSize: 12, opacity: 0.6 }}>{sub}</p>}
    </div>
  );
}
function SheetActions({ editing, busy, onDelete, onSubmit, submitLabel }) {
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 20, alignItems: "center" }}>
      {editing && <button className="ss-btn" disabled={busy} onClick={onDelete} style={{ cursor: "pointer", minHeight: 50, border: "1px solid #b3261e", color: "#b3261e", background: "transparent", borderRadius: 13, padding: "0 16px", fontWeight: 600, fontSize: 14.5, opacity: busy ? 0.6 : 1 }}>Delete</button>}
      <div style={{ flex: 1 }} />
      <button className="ss-btn" disabled={busy} onClick={onSubmit} style={{ cursor: "pointer", minHeight: 50, flex: editing ? "unset" : 1, border: "none", background: BRAND.teal, color: BRAND.cream, borderRadius: 13, padding: "0 22px", fontWeight: 700, fontSize: 16, opacity: busy ? 0.7 : 1 }}>{busy ? "Saving…" : submitLabel}</button>
    </div>
  );
}
const labelStyle = { display: "block", fontSize: 13.5, fontWeight: 600, marginBottom: 7 };
const primaryBtn = { width: "100%", minHeight: 52, cursor: "pointer", border: "none", borderRadius: 14, background: BRAND.teal, color: BRAND.cream, fontWeight: 700, fontSize: 16 };
function Field({ label, children }) {
  return (<div style={{ marginBottom: 14, flex: 1 }}><label className="ss-display" style={labelStyle}>{label}</label>{children}</div>);
}

/* ============================== wordmark ================================== */
function Wordmark({ center, small }) {
  const size = small ? 18 : 30;
  return (
    <div style={{ textAlign: center ? "center" : "left", display: small ? "flex" : "block", alignItems: "center", gap: 8 }}>
      <span className="ss-display" style={{ fontWeight: 700, fontSize: size, letterSpacing: -0.5, color: small ? BRAND.cream : BRAND.ink, lineHeight: 1 }}>
        Seneca <span style={{ color: small ? BRAND.mint : BRAND.teal }}>Syndicate</span>
      </span>
    </div>
  );
}
