# hexnome — Game Design

**hexnome** (like *genome*, but on a hex grid) is a tile-drafting-and-placement game that runs in
the browser. The **rules are inspired by Azul: Queen's Garden**; the **layout and visual style are
inspired by Opus Magnum** — a clean hex playfield with a dark, ornate, polished frame.

This document is the rules reference. For architecture and rendering see [tech-spec.md](tech-spec.md);
for assets see [art-spec.md](art-spec.md); for build order see [tasklist.md](tasklist.md).

## Concept

Gameplay is **conceptually 2D** — a flat hex board, no vertical dimension in the rules. Presentation
is **genuinely 3D**: thick, glossy, beveled hex tiles lit by a real environment, viewed through a
tilted orthographic camera. The 3D is entirely aesthetic; it never changes what a move means.

**Engine-agnostic core.** The rules — board, tiles, plates, drafting, payment, scoring — are pure
TypeScript with no dependency on Vue or Three.js. Only rendering and input are presentation-specific.
This is what lets the future Nest.js backend reuse the same module to validate moves authoritatively
instead of trusting the client.

This is the third prototype of this game. Attempts one and two were Unity and Godot; both validated
the grid and drag-and-drop but neither shipped. This attempt targets a **free in-browser game** with
lobbies, sessions, and online play.

## Theme and symbols

Six colors × six symbols = **36 distinct tiles**. Under the hood a tile is just
`{ color, value: 1..6 }` — the symbols are a *skin* over the ordered numbers 1–6, so a different
symbol set can be swapped in without touching the rules.

The symbol set is molecular biology, each with a real numeric association:

| Value | Symbol | Association |
|------:|--------|-------------|
| 1 | DNA helix | one genome strand |
| 2 | Chromosome pair | inherited in pairs |
| 3 | Codon | exactly three nucleotides |
| 4 | DNA bases | A, C, G, T |
| 5 | Pentose sugar | five-carbon ring |
| 6 | Benzene ring | six-member carbon ring |

Symbols should read as **bold silhouettes, not accurate diagrams** — distinct at a glance and at
small sizes, the way Azul's icons are. The "6" must not be a plain hexagon; the board is already
hexagonal, so it needs the inner ring to stay distinguishable.

## The field (board)

- A **pointy-top hexagonal grid**, addressed with axial coordinates.
- Practically bounded but treated as effectively endless: up to ~100–200 cells in each direction.
  The camera **pans and zooms** across it.
- The game **starts with one plate already placed at the center**, holding a single value-1 tile.
  **Not implemented yet, and it matters:** a tile may only go into a petal of a placed plate, so with an
  empty board a drafted tile has nowhere legal to go. Choosing *Put* with only tiles in the drawer is
  currently a dead end you can only cancel out of. Dealing this centre plate is what unblocks it.
- Only placed plates and tiles are "real". A faint empty **honeycomb grid** is drawn behind them for
  orientation — the Opus Magnum look.

## Objects

There are two kinds of objects: **tiles** and **plates**.

### Tile

- A hexagon occupying **exactly one cell**.
- Has a **color** (6) and a **symbol/value** (6 ordered symbols ↔ numbers 1–6) → **36 distinct
  tiles**.

### Plate

- A **7-cell "flower" footprint**: **1 central hole** (never fillable) + **6 surrounding petals**.
- A plate arrives with **one of its 6 petals pre-filled** by a tile (the plate's tile); the other
  **5 petals start empty** and can later receive regular tiles.
- **The plate and its own tile are inseparable.** That tile cannot be lifted off or moved; it belongs
  to the plate and moves only with it. It still counts for scoring like any other tile.
- **A plate can be rotated** in sixth-turns, while it is in the drawer or while being dragged — not
  once it is on the board. Because a flower is six-fold symmetric, rotating never changes which cells a
  plate covers, so it can never make a placement legal or illegal; it only changes which petal points
  where, and therefore which cell the plate's tile lands on.
- **36 distinct plates** (6 colors × 6 values of the pre-filled tile).
- Plates **tessellate the grid as flowers** and are placed **edge-to-edge** with existing plates.
  Petals of adjacent plates are grid-adjacent, so tiles can touch across plate boundaries — this is
  how large groups form.

> **Two-level grid (working model):** the board is a hex lattice of **plate slots**; each plate holds
> its own 7 sub-cells (1 hole + 6 petals). Petals of neighbouring plates share edges on the fine
> grid. Plate placement is constrained to valid flower-lattice positions adjacent to existing plates.

> **As implemented, placement is looser than that.** A plate may go anywhere its seven cells are all
> free — it is *not* snapped to the flower sublattice, and it does *not* have to touch an existing
> plate. That is what the current stage asked for, and it is strictly more permissive, so tightening it
> later is adding a predicate rather than rewriting anything.
>
> It does have a consequence worth deciding on: off-lattice plates leave **stranded cells** — single
> cells too hemmed in for any flower to cover them, which can therefore never hold a tile. Snapping to
> the sublattice makes the board tessellate perfectly and no cell is ever stranded. See
> [Open questions](#open-questions).

## Shared source (common space)

- New **tiles and plates** appear together in **one shared common space**.
- In multiplayer it is **available to all players** to draft from.
- A draft takes items matching one chosen **color** *or* one chosen **value** — see
  [What a draft takes](#what-a-draft-takes) for exactly which ones.

### How the source presents itself

The source is a **column of six lots** down the left of the screen, under the title. A lot is:

- one **plate, face down** — you can see that a plate is there but not which tile it carries;
- **four loose tiles** heaped on top of it, face up.

The loose tiles are *not* in the plate's petals, and that distinction is load-bearing. A draft takes
every item of one colour or value, which may be some of a lot's tiles, its plate, or both — so a
lot's tiles must be draftable without dragging the plate along with them.

Because the plate is face down, drafting it is a partly blind choice: you know the four tiles you can
see, not the seventh you would also be taking. That is deliberate, and it is why the plate's own tile
does not exist in the model at all until it is revealed — there is no hidden value for a client to
read (`Plate.faceDown` in `src/game/tableau.ts`).

### What a draft takes

A draft is defined by **one attribute** — a color or a symbol — and takes every **distinct** tile in
the source carrying it. Three parts, and the third is the one that catches people out:

1. **Pick any tile to start.** Its color and its symbol are both still live as the criterion.
2. **The second pick pins the criterion.** Two tiles sharing only a color can only be a color draft, so
   every remaining symbol match drops out.
3. **At most one of each distinct tile.** The bag holds three copies of every tile, so duplicates show
   up in the source often. Selecting one red-2 rules out any *other* red-2 — it is already
   represented, and the copy stays in the source.

So "all the reds" means all *kinds* of red, not all copies of red.

Worked example, source showing `red-4  red-2  red-2  blue-1`:

| Step | Result |
|---|---|
| select `red-4` | `blue-1` inactive (shares neither); both `red-2` active (share red) |
| select `red-2` | criterion pins to **color**; the other `red-2` inactive (already represented) |
| confirm | takes `{red-4, red-2}` — one `red-2` is left behind |

A single tile can be a complete draft: if only one distinct 4 is showing, selecting it already *is*
"all the 4s". Conversely a partial sweep is never legal — you commit to an attribute, not to
favourites.

Every tile in the source is therefore in one of three states — **active**, **selected**,
**inactive** — and the states are recomputed after every click, because deselecting can widen the
criterion again.

**Plates are not draftable yet.** They lie face down, so their color and symbol are unknown, and an
unknown cannot be matched against a criterion. How a face-down plate joins a draft is unresolved — see
[Open questions](#open-questions).

### What is in the bags

Two bags feed the shared source, and their full contents are settled:

| Bag | Contents |
| --- | --- |
| **Plates** | **36** — one per distinct tile, i.e. 6 colors × 6 values of the pre-filled tile |
| **Tiles** | **108** — three copies of each of the 36 distinct tiles |

The shared source is a **window onto the front of these bags**. How wide that window is, and when it
refills, is the part still open (see [Open questions](#open-questions)).

Each plate also arrives with **one** of its six petals pre-filled and the other five empty. Which
petal is cosmetic — a plate rotates freely before placement, and drafting matches on the tile's color
or value, not its position.

Draw order is not random. It is derived from the game's id, so the same game always deals the same
36 plates and 108 tiles in the same order — see `docs/tech-spec.md`, "Seeded bags".

## Turn structure

On your turn you choose **one** action:

1. **Draft** — take every **distinct** tile of one **color** *or* one **value/symbol** from the shared
   source into your personal **drawer**. See [What a draft takes](#what-a-draft-takes).
2. **Place** — take **one** item from your drawer and place it on your board:
   - a **tile** may go **only onto an empty petal of an already-placed plate**;
   - a **plate** must **connect edge-to-edge** to an existing plate;
   - placing requires **payment** (below).
3. **Pass**.

The **drawer starts empty**, so the first turn can only be a draft. That is a starting position
rather than a rule to check — there is simply nothing to place yet.

> Two things about this are unsettled and worth not losing. Whether **pass** is always available or
> only when you cannot act is undecided; and it is not yet clear whether the **payment** requirement
> above survives, since the action list as most recently described does not mention it. See
> [Open questions](#open-questions).

## Payment (Azul-style)

- Placing an item of value/level **L** costs **(L − 1)**: value-1 is **free**, value-2 costs 1, …,
  value-6 costs 5.
- You **pay by discarding tiles from your drawer** that share the placed item's **color** *or* its
  **value**.

> Open: whether plates may be spent as payment, and whether the drawer is the only payment source.
> See [Open questions](#open-questions).

## Drawer

Your **personal** holding area for drafted items. Other players cannot touch your drawer or your
board — see [Interaction philosophy](#interaction-philosophy). The mockup sizes it at
**2 rows × 8 columns = 16 items**; whether that cap is a hard rule or only a layout constraint is
open.

## Scoring (Azul-style, at end of stage/game)

Both **same-color** and **same-value** connected groups score. A single tile can contribute to
**both** a color group and a value group.

- **Color group** — connected tiles of the **same color**, size ≥ 3 → scores the **sum of the tiles'
  values**. **No duplicate value** within the group (e.g. green {1, 2, 1} is illegal).
  - *Example:* touching green tiles 1, 2, 4 → **1 + 2 + 4 = 7 points**.
- **Value group** — connected tiles of the **same value**, size ≥ 3 → scores the **sum of their
  values** (= value × size). Whether a parallel "no duplicate color" restriction applies, and the
  exact formula, are open.

## Jokers

**Joker tokens** are earned by **filling all 6 petals around a plate's hole**. What they do and how
they are spent is open.

## Stages & end of game

- The game may be split into **multiple stages** (like Azul) or be a **single-stage puzzle**.
- **End condition:** you have **no items left in your drawer** and choose **not to draft** anything
  more. Then scores are counted.

## Game modes

- **Tutorial** — guided introduction to the rules.
- **Puzzles (Opus-Magnum-style)** — a **predefined, non-random** set of tiles and plates; place them
  to **maximize your score** and beat the highscore. Highscores may be logged to a global online
  leaderboard.
- **Multiplayer** — **online** (lobbies + sessions) or **hot-seat** on one machine. Players share the
  common source but otherwise play parallel puzzles.

## Interaction philosophy

Azul is criticized for **low inter-player interaction**, and we **intentionally keep it low** — we
are not trying to fix it. The **only** way to affect an opponent is to **draft the items they want
before they do**. You cannot touch another player's board or drawer; after the draft it is
effectively a single-player puzzle for each player.

This has a convenient consequence for the online implementation: the only shared mutable state is
the common source and the turn order. Each player's board and drawer are private and independent.

## Open questions

These are **deliberately unresolved**. Stage 1 is a graphics vertical slice
([tasklist.md](tasklist.md)) and does not implement drafting, payment, or scoring, so none of these
block current work. The rules module must leave room for them rather than answer them.

1. **Payment** — is the drawer the only source? Can plates be spent, or only tiles? Does the placed
   item's own tile count toward anything?
2. **Value-group scoring** — exact formula, and whether a parallel "no duplicate color" restriction
   applies.
3. **Rule enforcement** — is a no-duplicate violation an *illegal placement* (blocked by the UI) or a
   *legal but non-scoring* one? This decides whether that validation is a hard gate or an advisory
   hint, so it affects the UI as well as the rules.
4. **Shared source** — *composition is settled* (36 plates, 108 tiles), and so is its **shape**: six
   lots, each a face-down plate under four loose tiles (see
   [How the source presents itself](#how-the-source-presents-itself)). Still open: **when it
   refills**, and whether all six lots are dealt at the start of a round or fill progressively.
   Only one lot is dealt so far.
5. **Drawer cap** — is 16 a rule or only the mockup's layout?
6. **Stages** — how many, and what resets between them.
7. **Jokers** — what they do and how they are spent.
8. **Bonuses and goals** — the mockup shows per-goal bonuses ("complete all goals before the
   opponent"), but the goal system itself is not designed yet.
9. **Puzzles mode** — fixed *sequence* or fixed *pool*?
10. **Plate placement freedom** — should plates snap to the flower sublattice (generated by `(1,2)` and
    `(3,-1)`, so the board tessellates and no cell is stranded), and must they touch an existing plate?
    Currently neither constraint is applied: any position with seven free cells is legal.
11. **Pass** — always available, or only when no other action is legal? Currently unconditional.
12. **Drafting a face-down plate** — a plate's color and symbol are hidden in the source, so it cannot
    be matched against a draft criterion. Does drafting a color/symbol also sweep plates whose hidden
    tile matches (revealed on take)? Or are plates taken by a separate action? Currently plates are
    not draftable at all.
13. **Does payment survive?** The action list as most recently described is draft / place / pass, with
    no mention of payment — but the Payment section above still specifies it. One of the two is stale.
    This is the same uncertainty as question 1 seen from the other side.

_Resolved since:_ **what a draft takes** — one attribute, every distinct tile carrying it, at most one
copy of each; see [What a draft takes](#what-a-draft-takes). This settles the "or the same symbol, but
not the identical tiles" clause: identity is never the criterion, and duplicates are left in the source
rather than swept along.

_Resolved since:_ **a plate and its own tile are one indivisible object.** The tile it arrives with
cannot be lifted off, moved to another petal, or returned to the drawer; it travels with the plate and
nowhere else. Pressing it drags the plate. It remains a full tile for scoring — it takes part in colour
and value groups like any other — so it is modelled as a tile that happens to be immovable, not folded
into the plate record where anything enumerating tiles would miss it.

**Resolved:** plate = 7-hex flower with a two-level grid; one shared pool drafted by color or value;
both color and value groups score; the symbol set is the molecular-biology set above.

## Non-goals

- Fixing Azul's low inter-player interaction — intentional.
- "True 3D" gameplay. Thickness is decoration; the rules stay flat.
- Native or mobile app builds. This is a browser game.
