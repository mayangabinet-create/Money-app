# Stash — a money counter for one goal

Pick something you want to buy and how much it costs, then log every bit of money
that comes in (allowance, pay, a gift). The app shows how much you've collected,
how much is left, and — at your current pace — roughly when you'll get there.

It's built as an app shell, not a web page: **the page itself never scrolls**.
Everything lives on four fixed screens reached from the bottom tab bar, exactly
the height of your display.

| Tab | What's on it |
|-----|--------------|
| **Goal** | Progress ring, how much is left, and four stats |
| **Add** | Money in / money out, a keypad, quick +20…+500 chips, a note field |
| **Days** | Day-by-day stats, a 14-day chart, and every entry grouped under its day |
| **Settings** | Goal and currency, cloud sync, backup, reset |

## Running it

**Simplest:** open `index.html` in a browser. No install, no build step.

**On your phone:** put the folder on any static host (GitHub Pages, Netlify),
open it and choose "Add to Home Screen". It then runs full-screen like a real
app and works with no connection.

Locally with a server (needed for the service worker and for cloud sync):

```bash
python3 -m http.server 8000
# then http://localhost:8000
```

## Day stats

The app works off the local calendar day, so it always knows what today is.

- **Goal screen** — what came in *today* and over the *last 7 days*.
- **Days screen** — best day, current streak (days in a row that money came in),
  how many days you've put something away, and the average per day.
- **14-day chart** — one bar per day: up for money in, down for money out.
  Tap any bar to read that day's total. Today's letter is highlighted.
- **The entry list is grouped by day**, each day showing its own total.

The chart's two colors are the blue↔red diverging pair, checked with a
colorblind-separation validator against both the light and dark surfaces —
red/green would have failed for deuteranopes.

## Cloud sync (Supabase)

Data is stored **locally first** — the app is fully usable signed out and offline.
Sign in and it also syncs to Supabase, so the same goal follows you across devices.

### One-time setup

Two ways to point the app at a project:

**From inside the app** — Settings → Cloud sync → paste the **project URL** and
**anon key** → Connect. Nothing to edit, and it's stored on the device.

**Or in `config.js`** — set the URL and add the anon key:

```js
window.STASH_CONFIG = window.STASH_CONFIG || {
  url: 'https://kgkdkkqoebnpahvetwzk.supabase.co',
  anonKey: 'PASTE_IT_HERE'
};
```

Both values are on the Supabase dashboard under **Project Settings → API**.
The anon key is meant to be public — row level security is what protects the rows.

Whichever project you point at needs the two tables. Run `supabase/schema.sql`
in that project's SQL editor once (it's idempotent — safe to re-run).

Then, in the app: **Settings → Cloud sync → Create account** (email + password), and
sign in with the same account on any other device.

### How syncing behaves

- Every change is written locally first, then pushed — the UI never waits on the network.
- Offline changes queue up (deletions included) and go out when you're back online.
- Signing in on a device merges: local entries are pushed up, everything on the account comes down.
- For the goal itself, the side edited most recently wins.

### Tables

Created by `supabase/schema.sql`:

| Table | Rows |
|-------|------|
| `stash_goals` | one row per user — name, target, currency, celebrated flag |
| `stash_entries` | one row per deposit or withdrawal, keyed by `(user_id, id)` |

Both have row level security on, with a single policy per table:
a signed-in user can only touch rows where `auth.uid() = user_id`.

## Other features

- **Confetti** when you hit the goal
- **Stats** — deposits, average deposit, weekly pace, estimated finish date
  (the pace figures need at least a day of history before they mean anything)
- **Dark / light mode**
- **Currency**: ₪ / $ / € / £
- **Export / import** a JSON backup from Settings

## Files

| File | Role |
|------|------|
| `index.html` | the whole app — HTML, CSS and JS in one file |
| `config.js` | Supabase URL and anon key |
| `manifest.json` | install-as-an-app (PWA) settings |
| `sw.js` | service worker for offline use |
| `supabase/schema.sql` | the tables and row level security policies |

## Icons

Every icon is inline SVG drawn in the page (a single `<symbol>` sprite at the top
of `index.html`) — no emoji anywhere in the interface, and nothing loaded from a
CDN.
