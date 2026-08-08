# The first backend, and why it was abandoned

The work is on `backend-attempt1` (30 commits, `fcd0c40..2e50b76`), checked out permanently at
`../hexnome-attempt1` so it can be read without a branch switch. The commit messages are detailed and
are the primary record; this is the summary worth having before opening any of them.

It reached *playable but not trustworthy*. A two-player game could be created, joined, and played
through turns and a round boundary — and seven bugs surfaced **in play**, none of which the test
suite or the browser checks had caught. They were the reason for stopping, and they all had one
shape.

## What held up, and should be taken again

**The command chain.** A game's log is a chain of commands, each naming the one it was built on:

```prisma
seq      Int @id @default(autoincrement())   // global, sparse; only order matters
prevSeq  Int                                 // 0 for the genesis command
@@unique([gameId, prevSeq])                  // two commands cannot share a parent
```

No transaction and no row lock. Producing a *dense* per-game sequence means reading the current one
before writing, which is what forces a lock; a sparse global autoincrement is allocated by the
database with no read at all, and the unique index adjudicates the race in the insert itself. Forty
concurrent commands claiming one parent: exactly one wins, thirty-nine get a `409`. Removing the
index made all forty succeed — a silent forked log — so the test bites.

The two halves need each other. Sparse autoincrement alone has a window where a poller advances past
a command that has not committed yet; the chain is what stops two writes to one game being in flight
together, so the window cannot open.

**Idempotency before staleness.** A retry of a command that *did* land carries a `prevSeq` the head
has moved past. Checking staleness first answers every successful retry with a conflict — the one
case a command id exists to prevent. Order matters, and it is not obvious.

**One command is one row, holding both the player's effects and the server's answer.** A client must
never observe a move landing without the deal it triggered. A single `INSERT` is atomic under InnoDB
without a transaction, so this costs nothing — but the two must be *separate columns*, because a
client that applied its own turn optimistically already holds the first and needs only the second.

**The dealer as a fold over the log.** Bags, piles and the hidden tokens under face-down plates were
the one part of a game a journal could not rebuild — replay restored every tile and left the deck at
position zero. Folding them out of the log is what made a game genuinely restorable, and it is only
possible because the log is grouped into commands: draws and discards are *batched*, and `draw(4)`
leaves a different state from four `draw(1)`s once a reshuffle lands mid-draw. A flat entry list
cannot recover those boundaries. A command boundary can.

**Seat identity as a token.** Joining mints a secret; the client sends it in `Authorization`; the
server *derives* the author and ignores anything claimed. Claiming a seat is a conditional update —
`WHERE token IS NULL` — so simultaneous joiners cannot share a seat, the same discipline as the
chain. Dropping the guard let twelve concurrent joiners into one seat.

**The secrecy property, and that it was testable.** A face-down plate's token exists only on the
server and reaches a client once, in a `revealPlate` entry, after its lot is picked clean. Asserted
against the *stored bytes* rather than the model.

## What defeated it

Every seat bug had the same shape, and there were four of them:

| found in play | the accessor that was not scoped |
|---|---|
| two boards drawn on top of each other, drawers merged | `plates()`, `tiles()` |
| one player's drafted tile in everyone's drawer | `drawerSlotOccupant`, `plateSlotOccupant` |
| two tiles in one slot, fixed only by reloading | `tile(id)`, `plate(id)` — used by the scene's *sweep* |
| hover showing the wrong board's verdict | `canPlaceTile` → `boardAfter`, and the reward machinery |

Seats were added as an **optional field defaulting to zero**, and a `seatView` wrapper scoped the
methods it overrode. Both decisions were made for safety — the default kept 444 existing tests
passing unedited — and together they are what made the failures invisible:

- **It fails open.** An unscoped question is not an error; it is answered for seat zero.
- **It fails only in multiplayer**, and only after somebody acts. Every seat opens with three
  identical stems in slots 0–2, so a freshly loaded two-player game *looked* right in both windows
  until the first draft.
- **Single-seat tests prove nothing about it.** One of my own tests exercised a seat-scoped discard
  using seat 0 — and passed against the broken code, because seat 0 *is* the default.

There was also a fifth of the same family: a guard (`reachesAnotherSeat`) that was written,
unit-tested, described in its commit message as closing a hole, and **never called from the service**.
Its tests passed because they invoked it directly.

### The lesson

*A seat-aware view over an unscoped model is the wrong shape.* Patching each accessor as it was
discovered never converged, because the set of accessors a renderer reaches for is not knowable by
inspection — each one was found by a person playing the game.

Attempt 2 should make an unscoped question **impossible to ask** rather than answer it for seat zero.
Two shapes worth weighing before writing code:

1. **A required seat argument.** No default, so the compiler enumerates every call site — including
   the ones in the scene that were missed four times. Costs a large mechanical edit and breaks the
   "444 tests unedited" safety net, which on this evidence was a false comfort anyway.
2. **One tableau per seat, with the shared source hoisted out.** Attempt 1 rejected this on the
   id-counter argument — piece ids come from one counter and the journal names pieces by id, so a
   replay that skipped another player's entries would renumber everything. That argument is sound
   *given* one shared id space, and it is worth re-examining rather than inheriting: ids scoped per
   seat, or carried explicitly in the entries, would dissolve it.

## Two operational traps

**`packages/rules` is loaded twice, differently.** Vite serves it from source and hot-reloads; the
backend `require`s the compiled `dist`. A running server therefore keeps *old rules* silently, and
the symptom is the server refusing something the client just did — which reads exactly like a logic
bug. This cost one debugging session outright. Run the backend in watch mode, or have it report the
rules version it loaded so a mismatch is a banner rather than a mystery.

**A socket notification can beat its own HTTP response.** The server announces a command when it is
*stored*; the reply carrying that command's `seq` may arrive later. A client that fetches on the
notification will apply its own command before its cursor has moved, and again when the reply lands.
Harmless for a move; for a round boundary it read as two rounds finishing at once. Guard both ends:
stand aside while a submit is in flight, *and* filter fetched commands against the cursor as it
stands when they arrive rather than when they were requested.

## Where the rest is

- **Commit messages** on `backend-attempt1` — each explains the reasoning and what the test would
  catch. `git -C ../hexnome-attempt1 log` reads as a design document.
- **Tests**: 488 rules, 68 backend against a real MySQL, 49 frontend. The backend suite covers the
  chain race, seat claiming, token secrecy and round closing, and is worth reading before rewriting
  any of it.
- **`session-logs/session-log-4.md`** — the 48 prompts that drove the attempt, which is a fair record
  of where the design actually came from.
