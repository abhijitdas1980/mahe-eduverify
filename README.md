# EduVerify — Full-Stack Pre-Verification Portal (v10)

## What's new in v10

### Orientation-week verification schedule (1,920 students · 4 days · 15 rooms)

A complete, dynamic slot-allocation system for in-person document verification
during the orientation week:

* **4 days** · 20 / 21 / 22 / 23 July 2026
* **15 rooms** per day · `AB4-101` through `AB4-115`
* **32 students per room** per day → **480 students per day** · **1,920 total**
* **10 minutes per student** · starts at **1:00 PM** · ends 6:20 PM
* Each student gets exactly one unique `(date, room, slot_no)` slot.
* Statuses tracked per slot: `open`, `booked`, `pending`, `verified`,
  `absent`, `reassigned`.

### Architecture

* New database table `verify_schedule` (added via `schema.sql`, auto-created
  on boot).
* New route file `src/routes/verify.js`, mounted at `/api/admin/verify/*`.
* New standalone page `public/verify.html` — a self-contained React +
  Tailwind + Babel page. It reuses the admin JWT from `localStorage`, so the
  admin signs in once on the main portal then opens *Verify Schedule*.
* Tiny one-line addition to the admin toolbar in `public/index.html` — a
  green **📅 Verify Schedule** button alongside *🕒 Slot Management*.
* No change to the existing reporting-slot flow.

### Admin endpoints

| Method | Path                                            | Auth        | Purpose                                                  |
|-------:|-------------------------------------------------|-------------|----------------------------------------------------------|
| POST   | `/api/admin/verify/generate`                    | Supervisor  | Seed empty schedule (idempotent).                        |
| POST   | `/api/admin/verify/allocate`                    | Supervisor  | Round-robin assign students to open slots.               |
| POST   | `/api/admin/verify/reset`                       | Supervisor  | Wipe schedule (`{"confirm":"YES"}`).                     |
| GET    | `/api/admin/verify/stats`                       | Admin       | Overall + day-wise + room-wise + day×room breakdown.     |
| GET    | `/api/admin/verify/students`                    | Admin       | Filtered student list (date, room, status, q).          |
| PATCH  | `/api/admin/verify/assignment/:id`              | Admin       | Change status / remarks (sets `verified_at` + `verified_by` on verify). |
| POST   | `/api/admin/verify/assignment/:id/reassign`     | Supervisor  | Move student to the next open slot (or to a specific one). |
| GET    | `/api/admin/verify/export.csv`                  | Admin       | CSV download with the same filters as the list endpoint. |
| GET    | `/api/admin/verify/meta`                        | Admin       | Dates, rooms, status enum for dropdowns.                 |

### Admin UI tabs

* **Overview** — overall 4-day tiles · day cards with verified/pending/
  booked/absent + a stacked progress bar · room-wise totals across all 4
  days. Auto-refreshes every 10 seconds.
* **Day Detail** — pick a day → see room-wise table for that day, plus a
  filtered student list with action buttons: *✓ Verify*, *Mark Pending*,
  *Absent*, *↻ Reassign* (supervisor). Auto-refreshes every 10 seconds.
* **Setup & Allocation** (supervisor) — *Generate default schedule* (one
  click for 1,920 empty slots) · *Allocate by application number* or
  *by name* · *Reset* (danger).
* **Export** — CSV download with date / room / status filters. CSV columns:
  Slot ID, Date, Room, Slot No, Start, End, App No, Name, Program,
  Department, Section, Profile, Category, Status, Verified At, Verified By,
  Remarks.

### One-time setup after deploy

1. Sign in to the main portal as the supervisor admin.
2. Click **📅 Verify Schedule** in the toolbar (or open `/verify.html`).
3. Go to **Setup & Allocation**:
   * Click *Generate default schedule* → creates 1,920 open slots.
   * Click *Allocate by application number* → assigns every student to a
     slot, day-by-day, room-by-room.
4. Switch to **Overview** to see the dashboard come alive. As verifiers mark
   students *✓ Verify*, the verified count climbs in real time (~10-second
   refresh).

### CSV export — sample columns

```
Slot ID,Date,Room,Slot No,Start,End,App No,Name,Program,...
123,2026-07-20,AB4-101,1,1:00 PM,1:10 PM,CSE2026001,Aarav Sharma,B.E. Computer Science,...
```

### Backward compatibility

* No schema migration needed — `CREATE TABLE IF NOT EXISTS verify_schedule`
  runs alongside the existing schema.
* The v7 reporting-slot table (`slots`) and flow are unchanged.
* No frontend changes outside the new launch button and `verify.html`.

---

## Carry-forward from v9

* Strict workflow: mandatory docs → declaration → slot booking.
* Single confirmation per document (replaces 6 checkboxes).
* Optional documents (Migration Cert, TC) don't gate the flow.
* Removed docs (Bank, Student PAN, Caste, Medical) stay removed.
* Categories: General / NRI / NRI Sponsored / Foreign / OCI / AICTE.
* Undo verification now accepts any non-empty reason, with inline error.

---

## Deployment

Push the contents of `eduverify-v10.zip` to your GitHub repo (overwriting the
v9 contents). Render redeploys automatically. The new `verify_schedule` table
is created on first boot by the existing auto-setup.

Demo logins unchanged (same 10 students; admin `ADM-001` + your
`SEED_ADMIN_PASSWORD`).
