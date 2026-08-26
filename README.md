# 🎯 Stash — a money counter for one goal

Pick something you want to buy and how much it costs, then log every bit of money
that comes in (allowance, pay, a gift). The app shows how much you've collected,
how much is left, and — at your current pace — roughly when you'll get there.

## Running it

**Simplest:** open `index.html` in a browser (double-click). That's it — no install, no server.

**On your phone (recommended):** put the folder on any static host (GitHub Pages,
Netlify), open it on the phone and choose "Add to Home Screen". It then opens like
a real app and works with no connection.

Running locally with a server (needed for the service worker to register):

```bash
python3 -m http.server 8000
# then http://localhost:8000
```

## What's in it

- **Progress ring** with the amount saved, the percentage, and how much is left.
- **Quick add** — 20 / 50 / 100 / 200 / 500 buttons or any amount, plus a note for where it came from.
- **Money out** mode for when you spend some of the pot.
- **Stats** — number of deposits, average deposit, weekly pace, and an estimated finish date.
- **History** with delete and undo.
- **Confetti** when you hit the goal 🎉
- **Dark / light mode**, mobile-first layout.
- **Currency picker**: ₪ / $ / € / £.

## Where the data lives

Everything is stored locally in the browser (`localStorage`) — nothing is sent anywhere.
The data belongs to the browser and device you used; clearing browser data deletes it.

## Files

| File | Role |
|------|------|
| `index.html` | the whole app — HTML, CSS and JS in one file |
| `manifest.json` | install-as-an-app (PWA) settings |
| `sw.js` | service worker for offline use |
