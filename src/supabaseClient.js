import { createClient } from "@supabase/supabase-js";

/* The publishable key is meant to ship in the browser. Data is guarded by Row
   Level Security in Supabase, not by hiding this key. See supabase/schema.sql. */
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://lhsuvmaxhdupdogyyahx.supabase.co";
const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_merjzUYyafXsMqQ_yITUnw_eFl4VTpA";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ------------------------------- bookings -------------------------------- */
const bFromRow = (r) => ({
  id: r.id, userId: r.member_id,
  startDate: r.start_date, startTime: (r.start_time || "").slice(0, 5),
  endDate: r.end_date, endTime: (r.end_time || "").slice(0, 5),
  note: r.note || "",
});
const bToRow = (b) => ({
  member_id: b.userId, start_date: b.startDate, start_time: b.startTime,
  end_date: b.endDate, end_time: b.endTime, note: b.note ? b.note : null,
});

export const bookings = {
  async list() {
    const { data, error } = await supabase.from("bookings").select("*")
      .order("start_date", { ascending: true }).order("start_time", { ascending: true });
    if (error) throw error;
    return (data || []).map(bFromRow);
  },
  async create(b) {
    const { data, error } = await supabase.from("bookings").insert(bToRow(b)).select().single();
    if (error) throw error; return bFromRow(data);
  },
  async update(b) {
    const { data, error } = await supabase.from("bookings").update(bToRow(b)).eq("id", b.id).select().single();
    if (error) throw error; return bFromRow(data);
  },
  async remove(id) { const { error } = await supabase.from("bookings").delete().eq("id", id); if (error) throw error; },
};

/* ------------------------------ flight logs ------------------------------
   Tach is no longer recorded. The tach_* columns stay in the database so old
   flights keep their readings; they are simply never read or written here.
   Omitting them from lToRow (rather than sending null) is what preserves them
   when an older flight is edited. */
const num = (v) => (v === "" || v == null ? null : Number(v));
/* A flight has 1-3 participants. Rows written before the participants column
   existed carry null, and read back as a solo flight by member_id. */
const pFromRow = (r) =>
  Array.isArray(r.participants) && r.participants.length
    ? r.participants.map((p) => ({ memberId: p.member_id, fuelAdded: p.fuel_added, fuelCost: p.fuel_cost }))
    : [{ memberId: r.member_id, fuelAdded: r.fuel_added, fuelCost: r.fuel_cost }];

const lFromRow = (r) => ({
  id: r.id, bookingId: r.booking_id, userId: r.member_id, participants: pFromRow(r),
  date: r.flight_date,
  hobbsStart: r.hobbs_start, hobbsEnd: r.hobbs_end,
  fuelStart: r.fuel_start, fuelEnd: r.fuel_end, fuelAdded: r.fuel_added, fuelCost: r.fuel_cost,
  hobbsTime: r.hobbs_time, fuelBurned: r.fuel_burned,
  notes: r.notes || "",
});
/* fuel_added / fuel_cost stay whole-flight totals — the generated fuel_burned
   column depends on fuel_added — so they are summed from the participants
   rather than entered separately. */
const lToRow = (l) => {
  const ps = (l.participants || []).filter((p) => p.memberId);
  const total = (key) => (ps.length ? ps.reduce((a, p) => a + (Number(p[key]) || 0), 0) : null);
  return {
    booking_id: l.bookingId || null, member_id: l.userId, flight_date: l.date,
    participants: ps.length
      ? ps.map((p) => ({ member_id: p.memberId, fuel_added: num(p.fuelAdded), fuel_cost: num(p.fuelCost) }))
      : null,
    hobbs_start: num(l.hobbsStart), hobbs_end: num(l.hobbsEnd),
    fuel_start: num(l.fuelStart), fuel_end: num(l.fuelEnd),
    fuel_added: total("fuelAdded"), fuel_cost: total("fuelCost"),
    notes: l.notes ? l.notes : null,
  };
};

export const flightLogs = {
  async list() {
    const { data, error } = await supabase.from("flight_logs").select("*")
      .order("flight_date", { ascending: false }).order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(lFromRow);
  },
  async create(l) {
    const { data, error } = await supabase.from("flight_logs").insert(lToRow(l)).select().single();
    if (error) throw error; return lFromRow(data);
  },
  async update(l) {
    const { data, error } = await supabase.from("flight_logs").update(lToRow(l)).eq("id", l.id).select().single();
    if (error) throw error; return lFromRow(data);
  },
  async remove(id) { const { error } = await supabase.from("flight_logs").delete().eq("id", id); if (error) throw error; },
};

export const isOverlapError = (e) =>
  !!e && (e.code === "23P01" || /overlap|exclusion|no_overlap/i.test(e.message || ""));
