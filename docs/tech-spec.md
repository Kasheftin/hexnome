# hexnome — Technical Spec

Architecture, rendering, and interaction for the browser implementation. Rules live in
[game-design.md](game-design.md); assets in [art-spec.md](art-spec.md); build order in
[tasklist.md](tasklist.md).

## Stack

| Concern | Choice |
|---|---|
| Frontend | Vue 3 SPA — **no SSR** |
| Build | Vite + TypeScript (strict) |
| 3D | Three.js via **TresJS** (`@tresjs/core`, `@tresjs/cientos`) |
| State | Pinia |
| Routing | Vue Router, history mode |
| Tests | Vitest (unit), Playwright (E2E, later) |
| Auth | Google SSO (Google Identity Services) → session JWT |
| Backend | Nest.js, REST + OpenAPI + generated client — **later stage** |
| Hosting | Static CDN for the SPA; the API is a separate deploy |

The SPA is a pure static bundle. Nothing renders on a server, so the app must boot to a usable shell
before any API call resolves.

## Repo layout

```
docs/               design docs
frontend/           Vue 3 SPA
backend/            Nest.js API             ← the games and the desks
packages/rules/     the game's rules        ← shared by both
external assets/    reference art, screen1.png
```

A pnpm workspace. The rules were extracted the moment something else needed them, which is what the
backend needed to deal a bag the browser cannot see.

**Two ways in to the rules, and neither builds anything.** The frontend resolves `@hexnome/rules/*`
to `packages/rules/src/*` — a Vite alias for the bundle, a tsconfig path for the typecheck. The
backend reaches them through a **symlink**, `backend/src/rules -> ../../packages/rules/src`, and
imports them relatively: `import { createDesk } from '../rules/desk'`.

The symlink is the whole trick, and it is worth understanding rather than copying.

`nest start --watch` does not notice a package that changes. The rules *are* in its tsc program —
`tsc --listFiles` lists every file under `packages/rules/src` even when they are imported by package
name — but TypeScript deliberately does not **watch** files that resolve through `node_modules`, on
the reasonable assumption that dependencies do not change while you work. A pnpm workspace link is
`node_modules`. Measured, not assumed: under package-name imports, touching
`packages/rules/src/desk.ts` produces no recompile and no restart, and the server carries on serving
the rules it booted with — then refuses something the browser has just done, which reads exactly like
a logic bug. That is the trap in `docs/backend-attempt1.md`, and it cost a whole debugging session.

Through the symlink they are ordinary files under `src/`, so all of that goes away:

- `tsc` watches them, and `nest start --watch` restarts on a rules edit like any other.
- They compile into `dist/rules/` as part of the backend's own build, and the emitted `require` is
  relative — no export map, no second copy, nothing to go stale.
- `packages/rules` therefore has **no build step and no `dist`**: it is source, and both consumers
  compile it themselves.

Two settings make it work. `"preserveSymlinks": true` in `backend/tsconfig.json`, so TypeScript keeps
the `src/rules/...` path instead of resolving it back outside `rootDir` — it applies to type
resolution only, so pnpm's symlink farm is unaffected, and the backend typechecks against the full
dependency tree as before. And `src/rules/**/*.spec.ts` is excluded from the build and from the
backend's vitest, since the rules run their own suite.

*(A symlink is committed as a symlink. On Windows that needs developer mode or
`git config core.symlinks true`.)*

Belt and braces, kept even though the trap is closed: `/health` reports a fingerprint of the rules the
server actually loaded — the first codes a fixed probe seed deals — and the game compares it on load,
so a server that simply was not restarted says so on screen rather than misbehaving.

**The dev server has the same trap, and no fingerprint.** `packages/rules` is outside the frontend's
root, reached through a Vite alias, and Vite does not reliably invalidate it — a rules change can go
on being served from the old transform for as long as the server has been up. It looks exactly like a
change that did nothing. If a rules edit seems to have no effect in the browser, check what is
actually being served before doubting the edit:

```
curl -s 'http://localhost:5173/@fs<abs path>/packages/rules/src/game.ts' | grep <your change>
```

and restart `pnpm dev:frontend` if it is stale. This cost a debugging session of its own; the symptom
was a feature that worked when driven directly and did nothing when driven through the game.

## Frontend layout

```
frontend/src/
  game/          pure TypeScript rules + math. NO imports from vue or three.
    hex.ts       axial coordinates, neighbours, pixel conversion
    plateGrid.ts flower sublattice: plate slots ↔ fine cells
    tile.ts      Tile { color, value }, palette-independent
    plate.ts     flower footprint, petal occupancy
    tableau.ts   where every tile is (board cell or drawer slot) + move legality
    *.spec.ts    colocated Vitest specs
  scene/         TresJS components and Three.js helpers
    geometry.ts  shared bevelled hex prism
    tileMaterials.ts  the 6-colour palette + the shared tile material
    symbols.ts   symbol atlas loading and UV lookup
    BoardScene.vue, TileMesh.vue, PlateMesh.vue, Lighting.vue
    viewports.ts the multi-viewport render loop
    layout.ts    world ↔ screen mapping shared with the DOM chrome
  ui/            Vue SFCs for the ornate chrome — drawer, supply, goals, HUD
  stores/        Pinia — game.ts, drag.ts, camera.ts
  views/         route-level components
  api/           generated OpenAPI client (later) + AuthService
  main.ts
```

### The one hard architectural rule

**`game/` imports nothing from `vue` or `three`.** It is plain data and functions over plain data.
This is enforceable in CI with a lint rule (`no-restricted-imports` scoped to `src/game/**`), and it
should be, because the rule erodes silently otherwise.

Two things depend on it. First, the rules get fast, boring unit tests with no WebGL and no component
mounting — and the rules are where the bugs that matter live. Second, when the Nest.js backend
arrives it reuses this module verbatim to validate moves server-side. A browser game with online play
cannot trust the client; the alternative to sharing this code is writing the rules twice and watching
them diverge.

Direction of dependency: `scene/` and `ui/` read from `game/`. Never the reverse. `game/` does not
know that colours have hex values, that tiles have thickness, or that a symbol is a PNG.

## The rules module

### Hex coordinates

Pointy-top hexagons, axial coordinates `{ q, r }`. Board plane is world **XZ**, Y is up.

```
x = size * √3 * (q + r / 2)
z = size * 3 / 2 * r
```

The six neighbour offsets are `(1,0) (1,-1) (0,-1) (-1,0) (-1,1) (0,1)`.

### The plate (flower) sublattice

Plates are 7-cell flowers — a centre hole plus six petals — and they tessellate. The flower centres
form an **index-7 sublattice** of the hex grid, generated by

```
v1 = (1, 2)      v2 = (3, -1)      // v2 is v1 rotated 60°:  (q,r) → (q+r, -q)
```

so plate slot `(i, j)` has its hole at fine cell `(i + 3j, 2i - j)`, and its six petals are that
cell's six neighbours. Plate slots are themselves a hex grid: slot `(i, j)`'s six neighbours are the
usual axial offsets in slot space, which in fine-grid terms are `±v1`, `±v2`, `±(v1 - v2)`.

This tiling has been verified numerically: the determinant is `-7`, the flower's 7 cells fall into all
7 residue classes exactly once, and flowers placed on the sublattice cover every fine cell exactly
once with no gaps and no overlaps.

Two consequences worth knowing before you look at the screen and think something is broken:

1. **Adjacent plates share exactly 3 petal edges.** Flower at `(0,0)` has a petal at `(0,1)`; its
   neighbour flower at `v1 = (1,2)` has a petal at `(1,1)`. Those differ by `(1,0)` — a unit step, so
   they share an edge, and there are three such pairs along every plate boundary. This is the
   mechanism by which groups grow across plate boundaries, and it is the whole reason plate placement
   is interesting. *Exactly three* is a sharp, cheap invariant — assert it in the tests.
2. **The flower lattice is rotated ~19.1° from the hex grid** (`atan(√3/5)`). Individual tiles stay
   axis-aligned pointy-top; the *rows of flowers* run at a slight diagonal. This is inherent to
   flower tessellation, not a bug, and not something to correct.

`plateGrid.ts` owns both directions of this mapping and is the first thing to unit-test — an error
here is invisible in the data and glaringly wrong on screen.

### Stems

`Stem` in `tableau.ts` is deliberately **not** a `Tile`. A stem has no colour and no symbol, so making it
a tile with null fields would push those questions into every piece of code that handles tiles —
drafting, scoring, matching. It shares only what it genuinely shares: a drawer slot.

Occupancy for both runs through the **same index**, keyed on the tile location, so a slot can never hold
two things and `freeDrawerSlots` counts stems as taken without knowing what they are. The drawer capacity
rules therefore need no special case at all.

`moveStem` takes a slot number rather than a location, which makes "stem onto the board" *unrepresentable*
rather than merely rejected. A stem is never draggable, so `pick` refuses it — while still treating it as
**opaque**, so a press on a stem does not fall through to whatever is behind it. Its one move is being
spent as payment, which is a click rather than a drag.

The coin is `scene/stemVisual.ts`: a real `CylinderGeometry`, not a disc, for the same reason tiles are
prisms — under a top-down camera the rim is the only surface whose normals sweep through a range, so it
is the only part that can catch a highlight. Its texture loads lazily and patches coins made before the
load lands, because stems are dealt during setup and would otherwise stay blank for the whole game.

### One tableau per player, one shared source

Each player owns a board and a drawer; the shared source is the only object between them. `tableau.ts`
currently holds all three, which is correct for one seat and will need splitting at two: the source
belongs to the game, the board and drawer belong to a player.

Worth knowing before that split: `Tableau` already keys the source separately (`PlateLocation.source`,
`TileLocation.source`) and `game/source.ts` only ever touches source locations, so the seam is roughly
where it needs to be already.

### The agenda is a second promise attached to the URL

`game/agenda.ts` deals what each round scores for from the game id, the same way `desk.ts` deals a bag
from its seed — so it falls inside the same frozen contract, and `agenda.spec.ts` carries its own
golden pins. In that file, not `desk.spec.ts`: separate modules, separate pins.

Note that the agenda still hangs off the **game id** while the desks hang off the **seed**. That is
deliberate rather than an oversight: what a round scores for is public — it is printed down the side
of the screen — while the desk order is the thing a player must not be able to derive.

Two streams, `${gameId}:agenda:colors` and `${gameId}:agenda:values`, for the reason `random.ts` gives
in its own comment. On one stream `random` draws values first and `classic` draws none, so the same id
would deal them different colours purely through draw order.

**Coverage falls out of the arithmetic rather than being checked for.** The colour deck is a permutation
of all six and a mode's plan claims exactly six slots, so "every colour exactly once" is a consequence
of consuming the deck. What is guarded is the *plan*: a dealer that found five slots would silently
drop a colour from every game for ever, so it throws instead.

**`classicReversed` reverses the result, never the plan.** Reversing the plan first is also
deterministic, also passes coverage, and is not classic reversed — its round 1 takes the first colour
off the deck instead of the one classic gave round 4. Exactly one test catches that, and it is the one
that compares the two agendas directly.

Rounds carry no round number; **position is the round**. That is what makes the reversal a plain array
reverse with nothing to resequence, and a forgotten resequence is a bug no coverage test would catch.

The agenda is derived and never stored. Both inputs survive a reload already — the id in the URL, the
mode in the saved settings — and persisting it would let an agenda written by an older build outlive
the code that produced it, which is the failure `parseGameSettings` exists to prevent.

### The desk service

The bag is on the server. `createDeck(gameId)` used to derive both bags in the browser, which meant
every tile the game would ever deal was in memory and readable from the console — fine for solitaire
and impossible for anything else. It now lives behind three routes that know nothing about the game:

```
POST /desk              { gameId, kind }  -> { id, remaining }
POST /desk/:id/draw     { n }             -> { id, remaining, codes }
POST /desk/:id/discard  { codes }         -> { id, remaining }
```

A **code** is `11`-`66`: colour then value, `(color + 1) * 10 + value`. That is the whole vocabulary
once a desk exists — a row has no idea whether it holds a game's tiles or its plates. `kind` is only
how the *builder* is told which of a game's two bags to make, and the two are built from
`` `${game.seed}:tiles` `` and `` `${game.seed}:plates` ``, which is what keeps their orders
independent.

**A desk is asked for by game, not by recipe.** The request once carried `{ seed, copies, exclude }`,
every field a fact about the game that the client happened to be holding. The server holds the game
now and works all three out for itself — and a client that cannot state what a bag is built from
cannot predict it.

**The mechanism is in `packages/rules/src/desk.ts`**, as pure functions over a value:

```ts
createDesk(seed, { copies, exclude }) -> DeskState        // { seed, copies, exclude, desk, discard, generation }
drawFromDesk(state, n)                -> { state, codes } | { error }
discardToDesk(state, codes)           -> state | { error }
```

State rather than a closure, because it round-trips through a JSON column between one request and the
next. `DeskService` is the thin shell that loads a row, calls one of these and writes it back; the
arithmetic is testable without a database, and `conservation.spec.ts` drives the same code the server
runs.

**Two seeds, and they are not interchangeable.** The **order** comes from `game.seed`, minted on the
server and never sent anywhere. The plates the bag must hold back come from `game.id`, which is
*public* — because the client works the same opening plates out for itself when it lays the boards
out, and it can only do that from something it knows. They must agree exactly, or the bag deals a
plate that is already on somebody's board. That is also the only seed the rules package has ever
seen: `GameOptions.gameId` feeds the opening plates and the petal stream, both of which are on the
table for everyone to look at anyway.

**Copies and exclusions.** `copies` multiplies the 36 distinct kinds — the settings offer 2-4 tiles
and 1-3 plates. Each copy is built in the fixed colour-major order and the finished list is shuffled
once, so duplicates spread through the bag rather than the second copy sitting behind the first.
`exclude` holds codes back at creation, one occurrence each: it is how the players' opening plates
stay out of the shared source, since they are already on a board.

The opening plates are chosen by `openingPlateCodes(seed, players)` — a value-1 plate per player,
distinct colours, off its own tagged stream. Not drawn from the desk, because finding "the first
value-1 plate in the bag" would mean seeing the bag. Six colours is therefore the cap on a table.

**Validation is the server's, and it is not decorative.** A draw larger than desk plus pile is refused
outright rather than answered short — over HTTP a short array is a silent surprise. A discard is
checked against what exists: desk plus pile can never hold more of a code than the game has copies of,
so anything past that was never drawn. That one check is what stops a client inventing tiles for a
desk that would happily deal them back out.

**Two writers on one desk conflict rather than clobber.** Every write is `UPDATE … WHERE id = ? AND
version = ?`, so a second request that read the same state gets a 409 instead of silently undoing the
first — a tile dealt twice, with nothing anywhere to notice. The client serialises its own calls
through one promise chain per desk (`composables/useDesk.ts`), so this should never fire in play; it
is there because "should never" is not a guarantee.

**`cyrb128` -> `sfc32` -> descending Fisher-Yates**, in `random.ts`. `Math.random()` is deliberately
unseedable, so this needs its own generator. Both the hash and the generator are built from exact
32-bit integer operations (`Math.imul`, shifts, xor) plus a single exact `/ 2**32`, which is what
makes the sequence bit-identical on every JS engine.

**The derivation is a frozen contract.** Changing the hash, the generator, the order the bag is built
in (colour-major then value), or the shuffle direction all silently deal a *different* desk for a seed
already handed out — and nothing at runtime can detect it. `desk.spec.ts` pins the exact first codes
for two known seeds. A failure there is a question about intent, not a prompt to update the numbers.

What the seed buys, in order of when it matters:

1. A bug report is reproducible from the seed alone.
2. The seed never leaves the server, so a client cannot predict anything at all.

The desks are the game's, and their ids live on its row. That is a change from when a reload built
two fresh desks from the same seed: the board is now folded from a log the server holds, so a refresh
resumes the game rather than restarting it, and the bag has to resume with it. Half-drawn is the
correct state to come back to.

One claim not being made: a uuid carries 122 bits of entropy against `108!` possible orders, so this
samples a small subset rather than shuffling uniformly. Irrelevant to play, but it is not a uniform
shuffle.

The colour count lives in `game/deck.ts`, while the palette lives in `scene/tileMaterials.ts`, so the
deck deals indices `0…5` without consulting the palette. `tileMaterials.ts` carries a type-level
assertion tying the two together, because `createTileMaterial` falls back to the first colour on an
out-of-range index — drift would silently render the wrong colour rather than fail.

### Games, seats and the head socket

A game is a row, and the id in `/game?id=…` is its primary key.

```
POST /games            { settings, name? }    -> { seat, token, game }
GET  /games/:id        Authorization: Seat …  -> GameView
POST /games/:id/join   { name? }              -> { seat, token, game }
WS   /watch            <- { watch: gameId }   -> { gameId, seq }
```

**Claiming a seat is a conditional write.** `UPDATE … WHERE gameId = ? AND seat = ? AND token IS
NULL` either takes the chair or affects no rows, so two people opening one link cannot both get in;
the loser tries the next chair. Reading for a free seat and then writing it is a race however
carefully it is written, and the failure is two players sharing a drawer. Same discipline as the
desk's version check.

**Every game is a table**, singleplayer included: a solo game is one whose only seat is claimed by
its creator, so it starts in the same breath and takes the same path. Attempt 1's worst bug was a
guard that existed on one route and not the other (docs/backend-attempt1.md).

**A token is a capability, not an account.** It says "the holder may act as seat 2 in that game" and
nothing else. It leaves the server exactly once, in the response to the join that mints it, and is
kept per game in localStorage — one person may hold a different seat in each of several games.
Reading a game needs no token: the id is already the right to look at a table, and `you` is simply
null without one.

**The socket carries a number, not the game.** `{ gameId, seq }`, where `seq` is bumped on every
write. Pushing the game itself would be a second path out of the server carrying data, and that path
would need its own idea of what a client may see — the first bug in it leaks the seed. There is one
such path already, `GET /games/:id`, so the socket is only a nudge towards it.

That is what makes it safe to be unreliable: it is an **optimisation, never a source of truth**. A
client polls underneath at two seconds, drops to fifteen once the socket is live, and never stops —
a socket that is open but silently broken is indistinguishable from a quiet game, and the failure
mode of trusting it is a player sitting for ever in front of a table that filled up.

### The command log, and who may add to it

A game's board, drawers, source and score are folded from a table of commands. Nothing about a game
in progress is stored anywhere else, so nothing can drift from it.

```
GET  /games/:id/commands?since=N              -> CommandSlice
POST /games/:id/commands                      -> SubmitResult
       { cmdId, prevSeq, command }
```

**The chain is the concurrency design, in one line.** Every command names the one it was built on,
and `@@unique([gameId, prevSeq])` makes the database refuse two children of one parent — so there is
no sequence to allocate, no row to lock and no transaction, because the insert adjudicates. A dozen
turns claiming one parent leave exactly one winner. The two halves need each other: sparse
autoincrement alone lets a reader advance past a command that has not committed, and the chain is
what stops two writes to one game being in flight at all.

**One `command` column, where attempt 1 needed two.** Its log recorded *mutations*, so a client that
had applied its own turn optimistically needed the boundary between what it already held and what the
server added. Ours records **intents**: one row is one `Command`, and every client folds it through
the same `applyCommand` and lands on the same board.

**Order of checks in `submit`, all of it load-bearing:**

1. Seat from the token — 403. Nothing in the body may name a seat.
2. **Idempotency before staleness.** A retry of a turn that *did* land carries a `prevSeq` the head
   has moved past, so testing staleness first answers every successful retry with a conflict — the
   one case `cmdId` exists to prevent.
3. `parseCommand` — 422. `applyCommand` casts rather than checks, so an unread `to` would otherwise
   reach `moveTile`.
4. Fold the log, `applyCommand` — 422 with the rules' own message.
5. Restock while the source wants a lot, drawing from the game's own desks.
6. Write the turn and its deals in **one transaction**, so a reader cannot see one without the other.
   The unique violation is caught rather than pre-empted, and resolved by looking `cmdId` up: two
   callers sending one turn at once violate both indexes, and MySQL reports whichever it checked
   first.

**Reading takes the rows first and derives the head from them.** Read separately, a command landing
between the two queries is returned but not counted — and a client advancing its cursor to the head
fetches and applies it twice. That was a real bug in attempt 1.

**The deal is the server's and cannot be asked for.** `parseCommand` refuses the word outright. This
is not only about cheating: with one shared desk, two clients each deciding the source needed filling
drew two lots. The opening lot is written when the game starts, so a started game is playable on
arrival. A game gets its two desks when its last chair is taken and holds their ids; neither ever
reaches a client.

Folding costs nothing worth avoiding — a four-round game is a few hundred commands — and the state is
re-folded on every submit deliberately, because a cached one is a second copy of the truth.

### Undo, which is a fact about the log

Singleplayer only, off unless the setup asked for it (`allowUndo`), and it reaches back to the start of
the round in progress, one turn at a time.

**It is appended, never a deletion.** `{ kind: 'undo', seat }` is a row like any other. Deleting the
rows it cancels was the obvious alternative and does not work here: clients read the log through an
append-only cursor (`since(cursor)` returns `seq > cursor`), so one holding seq 40 would never learn
that 38–40 had gone. Deletion would need an epoch on the game and a full reload every time. As a row it
costs nothing — the chain, the `cmdId` retry path and the unique parent index all keep working, and the
history survives for the score sheet's `throughRound` replay to walk.

**`effectiveLog(log)` resolves it, and `applyCommand` never sees one.** Each undo cancels the last turn
still standing and everything appended after it — the deals it caused, any tidying since. Walking
forwards over a live list is what makes repeated undos fall out for free: the second finds the turn
before the first, because the first is no longer there to be found. `replayGame` resolves internally, so
every caller gets undo from one place and none has to remember to ask.

**One gate, asked by both ends.** `canUndo(options, log)` decides whether the button lights and whether
the server accepts, so an undo a player is offered is one that will be taken.

#### The desks are the whole of the work

Everything else undo touches is derived and comes back on its own. The two bags are mutable rows no fold
can reach, so `TurnsService.takeBack` hands them exactly what the cancelled commands took and gave:
`undrawFromDesk` puts the dealt codes back on the front, `undiscardFromDesk` lifts the turn's batch off
the pile. In the reverse of the order the turn played them — the server draws its restock and *then*
discards what the turn spent — and **before the row is written**, because a rewind can be refused and a
refusal has to leave the game exactly as it was. A log saying the turn was taken back while the bags
still hold it is the one state nothing downstream could repair.

**The reshuffle, and how the desk knows without being told.** A reshuffle consumes the pile whole and
permutes it, so an undo reaching across one cannot restore the order that was there. Nothing records the
generation as it stood before a turn, and threading it through the log would be storing a fact to answer
a question the state can answer itself. Two observations settle it, checked after the batch is lifted
off the pile: `generation === 0` means no reshuffle has ever happened, and otherwise material still in
the pile got there *before* this draw — so a non-empty pile proves no reshuffle since, and an empty one
cannot rule one out and is refused. Conservative in one direction only. In a default game it cannot fire
at all: 108 tiles against 64 dealt over four rounds, 36 plates against 16.

#### The client re-folds rather than applying

An undo row is the one thing `commit` cannot take, so `absorb` rebuilds: `state = replayGame(options,
log)`. `state` is therefore a `let`. Nothing captures the binding — the board, the source and every seat
are reached through `board()`, `boardOf()` and `source()`, which read it when called — so swapping the
object is enough. The ids come back identical because the same log mints them, which is what lets the
scene's views survive a wholesale rebuild. Verified rather than assumed: a draft and an undo return a
**byte-identical frame**, and so do three turns followed by three undos.

### The client waits, and folds what comes back

`frontend/src/composables/useGameSync.ts` holds a cursor and three calls: `load`, `catchUp`,
`submit`. **Nothing is optimistic.** A turn is submitted and *then* applied from the rows that come
back, and rows from a catch-up take the same path — so a turn of your own and somebody else's differ
in nothing but which request fetched them. One code path, no rollback, no state that is nearly true.

It costs nothing visible: the turn already waited half a second for pieces to fly, and a round trip
disappears inside an animation that was there anyway.

Two races, both found the hard way in attempt 1:

- **A socket notification can beat its own HTTP response.** The server announces a command when it is
  stored, which can reach the browser before the reply to the request that made it. So `catchUp`
  stands aside entirely while a submit is in flight.
- **The cursor moves while a fetch is in the air.** So what comes back is filtered against the cursor
  *as it stands on arrival*, not as it was when the question went out.

`GameView.absorb` is where a batch becomes a board. It folds every row silently, marks any stems an
enclosure minted as arrivals *before* the revision moves — the scene builds a view the moment it does
— and raises the results panel when a round closed. That last one matters: the panel used to be
raised by whoever played the closing pass, so everyone else got a new round over the old round's
board.

### One store, and the route follows the status

`frontend/src/stores/game.ts` reads the id from `router.currentRoute`, loads the game, and holds it.
It is the only path by which a game reaches the client.

`/join` and `/game` are **one game at two moments**, and which of them a client belongs on is the
server's answer rather than the link's: a client on `/game` for a table still filling is `replace`d
onto `/join`, and back again when it starts. That is what makes one share link enough — a host sends
`/game?id=…` and whoever opens it arrives wherever the game actually is. Replaced rather than pushed,
so the back button does not walk into the screen the server just ruled out.

`App.vue` is the gate: nothing about a game mounts until the game has loaded. `GameView` builds its
whole state from the settings at setup, so a view rendered before them is a view built from
guesses — and written per view the check would be three copies of one `v-if`, the third of which
somebody forgets.

**There is no `useSavedGames` any more.** Settings lived in localStorage when a game was a thing the
browser minted for itself. What is left there is the player's name, which belongs to the person, and
the seat tokens, which cannot live anywhere else.

**A refresh rebuilds the game** rather than restarting it — the board is a fold over a log the server
holds, so the same page comes back on the same turn with the same source and the same drawer.

### The game journal

`game/gameLog.ts` writes down every mutation the tableau undergoes, so any earlier position can be
rebuilt by replaying a prefix. The first thing that buys is the scoring accordion: a finished round is
shown beside **the board as it stood then**, not as it stands now. Nothing is snapshotted — the round's
picture *and* its tally are both derived from the log on demand.

**It records effects, not intentions.** An entry is a mutation that succeeded ("this tile moved to that
slot"), not a player's intent ("take the blues"). Three consequences, all deliberate:

- Replay needs no rules and no randomness. Nothing is re-decided, so it cannot diverge: no bag is drawn
  from, no reward re-derived, no legality re-checked.
- It cannot miss a mutation. `recordingTableau` **wraps the model**, so anything that changes the board
  is journalled wherever it was called from — and the board is mutated from two very different places,
  `GameView` and the drag handling inside `TableauView`. Instrumenting call sites would have meant
  catching every one of about twenty, in two files, for ever.
- It does **not** validate. A journal proves what happened; it cannot prove it was allowed. Server-side
  validation in multiplayer will want an intent log as well, built on the turn rules rather than on the
  model — a different thing, and a later one.

**Why replay reproduces the same ids.** Entries name tiles and plates by id, so replay is only sound if
the ids come out the same. They do, because `addTile`, `addPlate` and `addStem` each check legality
*before* taking the next id — a refused add never burns one. Recording only successful calls therefore
advances the replay's counter exactly as the original advanced. That is an invariant of `tableau.ts`
rather than of the log, so `gameLog.spec.ts` pins it directly: break it, and replay quietly rebuilds a
board whose ids no longer match its journal.

Round boundaries are `endRound` bookmarks — the one entry that changes nothing — so
`entriesThroughRound` can cut a prefix. `TableauOptions` is deliberately *not* part of the journal: it
carries the whole board's cell list, thousands of entries dwarfing a game's worth of moves, and it is
already derivable from the game's settings.

### The reshuffle, and the third frozen contract

When a draw runs short mid-draw, the desk shuffles its pile into a fresh bag and finishes the draw out
of it. The remnant left in the old bag is taken *first* and is not shuffled back in — the
deck-of-cards behaviour a short draw expects.

**This is the third promise attached to a seed**, after the desk order and the agenda — and a wider
one than either. Those two are pure functions, so "the desk for seed X" is a fixed thing a golden test
can pin. A reshuffle depends on the seed *and on how the game was played*, so there is no per-seed
answer to pin. `desk.spec.ts` pins the **mechanism** instead: the encoding, the ordering, the seed
format, the generation counter, and that an identical pile reshuffles identically.

The seed is

```
`${seed}:${generation}:${digits}`
```

where `seed` is the desk's own — already tagged `:tiles` or `:plates` by the client, which is what
keeps the two desks of one game from reshuffling identically when their piles happen to match —
`generation` counts reshuffles so far, and `digits` is every pile code concatenated in pile order.

Four details, each of which changes every reshuffle in every existing game if got wrong:

- **`tileCode` is `(color + 1) * 10 + value`.** Colour is 0-based in code, and the `+ 1` is what keeps
  every code two digits — `01` would lose its leading zero once concatenated, so two different piles
  could seed the same shuffle. The trick holds only while there are at most nine colours.
- **The same function is the sort key and the seed digits**, so the two cannot drift apart.
- **The pile is ordered, batch by batch.** `shuffleInPlace` is Fisher-Yates over *a specific array*, so
  the pile's order reaches the result twice: through the seed string, and through the array being
  permuted. Left alone, that order would come from `Map` iteration and from the order the player
  clicked payment chips. Each batch is therefore sorted on the way in — and **a batch is a whole
  event**: one payment, or one round-end sweep. Discarding item by item would make every batch a
  single item and the sort a no-op.
- **The generation only advances on a real reshuffle.** A no-op increment when the pile is empty would
  silently reseed the next genuine one.

The pile holds **bare codes, never records with ids, petals or rotation**. Sorting has ties, and ties
are only safe while the tied items are indistinguishable; give a pile item an id and tie order becomes
observable, breaking determinism in a way no test would obviously catch. Codes carry none of that,
which is one thing the wire format settles by construction rather than by discipline.

Two things route into the piles, both in `GameView`: `applyPayment` accumulates a whole payment and
hands over one batch per desk, and the round-end sweep does the same for the source. `tableau.discard`
returns a **receipt** of what it destroyed rather than a boolean, so the caller never has to re-derive
what a plate takes with it — two sources of truth about that is how a duplicate reaches a pile. The
receipt keeps a plate's own token out of its loose tiles, and reports `plate: null` for a face-down
plate the model never held a token for.

`conservation.spec.ts` guards the whole protocol with one invariant: every plate and every tile the
desks hold, across bag, pile and board, at every point in a scripted game. It drives the real desk
functions in process rather than over HTTP — the storage is what a server adds, and the arithmetic
under test is the same either way. It runs the script twice: once at the standard 36 and 108, and once
at the largest desks the settings offer, which is what says the size is a real parameter rather than a
default nobody has moved.

## Rendering

The goal is thick, glossy, physical-feeling tiles: **enamel under a clear glaze**, set in the dark
ornate frame of `screen1.png`.

### Tile geometry

One `ExtrudeGeometry`, built once at startup from a pointy-top hex `Shape` and shared by every tile
instance. Modelled on the Azul: Queen's Garden pieces in `external assets/azul.png`.

```ts
{ depth: thickness - bevel * 2, bevelEnabled: true,
  bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5, curveSegments: 1 }
// thickness 0.4, bevel 0.15, on a 0.86 circumradius
```

**The hexagon profile has sharp corners.** Six crisp vertices, no rounding in 2D — seen from directly
above, the tile's outline is a plain hexagon. An earlier version rounded the profile corners with
quadratic curves; that was wrong, and it also quietly shrank the corner-to-corner span (0.82 against a
requested 0.86) because a quadratic through a control point never reaches it.

**All the rounding is on the top edge**, from the bevel. Three's bevel sweeps a quarter circle
(`cos`/`sin` of t·π/2), so with 5 segments the rim is a genuine roll-over from the flat top down to the
vertical side wall, wrapping around a still-sharp corner. This is the load-bearing part: it is the only
region of the tile whose normals sweep through a range, and therefore the only region that can catch a
highlight at all — see [Where tile gloss can and cannot live](#where-tile-gloss-can-and-cannot-live).
Size it generously: at 5% of the radius it was invisible, at ~17% it reads as a pillowed moulded edge.

The bevel grows the solid outward by `bevelSize`, so the profile is inset by the same amount to land
the finished silhouette on the requested circumradius.

`ExtrudeGeometry` builds shapes in the XY plane, so the geometry is created once with a
`-π/2` X-rotation baked in (`geometry.rotateX`) rather than rotating every mesh. It also extends the
solid from `-bevel` to `depth + bevel`, so centring it on its own origin needs a translate of
`bevel - thickness/2`. Getting that sign wrong floats the tile above the board *and* buries the symbol
plane inside the prism — one error, two baffling symptoms.

### Material and palette

**Solid moulded plastic, not glass.** One `MeshStandardMaterial` per colour — six total, not one per
tile:

```ts
{ roughness: 0.45, metalness: 0 }
```

No clearcoat. An earlier version used `MeshPhysicalMaterial` with `clearcoat: 1`, which under this
camera laid a uniform white specular sheet over the entire flat top face — a green tile measured RGB
(248, 248, 247). Dropping clearcoat removes that additive white term and lets the colour read; the rim
still picks up a soft sheen from the environment, which is all the gloss an Azul-style piece has.

Six saturated colours spread around the hue wheel, so two tiles are never in doubt at a glance — which
matters more here than in most games, because colour is half of what a group is made of:

| Index | Name | Hex |
|---|---|---|
| 0 | Orange | `#b06127` |
| 1 | Lime | `#6a8f00` |
| 2 | Green | `#00994b` |
| 3 | Blue | `#0f81af` |
| 4 | Indigo | `#613ECC` |
| 5 | Magenta | `#CC3E9C` |

**The index is the identity.** A tile's colour is that number everywhere in `game/`; the name and the
hex exist only for the renderer and for prose. The order is therefore load-bearing — reordering this
list repaints every saved game — while the hexes themselves can be tuned freely.

**The swatch is not what you see.** These are sRGB values and the tiles are lit, so measure the render:
Indigo is RGB(97, 62, 204) as a value and RGB(116, 69, 204) on the board.

The list lives in `scene/constants.ts` and is consumed by `scene/tileMaterials.ts`, which carries a
type-level assertion pinning its length to `TILE_COLOR_COUNT` in `game/deck.ts` — adding or removing an
entry is a typecheck error until both agree. The rules know a tile's colour as an index; only the
renderer knows what green looks like.

### Where tile gloss can and cannot live

A constraint worth internalising, because it is geometric and no amount of material
tuning gets around it.

The board camera is **orthographic and looks straight down**. A tile's top face is
**flat**. So every point on that face shares one normal *and* one view direction —
which means the environment reflection across it is mathematically **uniform**. A
flat top face cannot carry a highlight streak, a gradient, or any variation at all.
Whatever sits directly above the board is mirrored back at the camera as a single
flat colour covering the whole face.

This was not theoretical. With three's `RoomEnvironment` — a bright white room whose
ceiling sits directly overhead — a green tile measured RGB (248, 248, 247). Pure
neutral white; the colour was entirely gone. Dimming the environment only traded a
white tile for a washed-out one, because the reflection stayed uniform. Decomposing a
mid-calibration measurement gave `rendered ≈ 0.60·albedo + 0.35·white`: a large
additive white term with no spatial variation.

Two consequences, both now in the code:

1. **The environment keeps the region directly overhead dark**
   (`scene/studioEnvironment.ts`). Bright emissive panels sit 45–70° off vertical, so
   the flat top face reflects darkness and keeps its own colour.
2. **Gloss lives on the bevel.** The bevel and rounded corners are the only parts of
   a tile whose normals sweep through a range, so they are the only parts that can
   catch a moving highlight. That is also what makes an edge read as rounded. A token
   5%-of-radius chamfer was invisible; ~12% reads as a pillowed, moulded edge.

If the flat top face itself ever needs to look glossy rather than merely coloured, the
options are a subtly **domed** top (varying normals via geometry) or a radial **normal
map** — not a brighter environment.

### Lighting

- **An environment map is required**, and it must be a *dark* one whose bright panels sit off-axis.
  Without an environment the rim has nothing to reflect and reads as dead plastic; with a bright one
  (three's `RoomEnvironment`) the flat top face mirrors the ceiling straight back and every tile turns
  white. `scene/studioEnvironment.ts` builds a mostly-black scene with three emissive panels at 45–70°
  off vertical and bakes it through `PMREMGenerator` — procedural, zero bytes downloaded, and the panel
  placement is a deliberate choice rather than whatever an HDRI happened to contain.
- One **directional key light** from the upper-left, casting shadows, `shadowMapType` set to
  `PCFSoftShadowMap` on `<TresCanvas>`. Upper-left matches the bevel direction the art spec already
  assumes.
- A dim fill from the opposite side so tile sides in shadow do not go to pure black.
- `toneMapping: ACESFilmicToneMapping`, `outputColorSpace: SRGBColorSpace`. ACES keeps the specular
  hits from clipping to white flats.

Shadows are the other half of "thick": a tile with a contact shadow sits *on* the board, a tile
without one floats.

### Symbols

A **single texture atlas** of the six symbols, white-on-transparent, sampled via per-tile UV offset.
Each tile gets a thin plane mesh parented to it, floating ~0.001 above the top face, with the atlas as
`alphaMap` on an unlit material tinted darker than the tile body.

Why a separate plane rather than texturing the prism: `ExtrudeGeometry` generates UVs that are
awkward-to-hostile for placing art precisely on the top face, and mixing them with the bevel and side
faces means fighting the generator. A child plane is trivially positioned, trivially swapped, and
tints independently of the body. The cost is one extra draw call per tile, which the same
optimisation path below handles.

### One camera, a screen-anchored drawer

The board pans and zooms. The drawer must stay put. They must nonetheless look identical, because they
hold the same tiles.

This spec originally called for **three scissored viewports** with a camera each — board, drawer,
supply — driven through `renderer.replaceRenderFunction`. That is not what was built, and the reason is
worth recording: **a tile has to be draggable from the drawer onto the board in one continuous
gesture.** With one camera per region, that drag crosses coordinate systems mid-motion and the held
mesh has to be handed between them. With a single camera the same drag is one object moving through one
space, and the only thing that changes is what the drop target resolves to.

So: **one camera, one scene, one render pass.** The drawer is laid out in **screen pixels** and its
world transform recomputed every frame, which pins it to the screen while the board slides beneath it.
`scene/screenProjection.ts` does the conversion, and it is only sound because the board camera is
orthographic *and* axis-aligned — the screen→board-plane mapping is then a uniform scale plus a
translation, with no perspective term and no rotation. Under a perspective or tilted camera this
collapses and the multi-viewport design becomes necessary again.

Consequences, all of them deliberate:

- Tiles share geometry, materials and lighting with board tiles, because they *are* the same kind of
  object. Nothing is duplicated and there is no second render target.
- Height is draw order. Under a top-down orthographic camera, y is purely depth: plates below, board
  tiles above them, drawer above that, held tile above everything — so a tile dragged out of the drawer
  passes over its neighbours rather than under them.
- The drawer is drawn **in the canvas, not as DOM**. Its slots hold live 3D tiles and DOM sits above
  the canvas, so an opaque DOM drawer would cover its own contents.
- A drawer tile is scaled by `unitsPerPixel` each frame, so zooming the board does not resize the UI.
- **The panel scales to fit the window.** Its size is a game setting now — a 3-bay, 18-tile drawer wants
  1383px, wider than a 1366 laptop — so `createDrawerLayout` computes one fit factor and applies it to
  every pixel dimension. Capped at 1, because the constants are the intended size rather than a
  minimum; no lower cap, because a panel that always fits is worth more than tiles that never shrink.

  Scrollbars were the obvious alternative and were ruled out here on the grounds that the drawer is
  *in the canvas*, so there is nothing to scroll. **Half of that turned out to be wrong**, and the
  source column now has a real one: an empty DOM element over the canvas gives you the browser's own
  bar and its own touch momentum, and only `scrollTop` has to cross back (see "The shared source
  column"). No custom gesture is involved.

  What was right is the rest of it — clipping, and offsetting every hit-test. Both were real work.
  They are worth it for the column, whose height varies with `platesPerRound` and which is a *stack*
  you work down; they are not obviously worth it for the drawer, where a slot you cannot see is a slot
  you cannot drop on, and where the scroll would have to fight the drag that starts in it. The drawer
  still scales to fit.

  Anything sizing drawer contents must read `layout.slotSize` / `layout.plateSlotWidth` rather than the
  raw constants, or the tiles keep their full size inside shrunken sockets. Four places did exactly
  that and were converted; `drawerLayout.spec.ts` pins `slotAt(slotCentre(n)) === n` at several scales,
  which is the property that keeps the picture and the drop targets the same rectangles.

  The source column reads the drawer's top to know where to stop, so a scaled-down drawer hands it more
  room. That coupling is one-way and must stay so: the drawer's factor depends only on the canvas.
- **That scale must be assigned, never eased.** It is a zoom-compensation factor, not an animation: when
  zoom changes the correct value changes instantly, and easing toward it renders a knowingly wrong size
  for several frames — which looked like the drawer contents resizing and springing back. Each view
  therefore eases its scale only until it converges, then tracks the target exactly, and the ease
  restarts only when the object changes container. That single real transition (drawer size ↔ board
  size) is the only thing worth animating.

**If the drawer ever needs full isolation from the board camera**, the multi-viewport design above is
the way: give it its own camera and a scissored pass, and board zoom cannot reach it by construction. A
third pass would likewise give held pieces their own overlay layer. The cost is that a drag from drawer
to board then crosses cameras mid-gesture and the held object has to be handed between them — which is
why it was not built. Worth revisiting only if zoom stays and the pinning maths starts to strain.

**Two anchoring spaces.** Board tiles ease toward their home in *world* space; drawer tiles ease toward
theirs in *screen* space. This is not incidental — lerping a drawer tile in world space would make it
visibly lag behind the very panning it is supposed to ignore. Each tile keeps both anchors in sync, so
one crossing between containers starts easing from exactly where it already is instead of jumping.

### Camera

**Orthographic, straight down.** `BOARD_TILT_DEG = 0`.

Perspective is the obvious choice and the wrong one here. It foreshortens symbols unevenly across a
wide board, so identical tiles read differently depending on where they sit, and it makes the
world→screen mapping projective, which turns aligning DOM chrome to board regions into real work.
Orthographic keeps every tile's symbol the same size and shape and keeps world→screen affine.

The tilt started at 20°, to show the sides of thick tiles. **It was wrong and got removed.** An
orthographic camera tilted by `t` compresses the board's Z axis by exactly `cos(t)`, so at 20° a hex
that should be 200 × 231 px projected to 200 × 217 — visibly squashed, and the first thing anyone
noticed. Measured at zero tilt: horizontal cell pitch 117 px against a predicted 117.3, vertical row
pitch 102 against 101.3, both implying the same scale, width:height 0.8660 exactly.

If a tilt returns, the fix is to scale the board by `1 / cos(t)` in Z so the projection stays
proportional. That is exact for flat plates. For 3D tiles it shears the geometry slightly, which is a
trade to make with real tiles on screen, not in a spec.

At zero tilt, `lookAt` is degenerate — the view direction is parallel to the default `up` of +Y, and
three only recovers through an internal nudge. Set `camera.up` explicitly to `(0, sin t, -cos t)`,
which is the vector `lookAt` derives for any non-zero tilt and is well defined at zero.

**Playfield shape and scrolling.** The board is a **rectangle** in world space, not a hex disc:
`hexRectangle(20, 20)` reaches 20 cells in every direction, which comes to 1661 cells (21 rows of 41
and 20 of 40 — offset rows necessarily alternate length). Row `q` ranges are offset by `-r/2`, without
which a fixed range slides each row sideways and yields a rhombus.

The board reads as endless not by being infinite but by being **unreachable**: pan and zoom are both
clamped against the cell bounds inset by two cells, so the ragged outer ring never comes on screen.
Zoom has to be clamped as well as pan — a viewport larger than the board could not be kept inside it
by clamping pan alone.

**No scrollbars on the board.** The canvas fills the window and never overflows; scrolling the board is
dragging. Left-drag pans **anywhere on the board**, over placed pieces included; left-drag on something
you can actually pick up moves that instead; middle- and right-drag always pan. (The source column is
the one exception, and it is a panel rather than the board — it gets a real DOM scrollbar when its lots
overflow; see "The shared source column".)
**No free orbit** — the board has a canonical up and symbols must stay readable. A hand-rolled
controller rather than cientos' `MapControls`, because the clamping and the left-button split both
need direct control.

That left-button split needs an arbiter, and it cannot be whoever receives the event first: TresJS's
own raycast and the camera's canvas listener both fire for the same `pointerdown`, in an order neither
controls. So `scene/grabbables.ts` holds a registry of objects that claim a press, the camera raycasts
it and pans only on a miss. Both sides use the same camera and pointer position, so they always agree.

**A registration is a question, not a fact.** Whether an object wants the press depends on where it has
since moved and what the turn is doing — the same mesh is a thing to pick up while it is in your drawer
and scenery once it is placed and paid for. So callers register a predicate, consulted at press time,
and items pass `canDrag` — the very function `pick()` already used to decide whether a drag may start.

Registering "yes, always" was what made a played-in board draggable only by its gaps: every plate and
tile went on claiming presses long after the rules had stopped letting anyone move them, so the press
was swallowed and *nothing happened*. The registry and `pick()` disagreed, and the disagreement was the
bug. Panels register with no predicate and are always live — a tray is furniture, and pressing furniture
is never a pan, which is also what keeps the drawer and the source column claiming their own presses
even though the items inside them have fallen out of the registry.

### Board backdrop

The board is **one large plane with a procedural hex-grid fragment shader**, not thousands of outline
meshes, and not a texture — a texture cannot hold a constant thin line across the zoom range without a
mip stack that goes soft.

It is also *all* the board is: a faint honeycomb on dark slate. The board only ever says where a plate
may go, which is a minor job, so it stays quiet and the plates carry the colour. An earlier version put
ornate brass-and-green art on all 1661 cells with flat grey plate sockets on top, which drew the eye to
the least interesting part of the screen.

**Line width comes from a uniform, not from `fwidth`.** This matters more than it sounds. The shader's
`d` is the distance to the *current* cell's boundary, and `axialRound` makes it fold there — across a
boundary the values run `…0.05, 0 | 0.05…`. For a 2×2 quad straddling a boundary the two sides are
near-equal, so `dFdx(d)` collapses to about zero, `fwidth` with it, and the computed half-width along
with it, leaving `smoothstep` a zero-width range that returns 1 and erases the line entirely. Whether a
quad straddles that way depends on sub-pixel phase, so whole families of lines vanished at some zoom
levels and not others, and the rendered width wandered between 2 and 4 px when it should have been
constant.

There is no need to estimate it: the board camera is orthographic and axis-aligned, so one pixel is the
same world distance everywhere on the plane. Passing `unitsPerPixel` in as a uniform is exact and free
of the fold. Measured across ten zoom steps, grid-line continuity went from 96–100% of sampled columns
to **100% at every step**.

The half-width is separately floored at one pixel so a line always has a fully covered core. Without
that floor the falloff begins at `d = 0`, so a line is full strength only exactly on the boundary and
fades to nothing within a pixel or two of it.
Faint, low-contrast, no depth write — it is orientation furniture, and it must never compete with the
tiles.

**Two traps a raw `ShaderMaterial` sets, both of which cost real time already:**

1. **Colour space.** `new Color('#15181d')` stores *linear* values (0.0075, 0.0086, 0.0116). A raw
   shader writes them straight to an sRGB framebuffer, so the board rendered as RGB (2, 2, 3) — near
   black. The shader has to opt into three's output pipeline with `#include <tonemapping_fragment>`
   and `#include <colorspace_fragment>` at the end of `main()`.
2. **But not the `_pars_` variants.** Three already injects `tonemapping_pars_fragment` and
   `colorspace_pars_fragment` into every `ShaderMaterial` program. Including them again is a
   redefinition error that fails the *whole* fragment shader — and the only symptom is that the plane
   silently does not render. Statement-level includes in `main()` are ours; the declarations are not.

### Plates, and how tiles are addressed

A plate is a seven-cell flower: a centre hole that is never fillable, plus six petals. Tiles may only
go into a petal of a plate — so **no tile ever occupies a bare board cell.**

That single fact drives the model. Tiles are addressed as **`(plate, petal)`**, not by cell, and their
board cell is *derived* from the plate's position. The payoff is that a plate carries its tiles for
free: move the plate and nothing about its tiles needs rewriting. Addressing tiles by cell would mean
remapping every tile on a plate on every plate move, which is exactly the bookkeeping that goes wrong.

Board coverage (`cell → {plateId, petal | hole}`) is likewise **derived** from the plates rather than
stored beside them, so the two cannot disagree. `petalAt(cell)` returns null for the hole and for any
uncovered cell, which means "tiles only go into plate petals" falls out of target resolution instead of
needing a separate check.

**The board is one connected sheet, and that is a model rule.** `canPlacePlate` on a board location is
two predicates: `plateFits` (all seven cells on the board and free) and `plateConnects` (some cell
neighbours a cell of *another* plate). Hexes have no corners that meet without an edge, so "shares an
edge" needs no separate test — neighbouring is the whole of it.

`movingId` is excluded from "another", which does two jobs at once. Sliding a plate must not count its
own old cells as the connection it needs; and the **first** plate on the board has nothing to touch, so
with no other plates the predicate is vacuously true and anywhere is legal. The opening plate lands by
that exemption rather than by a special case.

The geometry that falls out is worth knowing when reading tests: the legal holes for a second plate are
**exactly the ring at distance 3**, eighteen of them. Distance ≤2 overlaps; distance ≥4 cannot reach.
Six of the eighteen interlock on the flower sublattice and twelve leave gaps — connecting is a weaker
constraint than tessellating, and whether to tighten it is still open (docs/game-design.md, question 10).

**Both placement rules ask about the board as it would be, so there is one view of that.**
`game/placement.ts` holds the pure rules — `neighboursAllow` (regular/strict) and `groupsAllow` (no
duplicate inside a colour or value group) — and both take a `cell → tile` lookup rather than a tableau.
The tableau supplies it from `boardAfter`, which returns the board *after the move*: a moving tile
absent from its old cell, a moving plate's tiles absent from theirs and present at their destinations.

One view rather than a lookup per rule is deliberate. Two would be two chances to disagree about what
"after the move" means, and the disagreement would show up as a placement the highlight allows and the
model then refuses. It also removed a bug that existed while there were two: the neighbour lookup for a
tile excluded its whole destination plate, which quietly hid the other petals of that plate — the
busiest neighbours it has.

`groupsAllow` is a flood fill per attribute, expanding only newly reached cells, so it is linear in the
group's size. It runs on every pointer move during a drag; groups are bounded by the tiles actually
placed, which is tens, so this is not worth optimising.

**The rules are enforced on moves, not on dealing.** `canPlaceTile`/`canPlacePlate` apply them only
when given a `movingId` — the id is what identifies the colour and value to judge. `addTile`,
`addPlate` and `revealPlate` pass none, because dealing is not a placement: they set the board up,
and the rules govern playing on it. A consequence for tests: a spec can `addTile` a board the rules
would never have allowed, and then get surprising answers from it. Two of ours did exactly that.

Rendering makes the attachment **real rather than simulated**: a tile on a plate is `add()`-ed to the
plate's `Object3D`, so three derives its world matrix from the plate's every frame and the pair is one
rigid body by construction. A tile's local transform is just its petal offset.

The first version instead eased each tile toward its plate's current position each frame. That looks
correct while both are still and is wrong the moment the plate moves: the tile chases a target that is
itself moving, so it trails by a lag that compounds — visible when dragging a plate, and when scrolling
the board with a plate parked in the drawer. No easing constant fixes that, because the tile is not
*approaching* the petal, it *is* in the petal. Reparenting also makes the drawer's scale-down free,
since the tile inherits it.

Reparenting has one requirement: `add()` only reassigns the parent, leaving the local transform to be
reinterpreted against the new one, so position and scale must be converted or the object jumps.

A plate's body is a **thin flower-shaped slab** that the seven sockets sit on. Without it a plate is
seven unconnected hexes floating over the board, with the board showing through the notches between
petals. Being a real extruded solid rather than a decal, its bevelled edge catches the key light, which
is what conveys thickness under a camera that only ever sees the top.

Its outline is **computed, not hardcoded**: take the seven cells' hexagons, keep the edges belonging to
exactly one of them, and chain those into a loop. That gives the union's boundary — an 18-sided polygon —
and stays correct if the footprint ever changes. Two things worth checking rather than assuming, both
verified: every boundary vertex has exactly two boundary edges, so the chain is one closed loop rather
than several; and the extents are `√7 ≈ 2.646` at a petal's far corners against `2.0` at the notches.
A petal presents a *flat side* outward, not a vertex, so the reach is **not** `√3 + 1`.

The slab is then shrunk by an inward **edge offset**, mitered at the corners — *not* by scaling. This
distinction is not cosmetic. Scaling about the centre displaces each edge in proportion to its distance
from the centre, so inner features barely move while outer ones move a lot. A uniform 0.97 scale left
each petal socket with a rim of **0.0087** where the geometry wants **0.087** — a tenfold difference, the
sockets flush against the slab's edge with a wide margin remaining inboard, which is exactly what read as
untidy. Offsetting every edge by a constant keeps each socket concentric with its lobe: measured rim
spread across the six petals is **0**, and the rim is `0.0866 − margin` by construction.

The hole is drawn with no rim and a near-black face so it reads as an absence. That has to be legible
at a glance, or a plate looks like it has seven usable spaces instead of six.

**The drop marker has to clear the plate, not just the board.** A plate's brass socket rims are opaque
and write depth, so a marker sitting below them is simply invisible on a plate — which is precisely
where tiles get dropped. `HIGHLIGHT_Y` is therefore derived from the plate's own stack rather than being
a bare number. Height is free here: under a top-down orthographic camera it does not shift a thing's
apparent position at all.

One ordering trap in `scene/constants.ts`: these heights are now derived from one another, and a `const`
referring to one declared further down the file throws a temporal-dead-zone `ReferenceError` at module
load. Typecheck did not catch it; only running it did.

**A refusal has to be as loud as an invitation.** The marker was mint when legal and a desaturated
maroon at a third of the opacity when not, which read as "nothing here" rather than "not there". That
was survivable while the only illegal drop was an obvious overlap — the player could see the collision
themselves. It stopped being survivable with the connection rule, because a position can look perfectly
free and still be refused, and a refusal nobody can see gets blamed on the controls.

So invalid is now a real red at full band opacity. It also **does not pulse**: the pulse is an
invitation, and a steady outline reads as a stop. The two states then differ in behaviour as well as
hue, which still works for someone who cannot separate the two hues.

**Rotation is a permutation, not a transform of the footprint.** A flower is six-fold symmetric, so
turning a plate cannot change which seven cells it covers — *fit* and *connection* are therefore
unaffected by rotation. The **neighbour rule is not**: it asks about the cell the plate's token lands
on, and rotation is exactly what moves the token from one cell to another. So `canPlacePlate` reads the
plate's rotation, and the same hole can refuse a plate and accept it turned. What changes is the
mapping between cells and petals: a
cell lying in direction `d` from the hole holds logical petal `d + rotation`, and conversely petal `p`
points in direction `p − rotation`. Those two are inverses, and a test walks a tile through all six
petals at all six rotations to hold them that way.

The sign follows from the projection and is easy to get backwards: world `+Z` is screen *down*, so
`φ = atan2(z, x)` increases **clockwise** on screen; a three.js rotation about `+Y` by `a` maps
`φ → φ − a`; and petal index increases as `φ` decreases. Hence `group.rotation.y = −rotation · π/3`
with `rotation` counted in clockwise steps.

**Tiles stay upright while their plate spins.** Rigid parenting would otherwise turn each tile with
its plate, and while a hexagon maps onto itself every 60° its *symbol* does not — the art visibly tilts.
Each tile therefore cancels its plate's rotation locally, giving a world rotation of zero. Rotation
still does what it should: tiles glide around the ring to their new petals, they just never look knocked
askew doing it.

**Never re-derive a cell from a petal index in the view.** Target resolution starts from the cell under
the pointer, so it keeps that cell for the highlight. An earlier version recomputed it as
`petalCell(hole, petal)` — treating a logical petal index as a *direction*, which they only are when
rotation is zero. On a rotated plate it highlighted the pre-rotation cell, 177 px away from where the
tile would actually land. The model was never wrong; the duplicated inverse in the view was. Holding on
to the resolved cell removes the inverse mapping, and the chance of getting it wrong, entirely.

`Plate.rotation` is a **running integer, never wrapped**. Every logical use takes it modulo six, but the
rendered angle is derived from the raw value so it stays continuous and can be eased — wrapping would
turn a step from 5 to 0 into a 300° lurch backwards. The tiles need no attention at all: they are
parented to the plate, so they turn with it.

Rotation is offered in the drawer (two DOM buttons on hover) and in hand (`q`/`e`), never for a plate
already on the board. Those buttons are real `<button>` elements over the canvas — focusable, keyboard-
activatable, crisp — positioned from the same `createDrawerLayout` that places the 3D bays, so the two
cannot drift apart, and they are tucked into the bay's upper corners.

**The hover region is the bay rectangle, not the plate's geometry.** Raycasting the plate is much too
strict for this: a flower has gaps between its petals, and the buttons sit in corners where there is no
petal at all, so crossing either reported a miss and dropped the hover — the buttons vanished unless you
moved fast enough to outrun the gap. The bay contains the plate and both buttons, so the rectangle has
no gap anywhere and no dependence on pointer speed. Swept on a grid: 156 of 156 points inside the bay
hold the buttons, and a walk from the plate's centre to either button lapses on zero frames, while the
tile grid and the board above the drawer correctly show nothing.

### Board cells

Each board cell wears a full-bleed hexagonal tile texture, drawn as one `InstancedMesh` per texture
variant. Variant and brightness jitter come from the cell's position hash, so the board is identical
on every reload — a board that reshuffles its textures on refresh reads as a bug.

**The geometry is hand-built, and must be.** `CircleGeometry(r, 6)` is a hexagon, but its UVs map the
*circumscribed square*, so `u` only spans 0.067–0.933 across the hexagon. Tile art drawn to fill its
own bounding box gets squashed inward. `scene/hexPlateGeometry.ts` maps the hexagon's actual extent —
`√3·R` wide by `2·R` tall — to the full 0–1 range in both axes, and insets the UVs by half a texel so
the transparent corner pixels are never sampled (they bleed RGB 0 and fringe every plate otherwise).

**Plate materials are unlit** (`MeshBasicMaterial`). The tile art has its lighting painted in, so
lighting it again doubles up and darkens it away from what was authored. This changes when tiles cast
real shadows — at that point the art becomes an albedo map and the material becomes lit. It is a
deliberate staging decision, not an oversight.

### Performance

Start with **individual meshes sharing geometry and material.** Measure. Only then optimise.

Per-instance symbol UVs are the reason: `InstancedMesh` needs a custom shader with an instanced
attribute to give each tile a different symbol, and that is real complexity — a hand-written shader
that then has to re-implement the parts of `MeshStandardMaterial` it wants to keep. Paying for that
before there is a measured frame-rate problem is speculative.

Budget: **60fps at 1440p with ~300 placed tiles.** If individual meshes miss it, the escalation order
is (1) merge the symbol planes into the body geometry with a second UV channel, (2) `InstancedMesh`
per colour with an instanced symbol-index attribute via `onBeforeCompile`, (3) bake the rim shading
into a texture and flatten the geometry. Record what was actually measured before moving down that list.

`renderMode: 'on-demand'` is attractive — a board game is static between moves, and `invalidate()`
during drags and tweens would cut idle GPU to nothing. It interacts with a replaced render function,
so evaluate it after the viewports work rather than up front.

## Interaction

### Picking

Ray from the pointer through the board camera, intersected with the **board plane** analytically —
not against tile meshes. Plane intersection gives a hit even over empty cells, which is exactly what
placement needs, and it costs one dot product instead of a scene traversal. Convert the hit point to
fractional axial coordinates, round to the nearest cell, then ask `game/tableau.ts` whether the move is
legal.

Tile meshes still need pointer events for hover affordances in the drawer and supply, where the
target is an object rather than a location. TresJS provides those events on the component.

### Drag

A state machine in `stores/drag.ts`:

```
idle → picking(item, from) → dragging(item, hoverCell, legal) → dropping(item, cell) → idle
```

The carried item follows the pointer, lifted along Y with a slight tilt toward the drag direction.
The hovered cell shows a ghost: the same tile at low opacity plus an emissive rim. Illegal targets
get a distinct treatment — dimmed and desaturated, not a red X, because at this altitude "you can't"
should be quiet.

Whether illegal placement is *blocked* or merely *non-scoring* is an open rules question
([game-design.md](game-design.md#open-questions)). The store models legality as a value on the
`dragging` state, so either policy is a change at one call site.

Drop animation: short fall with a small overshoot and settle, ~200ms, plus a brief specular pulse.
Pointer, mouse, and touch all go through Pointer Events — no separate touch path.

## UI chrome

The ornate frame is **DOM and CSS over the canvas**, not geometry in the scene. Text stays crisp at
any DPI, it is accessible and selectable, layout is CSS instead of hand-computed transforms, and the
9-patch brass frame from the art spec drops straight into `border-image` with no custom mesh.

Regions, following `screen1.png`: title bar with both scores; goals column left; board centre; shared
supply right; drawer bottom-centre; cost legend and end-turn bottom corners.

The contract between CSS and WebGL is one-way and narrow: chrome elements declare empty placeholder
divs for the three 3D regions, and `scene/layout.ts` reads their bounding rects to set viewports. CSS
owns layout; the renderer follows.

#### Borders are drawn over a box, never by it

The house rule for panels and controls in the chrome: no `border` on the element, a `::before` at
`inset: 0` carrying it instead (`.chrome-panel::before` in `styles/main.scss`, and the same shape on
each button).

A real border is part of the box, so a 1px edge makes a control 2px taller and the row it sits in 2px
taller again. That is not theoretical — all of these were the same cause: the header measured 46px for
a 44px design; it grew to 51px whenever the scoring strip appeared, moving the board's top edge for a
control the player had just pressed; and its title sat a pixel above the one in the panel beside it.

An overlay contributes no size, which leaves padding and gaps as the only things setting a height — and
that is what lets a **4px grid** hold rather than nearly hold. Panels are `8px 16px`, controls are 24px
square, gaps are 8px or 16px. `min-height: 40px` on the header (8 + 24 + 8) states the floor outright,
so a control appearing inside it can never resize it.

Hover and disabled states move to the pseudo-element with the border (`.action:disabled::before`), and
`pointer-events: none` keeps the ring from swallowing a click.

The rules *between* header groups are elements (`.rule`), not `border-left` on whichever group follows.
A border would be one more edge counted into a row whose height is the thing being held steady, and it
would have to be undone again on whichever group starts a wrapped line — a question about the viewport
that CSS cannot answer. An element simply is not rendered when it is not wanted.

#### The scoring panel shrinks rather than hides

The plan has to be read every round, but it is 247px down the right-hand edge — which a laptop can
spare and a phone cannot, where it covers the board it is describing. Closing it moves the current
round's row into the header as a strip: the same chips and the same live figure, from the same
`roundAgenda` call, so it is a shrink rather than a summary written twice. What the control trades is
the *other* rounds and the seat list — read between rounds, not during one.

**The preference is three states, not a boolean** (`composables/scoringPanel.ts`). `null` means never
chosen, which is not the same as closed: with no preference the default follows the screen — shut below
`NARROW_SCREEN`, open above it. A boolean would force a default at the moment of writing and then
remember it forever, so a player who opened the game once on a laptop would find it open on their phone
having never asked for that. Once they press the control, the choice is theirs everywhere.

It is one value for the player rather than one per game, unlike a read sheet or a seat: it says nothing
about any particular table.

**The header is bounded and wraps below 720px.** It is absolutely positioned with a left edge and no
right one, so it grew straight off the side of a phone — taking the scoring strip with it, which is the
control that exists for that screen. The settings line goes with the wrap, being reference rather than
news; everything that moves stays. The dividing rules go too, because which group starts the second
line depends on the width and a rule at the start of a line points at nothing.

### Turns and drafting

`game/turn.ts` holds the phase (`idle` / `taking` / `putting` / `paying`) and which actions are open;
`game/draft.ts` holds the draft rule and `game/payment.ts` the payment rule. All pure, all unit-tested
— the rule is where the bugs that matter live, and it is entirely testable without a canvas.

`GameView` owns the phase because it governs both the scene and the DOM bar; `ui/ActionBar.vue` renders
it. `TableauView` receives a `draggable` flag and a `draftStates` map and reports clicks back. It never
decides anything.

**Nothing is interactive while idle.** `draggable` is false outside `putting`, so a press before the
player has chosen an action does nothing at all. A turn is a commitment and a stray drag would spend it.

**Two pickers, not one.** `pick()` walks to the first *draggable* owner and so steps straight over
source tiles, which are deliberately undraggable. Clicking one is a different gesture, so
`pickSourceTile()` exists alongside it. It returns inactive tiles too — deliberately, so an inactive
tile still *absorbs* the press instead of letting it fall through to whatever is behind, which would
select a tile the player was not pointing at.

**The turn count advances in exactly one place.** Every completed action funnels through `endTurn()`,
a pass included, so that is where `nextTurn` is called. Cancelling deliberately does not advance it —
an abandoned action was not a turn. Turns are counted *within* a round (`nextRound` resets them), which
is settled in `game/turn.ts` so round advancement will not have to decide it again. The round itself is
pinned at 1 until the round structure exists.

**Only a board placement ends a `putting` turn.** Reordering the drawer is not spending your turn, so
`TableauView` emits `placed` only when the destination is the board — for a tile, that means the plate
it landed on is itself on the board.

### Rearranging the drawer, which is not a move

Sorting your own drawer costs nothing, ends no turn, and is allowed in **every phase** — including when
it is not your turn. So the `placing` prop does not gate dragging; it gates *where a drag may end*. A
drag that starts and finishes inside the drawer is always fine. Only the board needs a chosen action
behind it, and dragging something that is already on the board needs one too, for the same reason.

`resolveTarget` enforces it by offering **no target at all** outside the drawer when `placing` is false.
The piece can still be carried out over the board — stopping a drag dead at the drawer's edge feels
broken — but nothing out there lights up and releasing brings it home. Same honesty as the shared-source
guard: an invalid-looking target would imply the move exists and is merely refused.

**Dropping onto an occupied slot swaps.** `moveTile` refuses a taken destination, which is right for the
board and wrong for a drawer: with plain moves the last free slot is the only thing that lets anything
move, and a *full* drawer — exactly when sorting matters most — would freeze solid. So the view falls
back to `tableau.swapDrawerItems`, which exchanges two items' seats. A seat is a tile slot (holding a
tile **or** a stem, interchangeably) or a bay (holding a plate); a tile and a plate cannot trade,
because those are different seats. Both seats are vacated before either is filled — writing one at a
time collides with the key the other still holds, and would leave one item moved and one not.

**Stems are draggable after all.** They cannot be *placed* — `resolveTarget` never offers one a board
cell, and the drop path for a stem cannot even reach `placed`, which the compiler checks — but they
occupy a slot like anything else, and a drawer where tiles sort and stems do not would be worse than one
that does not sort at all.

**A press is not a click until it is released.** While paying, pressing a drawer item is ambiguous: pick
this to spend, or drag it elsewhere. Nothing commits on `pointerdown`. The press is recorded, and the
pointer decides: past `DRAG_SLOP_PX` (4px) it becomes a drag, released short of that it was a click.
Deferring fixed something visible in every phase too — lifting on `pointerdown` made a plain click flick
the tile up and back down.

### Anchors are cells, and both kinds ask the same questions

An anchor is modelled as a **cell**, not as a property of a plate. A plate hole and a wrapped gap are
the same shape of thing — something with six neighbours — so enclosure, the strict ring and the reward
are each written once, and only the *rate* varies by kind. The first version counted a plate's petals
instead and could not have described an external anchor at all.

Everything runs against a `BoardView`: which plate covers a cell, and what tile sits on it. The live
board is one such view and a hypothetical is another, which is what lets `rewardOfMove` ask "what would
this pay?" with exactly the code that asks "what does this pay?".

**Finding external anchors is bounded by the plates, not the board.** A candidate must touch coverage —
six covered neighbours is impossible otherwise — so the search walks the cells the plates occupy and
looks one step out, rather than scanning 1661 cells.

**A move can close several anchors at once,** so `rewardOfMove` compares whole boards: every anchor
enclosed afterwards and not before, summed. A tile sits beside up to six anchors; a plate can create an
external anchor and fill its final neighbour in one action. Reserving room for one and letting the rest
overflow is the bug this shape rules out.

One consequence to know: an anchor that did not exist before the move counts as newly closed, which is
precisely what makes the plate case pay.

### Anchors are derived, awards are not

`plateIsEnclosed` counts a plate's filled petals and nothing more — no flag, no bookkeeping, the same
reasoning that keeps board coverage derived from the plates. The payoff is that enclosure is
**reversible for free**: a provisional placement lights the emblem, and cancelling puts it out again,
with no state to unwind.

The *award* cannot be derived the same way, or an anchor could be emptied and refilled to mint stems
indefinitely. So `GameView` keeps a set of anchors that have already paid, and pays on **payment**
rather than on the placement landing — until the price is settled the placement is only provisional,
and cancelling has to leave the player with nothing gained.

The strict bonus is settled in one place, `effectiveStrictBonus`, rather than at each site that reads
it. The menu hides the control under strict placement, but a settings blob can also arrive hand-edited,
stored before the rule existed, or written by an older build — so the parser normalises it too, and
`GameView` reads through the same function. An invariant between two settings is worth having exactly
one owner.

**A reward that will not fit makes the placement illegal.** `canPlaceTile` refuses a move that would
enclose a plate when the drawer has too few free slots for the stems, which is why `createTableau`
takes `stemsPerInternalAnchor` at all — the model needs the rate to answer that one question. The slot
the tile is *vacating* counts as free, since the very move being judged empties it; without that, the
last placement out of a full drawer would be refused even when the reward fits exactly.

An **external** anchor cannot ride on a plate — it is a hole in the plates by definition — so
`ExternalAnchors.vue` draws it into the world directly, on a dark hex of its own, and rebuilds its set
whenever the model changes. The internal one is built once with its plate and lives as long as it does.

The two are told apart by a **tint** multiplied over the same art rather than by a second illustration:
they pay different amounts so the difference has to be visible, but they are the same kind of thing, so
two drawings would overstate it and double what has to be kept in step.

The tint is passed to `attachAnchorVisual` rather than applied by the caller afterwards, and that is not
a style preference. Anchor textures load lazily, so the meshes do not exist when the caller builds one —
tinting from outside landed on nothing, and nothing re-applied it once the load returned. Anything that
has to survive a late texture load belongs *inside* the builder, next to `lit`, which had already
learned the same lesson.

Two planes are built per anchor and toggled by `visible`, rather than one plane whose texture is
swapped. Lighting up then costs nothing at the moment it happens — no upload, no recompile, no frame
showing the old art while the new map decodes — and it is exactly reversible.

### Affordability is decided by counting, not by searching

`canAffordPlacement` in `game/payment.ts` answers "could this be paid for at all" without exploring
combinations. Every non-stem payer shares exactly one attribute with the target — sharing both would
make it equal to the target, which is barred — so a strategy's ceiling is the number of *distinct kinds*
sharing that attribute, and stems top up the rest. Two strategies, two counts, take the better.

It lives with the payment rules rather than with the placement rules in `tableau.ts`, which is where the
other "you may not start what you cannot finish" check sits. Payment has always been orchestrated by
`GameView` — the `paying` phase, `canApply`, the purse — with only the rules in `payment.ts`; the model
does not know what a payment is. Moving affordability into `canPlaceTile` would have meant teaching it,
and would have changed the answer for every existing test that places a tile out of an empty drawer.

The consequence is that the greying-out and the refusal both come from the view: `GameView` computes the
unaffordable set and `TableauView` both dims those items and declines to offer them a board target. The
two must agree — a dimmed tile that still lit up a valid target would be inviting a placement whose
payment step is a dead end — so they read the same set rather than each deciding for themselves.

Dimming is shown whenever a placement is *conceivable*, not only when one is affordable. Gating it on
affordability leaves the worst case — nothing placeable — with an undimmed drawer beside a dead Put
button and no visible reason for it.

### Rounds end, and the cards queue

`nextRound` finally has a caller. A round ends when Pass is pressed — with one seat that is everyone —
and `GameView` holds the state between rounds in `roundOver`, a tally rather than a turn phase. It is
not a `TurnPhase` because it is not something the player is doing *within* a turn; it suppresses the
action bar and the whole table the same way an announcement does.

The card machinery grew a **queue**, because a new round shows two cards in sequence — Round, then
Turn 1 — and the second must not start until the first has left. `finishAnnouncement` shifts the next
off the queue instead of clearing, which is the whole change; everything else pushes a single card. The
restock rides on the *turn* card, the one being watched when the new lot needs to appear.

`tallyRound` returns the matching tiles and not just a total, which is what lets the panel show its
working. `scoreTargets` is then defined as its total, so the live readout and the end-of-round panel
cannot compute different numbers.

### Placing is two steps, because it has a price

A placement moves the item to the board *first* and charges for it *second* (`putting` → `paying`).
The alternative — collect the payment, then move — would have the player buying something they cannot
yet see, on a board where "which petal" is most of the decision.

That only works because the move is genuinely undoable, which is what the `paying` phase's `origin`
field is for: it records where the item came from, so Cancel restores it exactly and the turn does not
advance. Without `origin` the provisional placement would be provisional in name only.

Three consequences worth stating, since each was a bug before it was a rule:

- **Dragging is off while paying.** `draggable` is true only in `putting`. The drawer is still live in
  `paying`, but for a different gesture — clicking to pick payers, routed through `pickDrawerItem()`.
- **Confirm requires the price *exactly*.** Not "at least": the surplus would be destroyed silently.
- **Spent items are destroyed, not moved.** `tableau.discard(id)` removes them outright. There is no
  discard pile, and inventing a location for one would put a place in the model the rules do not have.
  `discard` takes an id of any kind so a caller settling a mixed payment need not sort tiles from
  plates from stems first.

**Everything spendable must be a raycast root, and everything destroyable must be swept.** Payment is
the first feature that both *clicks* stems and *destroys* objects, and it broke on each. Stems were
missing from `castTo()`'s root list, which does not merely make them unclickable — an object that is
not a root is invisible to every pick, so presses fell straight through the coin. And `reconcileViews`
swept orphaned tiles and plates but not stems, so a spent stem stayed on the table, still wearing its
selection ring, long after the model had forgotten it. Both lists have to cover all three kinds.

**Draft states are drawn as overlays, not by restyling the tile.** Tiles share one material per palette
colour, so dimming one would dim every tile of that colour everywhere. The alternative — a material
clone per tile — has to be mutated back when the tile leaves the source and kept in step with the
palette, which is two ways to leave a tile stuck looking wrong. `scene/draftDecor.ts` adds a
translucent black hex and a mint ring per tile and toggles `visible`, which is exactly reversible. It
also dims the *symbol*, because it sits above it; restyling the tile material would not have.

The one thing the overlay misses is the bevelled rim, which keeps its colour. Tolerable — it reads as a
dimmed tile catching a little light.

**The selection ring ignores depth** (`depthTest: false`, high `renderOrder`). It extends past the tile
it belongs to, so with depth testing on it was sliced wherever a neighbouring tile crossed it — the
outline stopped mid-edge and looked like a rendering fault. Lifting the selected tile
(`SOURCE_TILE_SELECT_LIFT`) helps but cannot guarantee it, because neighbours sit at their own heights.
A marker another object can cut through is not a marker. Switching depth off is safe *here
specifically*: it is a thin UI outline on a tile, drawn only while drafting, and always being visible is
the whole point of it.

Two affordance details worth keeping: `take` requires a free drawer slot as well as a non-empty source,
and confirm additionally requires enough free slots for the whole selection. Both exist so the bar never
lights a button leading to a move that would then have to be refused.

### The plate's two faces

Both are the same brown cardboard: a slab carrying **seven** inset cell marks, each an inset hex, a gap
of bare slab, then a thin outline. One palette, one set of radii (`PLATE_TONES`, `PLATE_CELL_*`).

**They differ in exactly one thing — the colour of the centre mark.**

- Face **down**: all seven identical. Nothing can be placed on a face-down plate, so singling out a cell
  would imply a structure that is not there.
- Face **up**: the centre takes the darker `hole` tone. That cell is the plate's hole, never fillable, and
  a plate that appears to offer seven usable spaces instead of six misleads about the rules. A token
  symbol will sit in it later.

The outline stops at 0.95 of a cell because neighbouring cells are only `√3` apart; at 1.0 adjacent
outlines would touch.

**Low metalness on both.** A metal is lit almost entirely by what it reflects and this scene's studio
environment is deliberately dark, so a shinier slab is a *darker* slab here — the reverse rendered
near-black at metalness 0.55 before this was pinned down.

Both faces share `createPlateBaseGeometry`, so the silhouette is identical and a plate turning over does
not change shape. The face is baked into the mesh at creation, so a flip rebuilds the view rather than
restyling it (see `reconcileViews`).

A painted socket texture was tried on the face-up side twice and dropped twice (art-spec Asset 0): ornate
art on one face and plain cardboard on the other reads as two kinds of piece rather than two sides of
one. If it returns, the reverse needs a matching treatment at the same time.

### A plate's own tile is drawn flat

Every loose tile is a thick bevelled prism whose rim catches the key light — that rim is the only part
of a tile that can hold a highlight under a top-down camera, and it is what makes a tile read as a
physical piece. A plate's **own** tile is drawn with no thickness and no bevel at all, so it reads as
*printed on* the plate rather than *set into* it.

Purely a visual signal. The rule was already in the model — `Tile.fixed` makes the token indivisible
from its plate and undraggable, while keeping it a full tile for scoring. This only makes it legible
without a label.

Three things move together, and missing any one of them looks broken rather than flat:

- **Geometry** — `createHexPlateGeometry` instead of `createTileGeometry`.
- **Face height** — a flat token's origin *is* its face, so the symbol plane and the draft decor take
  `faceY = 0` rather than `TILE_THICKNESS / 2`. `attachDraftDecor` takes it as a parameter for exactly
  this reason: a marker sunk inside its tile is invisible, one floating above it looks detached.
- **Seating** — `PLATE_TOKEN_LIFT` rather than `PLATE_TILE_LIFT`. A token needs no half-thickness lift;
  it rests just clear of the socket mark beneath it.

Measured against a loose tile in the neighbouring petal: the loose tile's rim ramps 72 → 160 in
luminance across its bevel, while the token is a uniform 131 edge to edge.

### Revealing a plate, and drafting it

`Plate.faceDown` means "this plate's token is not known **here**", and the model holds no token for one —
that is what stops anything reading a value before it is turned over. So `revealPlate(id, spec, petal)`
takes the token from outside, and flipping plus creating the token is one operation: letting a caller do
half would allow a face-up plate with no token, or a face-down plate whose token can be read.

Today the specs wait in `dealtTokens`, a plain map in `GameView` — the local stand-in for the server that
will hand out reveals in multiplayer. Keeping it out of the tableau means moving it to the server later
changes one file rather than the shape of the game state.

`source.ts::platesToReveal` returns the plates that are ready rather than revealing them, for the same
reason: it has no token to give.

**Drafting works on items, not tiles.** `DraftItem` is a tile *or* a revealed plate, and the plate enters
as its own token. Two consequences worth pinning:

- Kind identity is `${color}:${value}` — **not** keyed on tile-or-plate. A revealed red-1 plate and a
  loose red-1 tile are the same kind, so a sweep takes one or the other and never both. Keying on the
  kind would let a colour sweep take both, which is exactly the repetition the rule exists to prevent.
  Which one the player takes is a real choice, because they cost different capacity.
- `draftSpace` counts tiles and plates **separately**, because they land in different places. One
  combined count would report a draft as fitting when it does not: three tiles and a plate need three
  tile slots *and* a bay, and four spare tile slots are no help.

`fits` is deliberately separate from `canConfirmDraft` so the bar can say *why* it is refusing — an
incomplete sweep and a sweep that will not fit are different problems. "Out of space" takes priority over
naming the sweep, because a finished-looking selection beside a dead button with no explanation is the
worst of the three states.

**A plate's draft state is drawn over the whole plate**, not on its token. Marking the token was the
first attempt and it misled: taking a plate takes the plate, not the tile printed on it, and it made a
plate look like just another tile in a draft when it costs a bay rather than a tile slot. The overlay and
outline follow the flower silhouette, built from the same `flowerOutline` as the slab so they trace its
real edge and cannot drift from it. Clicking anywhere on a revealed plate — slab or token — selects it.

**Decor is never a pick target** (`unpickable` in draftDecor.ts). Not a nicety: a plate's overlay spans
the whole flower and therefore hangs above the loose tiles heaped on that plate, so while it was
raycastable it swallowed every click aimed at them — the hit walked up to the plate, the plate was face
down and refused, and the tiles silently stopped responding. Hidden objects are still raycast.

**A flip rebuilds the plate's view.** The face is baked into the mesh at creation, so `reconcileViews`
compares the view's `faceDown` against the model and replaces the view when they disagree.

### Restocking, and objects that appear mid-game

`game/source.ts` owns the restock rule; `game/bag.ts` is the cursor into the seeded decks. The split is
deliberate: the *order* is a frozen contract derived from the game id, while the cursor is ordinary play
state that resets with the board.

`pushLot` shifts the stack down and pushes a new lot at slot 0. It walks **from the bottom up**, so each
lot's destination is already vacated — the other direction tries to move lot 0 onto an occupied lot 1 and
is refused. Both the opening deal and every restock go through it, so the first lot cannot drift from the
rest.

**`shouldRefill` checks the round's budget as well as capacity.** With plates undraftable the two
coincide, so the capacity check is redundant today. It is there because the day plates become draftable, a
lot could empty and free capacity the round has no plates left to fill — and relying on capacity alone
would then quietly deal more than a round's worth.

**`TableauView` reconciles its views with the model instead of building them once.** This is what the
restock broke: `onMounted`-only construction meant the freshly dealt plate and tiles had no mesh, so the
model was correct and the top slot rendered *empty*. That failure mode looks exactly like broken rules,
which is why it is worth naming. Reconciliation is driven by a `revision` prop that the owner bumps on
every mutation, so it fires when something could have changed and never allocates in the render loop. It
also removes orphaned views — nothing deletes objects yet, but omitting that branch would mean the first
thing that does silently leaks meshes.

A view created mid-game is marked `fresh` and **snaps** into place on its first frame rather than easing
from the canvas corner. Appearing in place is what "a new lot was dealt" should look like.

The heap scatter is keyed on the lot's **plate**, not its slot, precisely because of the shift: keyed on
the slot, every heap in the column would silently re-scatter each time a new lot arrived, which reads as a
glitch rather than a shift.

### The shared source column

`scene/sourceLayout.ts` + `SourceChrome.vue`, mirroring the drawer: pixel-space layout, chrome-panel
column, one nested bay per lot. Six lots down the left, under the title.

Two things about it are not obvious:

**Lots are sized to fit the height, then stop.** Six plates stacked is a *vertical* constraint, and at
a fixed 152px bay (the drawer's size) the column would be 900px tall and overflow most viewports. So
the lot width is derived from the space available and clamped to `[104, 176]`. Height follows from the
real plate aspect — a flower is 5 tall by 5.196 wide in `HEX_SIZE` units, verified numerically — because
using 1:1 leaves the plate visibly off-centre in its lot.

**The floor is only affordable because the column scrolls.** It was tried once without one and reverted:
the lots held a readable size, the column ran past the drawer, and the two panels fought over the same
pixels. Fitting won outright instead, and the column then degraded smoothly to unreadable — 59px lots on
a 1024x700 laptop, 21px on a phone held sideways. A floor was never the wrong idea, it was *homeless*.

So `SourceLayout` separates two heights that used to be one: `height` is what the panel occupies on
screen and still stops dead above the drawer, and `contentHeight` is the lots stacked, free to exceed
it. The difference is `maxScroll`.

**The scrollbar is a real DOM element, not a drawn one.** `ui/SourceScroll.vue` is an empty transparent
div laid over the column with `overflow-y: auto`, containing a spacer of `contentHeight`. The browser
supplies the bar, the touch momentum, the rubber-banding and the keyboard support; we read `scrollTop`.
It mounts only when the lots overflow, so a desktop — and a phone held upright, which fits six lots at
107px — sees nothing at all.

Three consequences worth knowing, because each is a place this could have gone wrong:

- **`lotCentre` stays in content space.** Views *ease* toward their target, so folding the scroll into
  it would make every piece chase a moving mark and trail behind the gesture. Callers subtract
  `scrollTop` after easing, which makes scrolling a rigid translation.
- **The container receives the presses.** It covers the column, so `TableauView` binds its picker to
  the element as well as to the canvas, and drafting moved from `pointerdown` to release-within-slop —
  otherwise a scroll would draft whatever it started on. `touch-action: pan-y` lets the browser settle
  scroll-versus-tap before any handler runs.
- **Clipping is per-material and raycasts ignore it.** Scrolled-out lots are cut by
  `sourceClipPlanes` (`scene/sourceScroll.ts`), attached and cleared in `setRegime` so a plate is not
  still sliced once it reaches the board. Pieces get *cloned* materials, because the plate's slab and
  socket are module-level singletons shared with the board. `pickSourceItem` guards on `contains()`,
  since a clipped-away tile is still sitting there as far as a ray is concerned.

**The column yields to the drawer, but only when it has to.** The drawer is bottom-centre and the
column is on the left, so on a wide viewport they never meet and the column can run to the bottom
edge; on a narrow one it stops above the drawer. The overlap test uses the column's *widest possible*
form rather than its actual width — the actual width depends on the height this decides, so using it
would be circular.

**Loose tiles are positioned from the lot, not from the plate they lie on.** Tempting to parent them
to the plate, as petal tiles are — but a lot's plate can be drafted away while its tiles remain, and
parenting would leave them hanging off nothing. They take the plate's *scale* (so a heaped tile is the
same size as a seated one) without taking its transform.

`scene/sourceScatter.ts` places them, seeded on `${gameId}:scatter:${lot}` from `game/random.ts` so a
lot looks the same after a refresh.

**The four tiles never overlap, by construction.** Two identical hexagons are centrally symmetric, so
they clear each other once their centres are `2` circumradii apart *in any direction* — the true bound
runs from `√3` flat-on to `2` at the vertices. Four tiles a quarter-turn apart at radius `r` sit `r√2`
apart, so `r ≥ √2 ≈ 1.414`; the floor is 1.45.

Angular jitter had to go to get that. Nudging neighbours together narrows their gap and the radius
needed to stay clear grows as `1 / sin(gap/2)` — even ±8° pushes it past 1.66, costing enough lot height
to shrink the tiles visibly. Variety now comes from rotating the whole ring per lot, which is free.
Radial jitter is also free, and not by luck: separation is `√(r₁² + r₂²)`, smallest when both sit at the
floor, so jitter can only help.

`sourceScatter.spec.ts` asserts the clearance over 1800 generated heaps rather than pinning example
values — what must hold is that *no* arrangement the generator can produce overlaps.

The cost is real and worth knowing: `SOURCE_HEAP_SPAN` went 4.6 → 5.1, so pick-area tiles dropped from
88% to 80% of drawer size at 1080p. Non-overlapping tiles need more room than overlapping ones; there is
no version of this that is free.

**Face-down plates** get `scene/plateBackVisual.ts`: the same slab geometry as the front — identical
silhouette, so a flip will not change shape — with no sockets and a subtle embossed seal. Note the
material: **low metalness on purpose**. A metal is lit almost entirely by what it reflects and this
scene's studio environment is deliberately dark, so the first attempt at metalness 0.55 rendered the
slab near-black and the plate read as a hole in the lot. Same trap made a bright seal look like a gap
between the tiles heaped over it.

**Draggable is not the same as movable.** `canDragTile`/`canDragPlate` are the drag affordance the
picker consults; `moveTile`/`movePlate` are the mechanism. Source items are undraggable but still
movable, because drafting will move them — conflating the two would either let a drag lift a tile out
of the source or leave drafting with no way to take one. Only `fixed` (a plate's own tile) is an
absolute bar, enforced inside `moveTile` for every caller.

Target resolution needs its own guard for the column, exactly as it has for the drawer: the column is
drawn over the board, so without one the cell *hidden behind it* resolves as the drop target and a
piece lands somewhere the player cannot see.

### Panels that have to live in the canvas

The drawer tray and the plate bays are the exception. They sit *under* live 3D tiles, so an opaque
DOM panel would cover its own contents — they have to be quads in the scene. `scene/chromePanel.ts`
gives them the `.chrome-panel` look, and matching it pixel-for-pixel took three things that are each
easy to get wrong:

1. **Work in pixel space, not world space.** The shader takes `uSizePx` — the panel's size in CSS
   pixels — and builds a rounded-rect distance field from it, so distances are in CSS pixels. The
   mesh's world scale and `uSizePx` come from the same layout, so zooming changes the world size and
   leaves pixel space untouched: the border stays 1 CSS pixel with no uniform to update. Verified
   across a 3× zoom range — the border measured exactly one row of RGB(58,50,34) at every level.
2. **Analytic coverage, not `smoothstep`.** `smoothstep(-aa, aa, d)` blends over `2*aa`, which
   smeared a 1px border across two rows at 40% brightness. `clamp(0.5 - d/aa, 0, 1)` with
   `aa = fwidth(d)` blends over exactly one device pixel and preserves the line's energy.
   (`fwidth` is safe on this field, unlike the grid lines: the `abs()` folds run down the panel's
   centre lines, far from any antialiased edge.)
3. **Snap the rect to whole pixels.** An edge landing at y = 517.6 splits a 1px line across two rows
   at partial coverage — correct, but visibly softer than the DOM panels beside it. `snapPanelRect`
   rounds the *origin* and the size, so both edges land on the grid at any size. CSS gets this for
   free; the canvas does not.

**Chrome is not tone-mapped.** The canvas uses ACES, which exists to fit scene radiance into a
display range. Chrome is UI that happens to be drawn in the canvas, and the DOM panels it must match
never see a tone-mapping curve — running the fill through ACES crushed RGB(21,23,28) to (5,6,9)
against the DOM panel's (17,18,23). So the panel shader includes `colorspace_fragment` but
deliberately **not** `tonemapping_fragment`. Alpha then blends in the sRGB framebuffer exactly as it
does for a DOM element.

The one unavoidable duplication: `CHROME_PANEL` in `scene/constants.ts` restates the border colour,
radius and fill from `.chrome-panel` in `src/styles/main.scss`, because GL cannot read CSS. They sit
side by side on screen, so a shade of drift would be obvious — both carry a comment saying so.

**The panel border is also where a container reports whether it is live.** A turn makes exactly one
area interactive — the source while drafting, your drawer while placing or paying — and
`setChromePanelTone` swaps three uniforms (`CHROME_PANEL_TONES`: `dim` / `resting` / `active`) to say
which. The source is dimmed by default and lit only during `taking`, because nothing about a heap of
tiles says "not yours to touch right now". The drawer is never dimmed — it is your own hand and stays
readable — and only brightens while you are acting on it.

`active` is a lighter brass rather than the mint of `HIGHLIGHT_COLORS`: mint is the colour of a valid
drop target, and "this area is live" is a far weaker claim than "release here". It is a uniform swap
driven by a `watch`, not by the render loop — nothing about the tone depends on the camera, so
recomputing it per frame would be work for nothing.

**Dimming the frame is not enough — the contents have to go with it.** Fading the source's border and
fill left the lots as bright as anything on the board, and a heap of full-colour tiles reads as
grabbable however faint its frame is. So the dim state also draws a **scrim**: one quad over the
column's rectangle, at the same snapped rect as the panel, tinting frame, bays, plates and tiles
together.

A scrim rather than per-item overlays, because what is dimmed is the *area*, not any object in it.
Per-item overlays would have to be built and torn down as the source restocks, kept out of the
raycast, and reconciled with the per-tile draft markers — which use exactly that mechanism to say
something narrower ("this tile, specifically"). The scrim does not care what is underneath it.

Two details it depends on. Its **height** (`SOURCE_SCRIM_Y = 2.2`) sits above every source tile but
below `HELD_TILE_Y`, so with depth testing left on, a piece carried across the column passes over the
scrim instead of being dimmed by it — no render-order special case, just the height. And its
`raycast` is stubbed out: hidden objects are still raycast in three, so without that the scrim would
make the source undraftable the moment it existed.

## State

- `stores/game.ts` — the authoritative game state, a thin reactive wrapper over `game/` data. Mutations
  go through rules functions; the store never reimplements a rule.
- `stores/drag.ts` — the drag state machine above. Transient, never persisted.
- `stores/camera.ts` — pan and zoom, so a view can be restored across route changes.

## Routing and auth

Routes: `/` (menu), `/join?id=…` and `/game?id=…`.

**A game is identified by a server-minted id.** It was a client-minted one, with its settings kept in
localStorage; both are gone. The whole game is a row and a log now, so `/game?id=…` survives a refresh
by rebuilding rather than by remembering — see "The command log" above.

Two details that turned out to matter:

- **Everything read back is parsed, never trusted.** localStorage is user-editable and outlives any
  version of this code, so a stored entry can be hand-mangled, truncated, or left over from an older
  shape. `parseGameSettings` refuses an unknown `kind` or `mode` outright — those name what the game
  *is*, and substituting a default would drop a player into a different game from the one they
  started — while repairing an out-of-range `platesPerRound`, which is only a dial.
- **The unknown-game guard belongs in the router, not the component.** `GameView` pulls in three.js,
  around 870 kB, so checking inside it meant downloading and parsing the whole chunk before bouncing
  back to the menu: measured at over 2 s. A `beforeEnter` on the route decides from one localStorage
  read and fetches nothing — 57 ms. The component keeps its own check as a fallback for storage
  cleared mid-session.

Settings are deliberately **not** wired into game setup yet. Rounds and drafting do not exist, and
`platesPerRound` is a round-supply figure rather than the drawer's bay count, so binding it to
`PLATE_SLOTS` would conflate two different numbers.

Auth hides behind an interface from day one:

```ts
interface AuthService {
  readonly user: Ref<User | null>
  signIn(): Promise<User>
  signOut(): Promise<void>
}
```

Stage 1 ships `GuestAuthService` — a local anonymous identity, no network. `GoogleAuthService` lands
with the backend: Google Identity Services returns an ID token, the API verifies it and issues a
session JWT, and the SPA stores that. Nothing outside `api/` learns which implementation is live.

## Backend contract (later stage)

Recorded here so the frontend does not paint itself into a corner:

- **Nest.js**, REST, OpenAPI document generated from decorators via `@nestjs/swagger`.
- Codegen produces a typed client into `frontend/src/api/generated/`, committed, regenerated by a
  script. Hand-written API types are not allowed to coexist with generated ones.
- REST for lobby CRUD, session listing, profiles, leaderboards.
- **WebSocket** (socket.io gateway) for live session state — turn changes and shared-source updates.
  REST polling is not adequate for a turn-based game where you wait on an opponent.
- Server validates every move with the shared rules module. The client's copy is for responsiveness
  and prediction only.

## Testing

- **`game/` gets real unit tests** — hex math, the plate sublattice both directions, placement
  legality, group traversal. Fast, no DOM, no WebGL. This is where correctness is bought.
- **`scene/` gets thin tests**: geometry and material construction, atlas UV lookup, and the
  world↔screen mapping in `layout.ts`. Rendering output itself is not unit-tested.
- **Visuals are verified by eye** in Stage 1. Screenshot regression is not worth its maintenance cost
  while the look is still being designed.
- Playwright E2E arrives with routing and auth, not before.

## Conventions

TypeScript strict. ESLint with the `game/` import restriction described above. `<script setup lang="ts">`
throughout. Prettier. Vue SFCs are `PascalCase.vue`; plain modules are `camelCase.ts`.

## Decisions and their fallbacks

| Decision | Why | If it fails |
|---|---|---|
| Orthographic, zero tilt | Undistorted symbols and exact hex proportions; affine world→screen keeps DOM alignment simple | Re-add tilt with a `1/cos(t)` Z scale to keep the projection proportional |
| Three scissored viewports, one context | Identical tiles everywhere, shared assets, one render target | Board-only canvas; drawer and supply as DOM with pre-rendered sprites |
| Individual meshes, no instancing yet | Per-instance symbol UVs need a custom shader; premature | Escalation ladder in [Performance](#performance) |
| Symbol as a child plane | `ExtrudeGeometry` UVs are hostile to precise top-face art | Merge into body geometry with a second UV channel |
| DOM chrome, not in-scene UI | Crisp text, accessibility, CSS layout, `border-image` 9-patch | — |
| Rules in pure TS with no framework imports | Backend reuse for authoritative validation; fast tests | — |

## Deliberately not in Stage 1

Scoring, stages, goals, Google SSO, the Nest.js backend, lobbies, online play, sound, and the tutorial.
Stage 1 is a graphics vertical slice — see [tasklist.md](tasklist.md). Drafting, payment and stems have
since been built on top of it and are no longer on this list.
