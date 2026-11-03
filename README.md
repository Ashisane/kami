# Kami 紙

A co-op adventure in a world made of paper. Fold your own tools: a plane to leap
off a cliff, a boat to cross the ocean.

```bash
npm install
npm run dev
```

Opens the Fold Lab at http://localhost:5173. The in-world experiment, three
beings handling the sheet, is at http://localhost:5173/play.html. Its keys and
rules are in `docs/PLAY.md`.

| In the Fold Lab | Action |
| --- | --- |
| Hover paper | Lights up the flap you would lift |
| Click paper | Pin it in place (three pins) |
| Drag paper | Pull it over. It stays held |
| Click the pin, or Space | Drop it: crease on the guide |
| Right click a pin / Esc | Let go with no crease |
| Wheel while dragging | Raise or lower |
| Shift + drag | Grip every layer |
| Ctrl | Reach the underside: the flap below |
| L | Lock or free the flap under the pointer. Shift: every layer |
| Lock tool | Click a flap to lock or free it, or drag to paint part of one |
| U | Free everything |
| Folds lock / Folds stay loose | Whether a new fold locks down with what it lands on |
| Enter | Mark it complete: flaps become hinges |
| Drag a flap, once complete | Set its angle. Shift turns it freely |
| N | Next recipe step |
| Square / A4 | Start from a square sheet or a 7 by 10 m one |
| X | Cut tool |
| Z / R | Step back / fresh sheet |

| In the library | Action |
| --- | --- |
| Space | Play or pause the clip |
| 1 2 3 4 | Paper, clay, wire, normals |
| C / S | Collision shapes / sockets |
| H | Player-sized scale cutout |
| G / T | Desk / spin |
| F | Frame the model |

Drop any image onto the window to compare against it.

See [CLAUDE.md](CLAUDE.md) for the project rules, and [docs/](docs) for art
direction, the asset pipeline and the roadmap.
