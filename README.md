# Seneca Syndicate

Mobile-first booking **and flight-log record keeping** for N1896S (Piper Seneca
V). Three partners reserve the plane (a few hours or a multi-day trip) and log
Hobbs / fuel after flying. Data lives in Supabase with live sync.

## Set up the database (one time)

SQL Editor → New query → paste **`supabase/schema.sql`** → Run. It creates
everything from scratch (it begins with DROP statements, so it also resets any
old tables). No migration needed.

## Three tabs

- **Upcoming** — a simple list of what's booked next. Tap your own to edit.
- **Month** — tap-friendly overview; multi-day trips show as shaded runs of
  days. Tap a day to see it or book it.
- **Logbook** — the record-keeping home (see below).

A sticky button is always on screen: **Book the plane** on the calendar tabs,
**Log a flight** on the Logbook tab.

## Flight logs (joint-ownership record keeping)

Each flight is one row in `flight_logs`, separate from the booking, because the
flight record is what drives cost-sharing and maintenance:

- You enter **Hobbs start/end, fuel start/end**, plus optional **fuel added**
  (gal) and **fuel cost** ($), and notes.
- The database computes **Hobbs time and fuel burned** for you.
- The log form **pre-fills the start readings** from the last flight's end
  readings, so the meters stay continuous and you type less.
- The Logbook shows the **aircraft's current Hobbs / fuel**, **per-member
  totals** (hours flown, fuel $, and fuel balance), and the full history.

## The fuel rule

**Every member replaces 25 gallons of fuel for each Hobbs hour they fly.**

The app treats this as a running obligation rather than a note on the wall:

- The Logbook header states the rule under the aircraft's current readings.
- The **log form** works it out live as you type — `2.3 hr × 25 = 57.5 gal
  required`, against what you entered under *fuel added*.
- **Each flight card** shows `gal due · added · short/over`.
- **Each member card** carries a running balance across every flight they've
  logged, in red when short and teal when square or over.

The rate lives in one place — `FUEL_PER_HOBBS_HOUR` at the top of
`src/App.jsx`. Change that constant and every figure above follows.

## Tach

Tach is no longer recorded. The `tach_start` / `tach_end` / `tach_time` columns
are still in the database so past flights keep their readings, but the app
neither shows nor writes them. Editing an old flight leaves its tach values
untouched.

Every create/edit/delete on bookings and flight logs is recorded automatically
in audit tables (`booking_audit`, `flight_log_audit`).

## Deploy to Netlify

- **Git connect (recommended):** push to GitHub → Netlify *Import an existing
  project* → Deploy. Future pushes auto-deploy.
- **Drag-and-drop:** `npm install && npm run build`, then drag `dist/` onto
  Netlify.

Supabase URL + publishable key are baked in; override with `VITE_SUPABASE_URL` /
`VITE_SUPABASE_PUBLISHABLE_KEY` env vars if you rotate the key.

## Members and PINs

Top of `src/App.jsx`: Parsa `7190`, Ali R. `1219`, Ali B. `1896`, view-only
`0000`. Don't change the member `id` values (they're stored on each row);
names/PINs/colors are free to change.

## Security

Browser uses Supabase's publishable key; data is protected by Row Level
Security, not the key. With no per-user login, the anon role has full access to
bookings and flight logs — fine for three trusted partners, but anyone with the
URL who extracts the key could write. To lock it down, move DB access behind a
function holding a secret (`sb_secret_…`) key. Ask and it can be wired up.

## Easy future adds

- Maintenance reminders (next oil/annual based on Hobbs).
- A monthly cost-split export from the logbook.
- A second aircraft (add `aircraft_id` and include it in the overlap guard).
