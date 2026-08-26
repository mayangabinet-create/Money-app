# Stash — a money counter for the things you're saving for

Pick something you want to buy and how much it costs, then log every bit of money
that comes in. The app shows how much you've collected, how much is left, where it
came from, and — at your pace or your plan — when you'll get there.

It's built as an app shell, not a web page: **the page itself never scrolls**.
Four fixed screens, reached from the bottom tab bar, each exactly the height of
your display.

| Tab | What's on it |
|-----|--------------|
| **Goal** | Progress ring, how much is left, today, last 7 days, pace and finish date |
| **Add** | Money in / money out, a keypad, source chips, quick +20…+500, a note |
| **Days** | Day stats, two charts, where the money came from, every entry grouped by day |
| **Settings** | Goals, expected income, cloud sync, backup, reset |

## Running it

**Simplest:** open `index.html` in a browser. No install, no build step.

**On your phone:** put the folder on any static host (GitHub Pages, Netlify), open
it and choose "Add to Home Screen". It runs full-screen with its own icon and works
with no connection.

```bash
python3 -m http.server 8000      # then http://localhost:8000
```

## What it does

### Many goals
Keep several going at once — a bike, concert tickets, a flight. The goal name at the
top of the Goal screen opens the switcher; each goal has its own entries, currency
and progress. Finished goals move to their own section instead of disappearing.

### Every entry is editable
Tap any entry to change its amount, date, source or note, or delete it. Deletes can
be undone from the toast.

### Sources
Tag money as Allowance, Work, Gift, Sold something — or anything you type. The Days
screen then shows **where it came from**: how much of the goal each source paid for.

### Day stats
The app works off the local calendar day.

- **Goal screen** — what came in *today* and over the *last 7 days*.
- **Days screen** — best day, current streak (days in a row money came in), how many
  days you've put something away, and the average per day.
- **Per day chart** — 14 bars, up for money in, down for money out. Tap one to read
  that day's total.
- **Total so far chart** — the running total against the target line, with a dashed
  projection to the finish.
- The entry list is grouped by day, each day showing its own total.

### Finish dates that don't lie
With no plan, the estimate is a **range** between your last-14-days pace and your
all-time pace, so one good week doesn't overpromise. Tell it what you expect to
receive regularly (Settings → Money you expect: "allowance, 140, every Friday") and
the estimate becomes a **planned** finish date instead of a guess.

### Colours
Chart colours were picked with a colourblind-separation validator, not by eye. The
in/out pair is blue↔red — green/red fails deuteranope separation badly (ΔE 2.7). The
source palette is six hues checked against both the light and dark surfaces, and
every bar is labelled so colour is never the only signal.

## Cloud sync (Supabase)

Data is stored **locally first** — the app is fully usable signed out and offline.
Sign in and it also syncs, so the same goals follow you across devices.

### Setup

`config.js` points at the project. Add the anon key:

```js
window.STASH_CONFIG = window.STASH_CONFIG || {
  url: 'https://yshiopubnvibpimpbqdj.supabase.co',
  anonKey: 'PASTE_IT_HERE'
};
```

Or paste both the URL and the key in the app: **Settings → Cloud sync**. Both values
are in the Supabase dashboard under **Project Settings → API**. The anon key is
public by design — row level security is what protects the rows.

A project needs the tables once: run `supabase/schema.sql` in its SQL editor.

### How syncing behaves

- Every change is written locally first — the UI never waits on the network.
- Only rows changed since the last successful sync are pushed, so an edit made on
  another device isn't clobbered by a stale copy here.
- Offline changes queue up (deletions included) and go out when you're back online.
- Live updates arrive over Supabase Realtime; a 30-second poll and a refresh on
  focus cover the case where the socket can't connect.
- Forgot your password? **Settings → Cloud sync → Forgot password?** sends a reset
  link.

### Tables

Created by `supabase/schema.sql`:

| Table | Rows |
|-------|------|
| `stash_goals` | one row per goal — name, target, currency, finished date |
| `stash_entries` | one deposit or withdrawal, tied to its goal, with its source |
| `stash_incomes` | the money you expect regularly |

All three have row level security on: a signed-in user can only touch rows where
`auth.uid() = user_id`.

## Tests

```bash
npm install      # playwright
npm test
```

`npm test` starts a static server and a mock Supabase, drives the real page in
Chromium, and prints a PASS/FAIL line per check (91 of them: onboarding, keypad,
multiple goals, editing, day stats, both charts, sync, a second device, offline
queueing, layout at three screen sizes, and upgrading data saved by the first
version). It exits non-zero if anything fails.

## Files

| File | Role |
|------|------|
| `index.html` | the whole app — HTML, CSS and JS in one file |
| `config.js` | Supabase URL and anon key |
| `manifest.json`, `icons/` | install-as-an-app settings and icons |
| `sw.js` | service worker for offline use |
| `supabase/schema.sql` | tables and row level security policies |
| `tests/` | the end-to-end suite and its mock Supabase |

Every icon is inline SVG drawn in the page — no emoji in the interface, nothing
loaded from a CDN except the font.
