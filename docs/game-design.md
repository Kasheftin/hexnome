# hexnome — Game Design

**hexnome** (like *genome*, but on a hex grid) is a tile-drafting-and-placement game that runs in
the browser. The **rules are inspired by Azul: Queen's Garden**; the **layout and visual style are
inspired by Opus Magnum** — a clean hex playfield with a dark, ornate, polished frame.

> **This is not the rules reference; it is the reasoning behind them.** What each rule is, a player
> reads in `frontend/src/content/rules.md`, which the app shows under *Game rules*. What is here is
> why it is that rule and not another — the alternatives that were rejected, and the questions still
> open. A player should never have to read this; whoever changes a rule should.
>
> **Its numbers are checked against the code** by `frontend/src/content/designDoc.spec.ts`, beside the
> spec that does the same for the rulebook: change a default without changing the prose and the suite
> fails. It had no such check for most of its life and drifted — the drawer was documented at 16 slots
> long after it became a dial defaulting to 12, and the round anchor points were added without it
> hearing about them at all. Both are fixed above; the check is what stops the next one.

For architecture and rendering see [tech-spec.md](tech-spec.md); for assets see
[art-spec.md](art-spec.md); for build order see [tasklist.md](tasklist.md).

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
- The game **starts with one plate already placed at the center**, holding a single value-1 tile —
  see [The opening plate](#the-opening-plate).
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
  plate *covers*; it changes which petal points where, and therefore **which cell the plate's own tile
  lands on**. That used to make rotation cosmetic. It no longer is: under
  [the neighbour rule](#the-neighbour-rule) the token's cell decides what it has to agree with, so a
  hole that refuses a plate may accept the same plate turned.
- **36 distinct plates** (6 colors × 6 values of the pre-filled tile).
- Plates **tessellate the grid as flowers** and are placed **edge-to-edge** with existing plates.
  Petals of adjacent plates are grid-adjacent, so tiles can touch across plate boundaries — this is
  how large groups form.

> **Two-level grid (working model):** the board is a hex lattice of **plate slots**; each plate holds
> its own 7 sub-cells (1 hole + 6 petals). Petals of neighbouring plates share edges on the fine
> grid. Plate placement is constrained to valid flower-lattice positions adjacent to existing plates.

### The connection rule

**Every plate after the first must touch one already on the board**, and touching means **sharing an
edge**. The board is one connected sheet: plates may not be dropped off on their own to be joined up
later, so the tableau grows outward from the starting plate.

Hexes have no corners that meet without an edge between them, so "shares an edge" and "is a neighbour"
are the same test — a plate connects if any of its seven cells neighbours a cell of another plate.

Two consequences worth knowing, both of which fall out rather than being separately specified:

- The **first** plate is exempt, having nothing to touch. That is what lets the starting plate land in
  the middle of an empty board.
- Legal holes for a second plate are **exactly the ring at distance 3** from the first. Nearer overlaps;
  further cannot reach. That is 18 positions around any given plate.

> **Placement is still looser than the working model above in one respect.** A plate is *not* snapped to
> the flower sublattice — it need only connect, not interlock. So of those 18 positions, 6 tessellate
> cleanly and 12 leave gaps.
>
> The gaps are the consequence worth deciding on: off-lattice plates leave **stranded cells** — single
> cells too hemmed in for any flower to cover them, which can therefore never hold a tile. Snapping to
> the sublattice would make the board tessellate perfectly and strand nothing. See
> [Open questions](#open-questions).

### The neighbour rule

A tile landing on the board looks at the **six cells around it**.

- If none of them holds a tile, the placement is free. An isolated tile answers to nobody.
- If any of them does, the neighbours have a say — and how much of a say is a **game setting**.

| Setting | A tile may land if… |
|---|---|
| **Regular** (default) | **at least one** neighbour shares its colour **or** its value |
| **Strict** | **every** neighbour shares its colour **or** its value |

Regular asks a tile to belong *somewhere*; strict asks it to belong *everywhere it touches*. Anything
strict allows, regular allows too.

Neighbours are counted across plate boundaries as well as within a plate — petals of adjacent plates
share edges, and that is exactly how groups grow beyond one flower.

**A plate is checked the same way, through the tile it carries.** Its token sits on a cell like any
other, so that cell's six neighbours are examined by the same rule. One consequence worth knowing at
the table: **rotating a plate moves its token to a different cell**, so a hole that refuses a plate may
accept it turned. The rotation controls in the bay are therefore part of placement, not decoration.

> **Open — what "every neighbour must match" means when they match differently.** As built, each
> neighbour is judged on its own: one may agree by colour while the next agrees by value. The stricter
> reading is that a *single* attribute must carry all of them, which is how drafting and payment work.
> The two only differ when neighbours agree on different attributes. See
> [Open questions](#open-questions).

### Groups, and the no-duplicates rule

Every tile on the board belongs to **two groups at once**:

- its **colour group** — the run of connected tiles sharing its colour;
- its **value group** — the run of connected tiles sharing its value.

"Connected" means reachable by stepping from tile to adjacent tile *without leaving the attribute*: a
colour group is walked through same-colour tiles only. Both groups always contain the tile itself, so
both exist even for a tile standing alone.

**Neither group may contain the same tile twice** — the same colour *and* the same value. A group is a
set of distinct things, and a placement that would break that is refused.

The case that shows why this is not just "no two identical tiles touching":

```
Blue-1 · gap · Blue-1        legal — nothing connects them, so they are in different groups
Blue-1 · Blue-2 · Blue-1     refused — one colour group now holds two Blue-1s
```

The Blue-2 is not a duplicate of anything. It is the **bridge** that makes two distant tiles collide,
and it is the bridge that gets refused. A group can be walked a long way round, so the duplicate it
finds need not be anywhere near the tile being placed.

The obvious consequence, which needs no separate rule: **a tile can never go beside a copy of itself.**
Two identical tiles adjacent are connected in *both* groups, so both are duplicated at once.

Like the neighbour rule, this applies to a plate through the tile it carries.

## What each player owns

This is a **puzzle game played beside other people**, not against them. Each player has their **own
board** and their **own drawer**, and neither can be touched by anyone else. Nothing you place, hold or
score is reachable by another player.

The **shared source is the only common object**, and therefore the only place interaction happens: you
can take the tiles someone else was building towards. Once an item is in your drawer it is yours, and
from there the game is solitaire.

That is worth being explicit about because it decides the shape of the state: **one tableau per player**
(board + drawer), plus **one shared source** between them. `src/game/tableau.ts` currently models a
single player's board and drawer *and* the source together, which is right for singleplayer and will
need splitting when a second seat arrives.

### The opening plate

Before the first turn, each player is given a **value-1** plate of their own colour, placed at the
**centre of their board** and holding its own tile.

- Every player therefore opens from the same modest footing — a value-1 plate — with the colour dealt
  from the game's seed.
- Those plates are **held out of the bag**. They are on a board, so they can never appear in the
  shared source. (Spend one and it enters the *pile*, from where it can be dealt out of a bag it was
  never in — intended: a plate is a plate.)
- **At most six players**, one colour each. A seventh would have to double up.

The colours are chosen by their own draw rather than by reading the top of the plate bag. That used to
be the same thing; it stopped being when the bag moved to the server, because looking through it is
exactly what a client must not do.

It happens **once**, at the start of the game — not once per round.

The centre plate is what makes the board playable at all: a plate must connect to an existing plate, and
a tile may only go into an empty petal of a placed plate. Without it there is nowhere to put anything.

### Drawer size

Both halves of the drawer are game settings.

| | Choices | Default |
|---|---|---|
| **Tile slots** | 10, 12, 14, 16 | 12 |
| **Plate bays** | 1, 2, 3 | 2 |

Both are difficulty dials in disguise. Tile slots are the room to hold tiles you cannot place yet — and
stems occupy them too, so a large opening allowance eats into it. Bays are how many plates you can keep
in hand before committing one to the board. Fewer of either forces earlier decisions.

The tile counts are all **even** because the grid is two rows deep, so each divides exactly into
columns. A wider drawer makes the panel physically wider; what happens when it outgrows a small screen
is not yet decided.

## Stems (the jokers)

**Stems** — stem cells — are the game's wild card, and they behave unlike anything else on the table.

- They live **only in the player's drawer**, and they occupy an ordinary **tile slot**. That makes them a
  cost as well as a gift: a stem is one fewer place to put a drafted tile until it is spent.
- They **can never reach the board**. There is no move that puts a stem on a plate.
- They are **spent as wild payment** when placing: a stem counts as one item toward the price, matches
  neither colour nor value because it has neither, and any number may go into one payment. See
  [Payment](#payment-azul-style).
- They are **earned by enclosing an anchor** — see [Anchors](#anchors-and-earning-stems).
- Each player is dealt **`initialStems`** of them at the start of the game — a setting, 1–4, default 3.
  Once per game, before the first turn.
- Where else stems come from is undecided; they are described as bonuses.

A stem is deliberately **not a tile**. It has no colour and no symbol, so it cannot be drafted, matched
or scored, and it never appears in the shared source. It shares exactly one thing with a tile — the slot
it stands in.

Visually it is a **coin**: a round token among hexagons. Everything else on the table tessellates with
everything else; a stem never joins the board, so being round says it plays by different rules before a
player has read anything.

## Shared source (common space)

- New **tiles and plates** appear together in **one shared common space**.
- In multiplayer it is **available to all players** to draft from.
- A draft takes items matching one chosen **color** *or* one chosen **value** — see
  [What a draft takes](#what-a-draft-takes) for exactly which ones.

### How the source presents itself

The source is a **column of lots** down the left of the screen, under the title — **one slot per plate
the round deals**, so a 4-plates-per-round game shows four. A lot is:

- one **plate, face down** — you can see that a plate is there but not which tile it carries;
- **four loose tiles** heaped on top of it, face up.

The loose tiles are *not* in the plate's petals, and that distinction is load-bearing. A draft takes
every item of one colour or value, which may be some of a lot's tiles, its plate, or both — so a
lot's tiles must be draftable without dragging the plate along with them.

Because the plate is face down, drafting it is a partly blind choice: you know the four tiles you can
see, not the seventh you would also be taking. That is deliberate, and it is why the plate's own tile
does not exist in the model at all until it is revealed — there is no hidden value for a client to
read (`Plate.faceDown` in `src/game/tableau.ts`).

### Turning a plate over

A plate in the source lies face down **while tiles are heaped on it**. The moment its lot is picked
clean, it turns over and its token is revealed.

A revealed plate then **drafts as its token**. A plate showing blue-4 is a blue item and a 4 item, swept
by either strategy exactly as a blue-4 tile would be:

> Source shows a revealed **blue-4 plate**, plus loose **blue-3** and **blue-2**.
> Taking `blue-3` alone is legal — it is the only 3. But add `blue-2` and the colour pins, so the sweep
> now has to include the **blue-4 plate** as well.

**A plate counts as its token, full stop.** A revealed red-1 plate and a loose red-1 tile are the same
kind, so a draft takes one or the other — never both. They repeat, and the one-per-kind rule applies
across tiles and plates alike.

Which one you take is a real choice, not a formality: the plate brings a whole plate and costs a bay,
the tile costs a tile slot. With both bays full, taking the tile instead can be what makes a sweep fit.

A face-down plate is not draftable at all. Its token is unknown, and an unknown cannot be matched
against a criterion.

### Drawer capacity

Drafted tiles go to the drawer's **12 tile slots**; drafted plates go to its **2 plate bays**. They are
separate, and so are their limits:

- Tile slots full → you cannot take tiles.
- Both bays full → you cannot take plates.
- **Take** is only offered when at least one kind is both showing in the source and housable.

Because a sweep can drag a plate along with the tiles, a selection can be a perfectly legal sweep and
still not fit — all the blues might include a plate when both bays are taken. That is not an illegal
draft, it is an impossible one, and the action bar says **"out of space"** rather than silently refusing.

### How many plates a round deals

**Plates per round** — 3, 4, 5 or 6, default **4**. It is the round's whole budget of new material,
and it is also the height of the source column: the column has exactly as many slots as the round has
plates, so a round's worth can never be pushed off the bottom before anyone has had a chance at it.

One number doing both jobs is deliberate. A column shorter than the budget would strand lots; a column
longer than it would stand permanently half empty. Tying them together means the only question a
player is being asked is how much material a round should offer.

### When the source restocks

The source is a **stack that grows from the top**. Lot 0 is the newest and sits at the top of the
column; everything older sits below it.

- The game opens with **one lot**: a face-down plate under four tiles.
- At the **start of every turn**, if the **topmost lot is no longer full** — someone has drafted a tile
  out of it — then every lot **shifts down one slot** and a fresh face-down plate with four new tiles is
  pushed in at the top.
- Only the *topmost* lot's fullness matters. Drafting out of a lower lot leaves the stack alone; the
  source restocks only once its newest offering has been touched.
- A round deals **`platesPerRound` plates in total**. Once they are gone, nothing new appears and the
  source only shrinks as it is drafted.

The slot count and the plate quota being the same number is not a coincidence — it is the same fact
twice. Lots never leave the source (a plate cannot be drafted yet), so the number of occupied lots
equals the number of plates dealt, and the column is exactly full when the round's plates run out.
Nothing can ever be pushed off the bottom.

A draft always sweeps the **whole source**, not one lot. Once there are several lots, taking "all the
reds" takes them from wherever they are sitting.

### What a draft takes

A draft is defined by **one attribute** — a color or a symbol — and takes every **distinct** tile in
the source carrying it. Three parts, and the third is the one that catches people out:

1. **Pick any tile to start.** Its color and its symbol are both still live as the criterion.
2. **The second pick pins the criterion.** Two tiles sharing only a color can only be a color draft, so
   every remaining symbol match drops out.
3. **At most one of each distinct kind.** The bag holds three copies of every tile, so duplicates show
   up in the source often. Selecting one red-2 rules out any *other* red-2 — it is already
   represented, and the copy stays in the source. A revealed plate counts as its token here too, so a
   red-1 plate and a red-1 tile are the same kind.

So "all the reds" means all *kinds* of red, not all copies of red.

Worked example, source showing `red-4  red-2  red-2  blue-1`:

| Step | Result |
|---|---|
| select `red-4` | `blue-1` inactive (shares neither); both `red-2` active (share red) |
| select `red-2` | criterion pins to **color**; the other `red-2` inactive (already represented) |
| confirm | takes `{red-4, red-2}` — one `red-2` is left behind |

**Two strategies, and finishing either one is enough.** From the moment you pick your first tile, both a
**colour** sweep and a **symbol** sweep are on the table:

- A strategy is **finished** when every distinct tile of that attribute is selected.
- Finishing one is enough to confirm — **even if tiles matching the other are still sitting there
  unselected**. You have committed to a sweep and completed it; the road you did not take is irrelevant.
- The **second pick decides** which strategy you are on. Two tiles sharing only a colour means a colour
  draft, and the symbol strategy is off the table for the rest of that draft.

Worked example, source showing `blue-1  blue-3  red-3  yellow-3`:

| Selection | Confirmable? | Why |
|---|---|---|
| `yellow-3` | **yes** | the only yellow, so the colour sweep is done — the two other 3s do not block it |
| `red-3` | **yes** | likewise the only red |
| `blue-1` | **yes** | the only 1, even though `blue-3` is also blue |
| `blue-3` | no | unique in neither: another blue and two more 3s outstanding |
| `yellow-3` + `red-3` | no | they share only the symbol, so the value strategy pinned — `blue-3` is missing |
| `yellow-3` + `red-3` + `blue-3` | **yes** | every 3 taken |

A partial sweep is never legal: each click is fine on its own, but confirming means you have taken
everything one attribute offers.

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

Both are the **defaults**, and both are dials in the game settings: tiles at 72 / 108 / 144 and plates
at 36 / 72 / 108, i.e. 2–4 and 1–3 copies of each distinct kind. More tiles makes duplicates commoner
in the source, so a color sweeps more easily; more plates means the plate bag reshuffles later, or
never — a four-round game draws sixteen. Everything below describes the standard bags.

The shared source is a **window onto the front of these bags**. How wide that window is, and when it
refills, is the part still open (see [Open questions](#open-questions)).

Each plate also arrives with **one** of its six petals pre-filled and the other five empty. Which
petal is cosmetic — a plate rotates freely before placement, and drafting matches on the tile's color
or value, not its position.

Draw order is not random, and it is **not the client's to know**. Both bags live on the server, dealt
from a seed minted with the game — see `docs/tech-spec.md`, "The desk service". The same seed always
deals the same game, so a replay is exact; the settings settle how many, and the two are independent.

### The discard pile, and reshuffling

Nothing that leaves play is destroyed. There are **two piles**, one per bag, and three ways to reach
them:

- **A round ends.** The shared source is swept — every remaining lot, its face-down or revealed plate
  and the loose tiles heaped on it. A round's leftovers are not next round's offering.
- **Something is spent as payment.** The tiles and plates that paid for a placement go to the piles
  rather than out of the game.
- A plate always travels **whole**, its own tile included. It is one plate in the plate pile, and its
  token does *not* also become a loose tile.

**Stems are the exception.** They are minted by anchors rather than drawn from a bag, so a spent stem
simply ceases to be — there is no bag owed it back.

**A bag that runs dry is refilled from its pile**, reshuffled, and the draw finishes out of it — the
deck-of-cards move, so a lot is never dealt short while material exists. In practice this is hard to
reach: only the largest configuration exhausts a bag inside a game, and it happens silently when it
does. If bag *and* pile are both empty the source simply stops growing.

The reshuffle is **seeded from the game's seed and the pile itself**, not from chance, so a game is
still entirely determined by how it was played. That is why each batch is discarded in a fixed order
rather than in whatever order the player clicked — see `docs/tech-spec.md`, "The reshuffle".

## Turn structure

On your turn you choose **one** action:

1. **Draft** — take every **distinct** tile of one **color** *or* one **value/symbol** from the shared
   source into your personal **drawer**. See [What a draft takes](#what-a-draft-takes).
2. **Place** — take **one** item from your drawer and place it on your board:
   - a **tile** may go **only onto an empty petal of an already-placed plate**;
   - a **plate** needs its seven cells free and must **share an edge** with a plate already on the
     board — see [The connection rule](#the-connection-rule);
   - whatever is placed must agree with whatever it ends up **next to** — see
     [The neighbour rule](#the-neighbour-rule);
   - and must not put a **duplicate** into either group it joins — see
     [Groups, and the no-duplicates rule](#groups-and-the-no-duplicates-rule);
   - placing requires **payment** (below).
3. **Pass**.

Turns are numbered **within a round**, so the header reads "round 2, turn 5" for the fifth turn of that
round. Every completed action advances the count; abandoning a part-built action does not.

**Pass is not a skipped turn — it takes you out of the round.** A player who passes is done until the
round ends, and the round ends once *everyone* has passed. With one seat those are the same moment, so
a single Pass finishes the round. It is a choice rather than a detection: it usually happens when
nothing can be drafted and nothing placed, but a player may pass with moves still on the table, and
nothing passes on their behalf.

**The first player out of a round pays for it, and is paid for it.** They give up the *first-pass
fine* — 0, 1 or 2 points, 1 by default — and they take the **first turn of the next round**, at a
source nobody has touched yet. So leaving early is a trade rather than a surrender: you buy the next
round's first pick with this round's points, and the fine is the dial that decides how good a deal
that is. At 0 there is no reason not to bail out the moment the source turns awkward.

Both halves are one rule and neither exists alone: without the fine the lead is free, and without the
lead the fine is a punishment for something a player often has no choice about.

**Neither applies in a solo game**, and the setting is not offered there. With one seat every pass is
the first one, so the fine would be a charge for reaching the end of a round, and leading the next is
not a privilege when there is nobody to lead.

The **drawer starts empty**, so the first turn can only be a draft. That is a starting position
rather than a rule to check — there is simply nothing to place yet.

> One thing about this is unsettled and worth not losing: whether **pass** is always available or only
> when you cannot act. See [Open questions](#open-questions).

## Payment (Azul-style)

Placing costs. The price is paid out of **your own drawer**, which is the only payment source — no
other player's drawer, and nothing on the board.

- Placing an item of value/level **L** costs **(L − 1)** items: value-1 is **free**, value-2 costs 1,
  …, value-6 costs 5. Note the count is **L − 1**, not L: a blue-3 costs **two** objects.
- Every payer must share the placed item's **color**, *or* every payer must share its **value** — the
  same one-attribute rule a draft follows, but anchored on the item being placed rather than
  discovered from the selection.
- **No two equal items anywhere in the transaction**, spanning what is placed *and* what pays for it.
  So a blue-3 cannot be paid for with another blue-3, and two yellow-3s cannot pay together.
- **Plates may be spent**, and a plate pays as its **own token** — exactly as it drafts as its own
  token. Spending a plate spends the whole plate.
- **Stems are wild**: any number of them, no matching required, and they are exempt from the
  equal-items rule, having no colour or value to be equal by.
- Spent items are **destroyed**. There is no discard pile to reclaim them from.

Worked example — placing a **blue-3** costs two objects. A stem plus a blue-2 plate works (colour). A
yellow-3 plus a red-3 works (value). Another blue-3, tile or plate, is barred outright.

Because nothing can share *both* the placed item's colour and its value without being equal to it, the
**first non-stem payer settles which attribute is in play**. There is no gradual narrowing here as
there is in drafting.

### What you cannot afford, you cannot place

An item whose price this drawer could never meet is **not a legal placement**. It is shown greyed out
in the drawer, it offers no drop target on the board, and if nothing at all is affordable the **Place**
action is closed rather than leading to a payment step that can only be cancelled.

Deciding it needs no searching. Every non-stem payer shares exactly one attribute with the placed item,
so the most a strategy can raise is "every *distinct* kind sharing that attribute", with stems making up
the rest — two blue-2s are one payer, since the second would duplicate the first. Comparing the colour
run and the value run and taking the better one answers it exactly.

Greying out does not stop you **sorting** an unaffordable tile around the drawer; it is out of reach,
not untouchable. And it can come back into reach: draft a tile that shares its colour and the price is
suddenly payable.

> Tiles you cannot pay for tend to sit in the drawer at the end of a round, and they **carry over** to
> the next one rather than being cleared. See [Open questions](#open-questions) 6 for what else does or
> does not reset.

### The two-step flow

A placement is one turn but **two** steps, because the player should see what they are buying before
they buy it:

1. Choose **Place**. The prompt reads "drag a plate or tile onto the board".
2. Drag the item to a legal position. It **lands there** — the move is made, provisionally.
3. The prompt changes to the price. Dragging is now off; instead every drawer item becomes
   **selectable**, and the ones that cannot legally pay are dimmed.
4. **Apply** is enabled only when the payment is *exactly* right — not merely sufficient, since
   overpaying would silently destroy items the player wanted. A free (value-1) placement is
   confirmable immediately, with nothing selected.
5. **Cancel** undoes the placement entirely: the item returns to exactly where it came from, nothing
   is spent, and the turn does **not** advance.

## Drawer

Your **personal** holding area for drafted items. Other players cannot touch your drawer or your
board — see [Interaction philosophy](#interaction-philosophy). The mockup sized it at
**2 rows × 8 columns = 16 items** and left open whether that was a rule or a layout constraint; it is
a rule, and a dial — see [Drawer size](#drawer-size).

**Rearranging it is not a move.** You may drag items between slots at any time — on your turn or not —
and it costs nothing, spends no payment and ends no turn. Dropping onto an occupied slot **swaps** the
two, which is what keeps a full drawer sortable. Tiles, stems and plates can all be moved this way;
tiles and stems share the tile slots and can trade with each other, while plates trade between the two
bays.

Nothing may **leave** the drawer except as part of a placement, which is a real action and costs the
turn.

## Round scoring

At the end of each round you score for that round's **targets**. A target is either:

- a **value** — every tile on the board with that value scores its own value each (a 6 is worth 6);
- a **colour** — every tile of that colour scores 1 each, whatever its value.

Counting is over the **whole board as it stands**, not only what was placed during the round, and a
plate's own tile counts like any other. A tile is counted once per target it matches, so one that
satisfies both a value and a colour target in the same round scores for both.

Across a mode's rounds every value 1–6 and every colour appears **exactly once** — twelve targets,
which is what makes the round shapes work out: 3 to a round over four rounds, or 2 over six.

| Mode | Rounds | Plan |
|---|---|---|
| **Classic** | 4 | values `1,2` + 1 colour · `3` + 2 colours · `4,5` + 1 colour · `6` + 2 colours |
| **Classic reversed** | 4 | the same four rounds, largest values first |
| **Random** | 6 | one value and one colour per round |

**Which colour belongs to which round is dealt from the game id**, in every mode; Random shuffles the
values too. So Classic keeps a recognisable rhythm — small values first, the 6 last — while each game's
colour plan differs, and the whole agenda is still reproducible from the URL. That last part is what
makes a run repeatable: the same link is the same game to beat.

Classic reversed opens with the colour-heavy round, since Classic closes with one. That is a
consequence of the shape rather than an oddity.

### Anchor points, for building wide

Every **anchor on your board** also pays at the end of every round: 0, 1 or 2 points for an internal
one (1 by default) and the same choice for an external one (0 by default). A plate brings exactly one
internal anchor with it, always, so this is simply what another plate is worth.

**It is the only thing in the game that pays for width.** The targets above pay for tiles and so does
the final scoring, so without this a player is best served by working one plate to death and the board
never grows.

It compounds, and that is the point: a plate placed in round 1 pays its anchor again in every round
that follows — one extra plate in a four-round game is four points, not one. So the argument for
spending a turn on width is strongest early and worth nothing at all by the last round.

**No enclosure is required.** That is what separates these from the stems in
[Anchors, and earning stems](#anchors-and-earning-stems): those pay for closing a ring of six tiles
around a hole, which is a feat, while these pay for the hole being there, which is a decision about the
shape of your board. External anchors default to 0 because a wrapped gap is a by-product of placing
plates loosely rather than something worth chasing.

### The end of a round

When the round ends its score is worked out and **shown**, target by target: each row lists the tiles
that actually matched, times what they are worth, and the rows add to the round's total. A round that
announced only a number would be asking to be trusted, and would teach nothing about which targets are
worth chasing.

Then the score is banked and the next round is announced — a **Round** card, then **Turn 1** — with the
new supply dealt behind the card. After the last round the same panel becomes the end of the game and
shows the final total.

What carries over:

- the **drawer**, in full. Tiles nobody could pay for are still yours next round, which is most of why
  a drawer accumulates awkward tiles at all;
- the **board**, of course, which is what later rounds score against;
- the **banked scores**, which simply add.

What resets: the round's **plate supply**, so the new round deals its own — and the **shared source**,
which is swept into the discard piles. See [The discard pile](#the-discard-pile-and-reshuffling).

> Not yet decided: whether the banked round scores and the final score below simply add.

## Final scoring (Azul-style, at end of stage/game)

Scored once, over the finished board, and unrelated to the round targets above. Both **same-color**
and **same-value** connected groups score. A single tile can contribute to **both** a color group and
a value group.

These are the same groups placement is judged against — see
[Groups, and the no-duplicates rule](#groups-and-the-no-duplicates-rule). A group can therefore never
contain a duplicate by the time it is scored: the placement that would have created one was refused.

- **Color group** — connected tiles of the **same color** → scores the **sum of the tiles' values**.
  - *Example:* touching green tiles 1, 2, 4 → **1 + 2 + 4 = 7 points**.
- **Value group** — connected tiles of the **same value** → scores the **sum of their values**, which
  for a value group is the same as `value × size`.
  - *Example:* three touching 3s → **3 + 3 + 3 = 9 points**.

### The two dials

**Smallest group that scores** — 2, 3 or 4, default **3**. The single biggest lever on the endgame: at
2 almost anything pays and the board fills with short runs; at 4 only deliberate building does.

**Size bonus** — extra points on top of the sum, by the group's **exact** size. One input per size
above the minimum, so choosing 3 offers bonuses for 4, 5 and 6.

The default pays **+6 for a full group** and nothing else, which makes finishing worth chasing: five
connected 1s are worth 5, and the sixth turns that into 6 + 6 = **12**. The other common shape rewards
every step up — **+3 / +5 / +7** — which is why this is a table rather than one "full group" number.

Exact size, never cumulative: under +3/+5/+7 a full group is worth 7 extra, not 15.

### Settling the drawer

Two more dials, both **on** by default, applied **once** when the game ends — never between rounds,
where tiles carry over freely.

**Fine for tiles left unplaced** — everything still in your drawer is charged at its **face value**, a
plate through its own tile. A hoarded 6 costs six times what a 1 does, which is the point: the tiles
hardest to place are the most expensive to keep, and a tile you cannot use becomes a real cost rather
than merely a wasted slot.

**Bonus for stems left over** — a point for each stem still held. The mirror of the fine, so spending a
stem you did not need is a real choice.

The end score is therefore `groups + stems held − left unplaced`, and it can go **negative**.

**Six is as large as a group can get.** No group may repeat a tile, and there are only six values and
six colours — so a full colour group is one tile of every value, and a full value group one of every
colour. "Full group" and "six tiles" are the same thing.

Both kinds therefore score by one rule — *sum the members' values* — which is why `game/groups.ts`
implements it once rather than twice.

**How it is shown.** The game ends on a **Final score** button rather than a number: the twelve
categories are counted out over a picture of the finished board, group by group, each group flying in
whole and landing beside what it scored. Then the round scores, then the total of both.

## Anchors, and earning stems

An **anchor** is a cell that can be *enclosed* by the tiles around it. Enclosing one pays out
[stems](#stems-the-jokers) — the only source of them after the opening allowance.

### Internal anchors

A plate's **centre hole** is its internal anchor. The hole is never fillable and has exactly six petals
around it, so it is enclosed when **all six petals hold a tile**.

It is drawn in the hole of every revealed plate: a dark emblem while the plate is incomplete, a lit one
once it is enclosed. Enclosure is a fact about the board rather than a flag, so the emblem lights up
the moment a provisional placement completes the plate and goes dark again if that placement is
cancelled — but the **stems are only paid when the placement is**, and only once per plate ever.

The award is `stemsPerInternalAnchor`, a setting (1–4, default **3**).

**A strict enclosure is worth more.** Walk the six petals as a ring, checking each neighbouring pair:
if *every* pair shares a colour or a value — including the pair that wraps from the last back to the
first — the enclosure pays `strictEnclosureBonus` on top (0 or 1, default **1**). With the defaults,
an ordinary enclosure is worth 3 stems and a strict one 4.

That bonus **does not exist under the strict placement rule**, and the setting is hidden there. Strict
placement already guarantees a connected ring: of any adjacent pair, whichever tile went down second
had to agree with every neighbour it found, including the first. The bonus would be the base rate
under another name.

**A placement that would earn stems it cannot hold is illegal** — counting the bonus, so a ring that is
about to close strictly reserves room for all four. Stems live in drawer slots, and a
reward with nowhere to go would either vanish or overflow, so the move is refused before it happens
rather than half-honoured afterwards. The slot the placed tile vacates counts as free — it is emptied
by the very move being judged.

### External anchors

A **bare cell that no plate covers, with all six of its neighbours covered**, is an external anchor.

These exist because plates need only *connect*, not interlock — a plate placed off the flower
sublattice can wrap a gap. On a perfectly tessellated board there are none at all, which is worth
knowing: settling open question 10 the other way would remove this half of the mechanic entirely.

They are found when a plate is placed, by checking the twelve cells ringing its flower. Nothing further
out can matter: a cell needs six covered neighbours, so only cells touching the new plate can have just
become one.

The award is `stemsPerExternalAnchor` (1–4, default **2**), and it takes the strict bonus on the same
terms as an internal one.

An external anchor is drawn on a dark hex of its own, since there is no plate beneath it, and its
emblem is **tinted** apart from the internal one's warm brass — they pay different amounts, so they
have to be distinguishable at a glance.

### One rule for both

Beyond where they come from, the two kinds behave identically:

- **Enclosed** when all six cells around the anchor hold a tile.
- **Pays** the rate for its kind, plus the strict bonus if the ring of six is connected pair-to-pair.
- **Pays once**, ever.

Which means the check runs the same way whatever the move: place something, look at every anchor it
could have closed, and pay for each that closed. **One move can close several at once** — a tile sits
beside up to six anchors, and a plate can create an external anchor *and* fill its last neighbour in
the same action. The legality check counts them all together, so a move whose combined payout would
overflow the drawer is refused rather than half-honoured.

### Anchor points, paid every round

Stems are the reward for **closing** an anchor. These are the reward for **having** one, and the two
are deliberately different questions.

**Points per internal anchor** — 0, 1 or 2, default **1**. Every plate on the board has exactly one
hole, so this is what another plate is worth, every round, for the rest of the game. A plate laid in
round 1 of a four-round game pays four times; one laid in the last round pays once.

**Points per external anchor** — 0, 1 or 2, default **0**. A bare cell the plates have wrapped. Off by
default because it is a by-product of laying plates loosely rather than something worth chasing, and
paying for it every round would make an accident the best strategy in the game.

They exist because everything else on the board pays for *tiles*, which makes one plate worked to
death the obvious line. An anchor arrives with a plate and is banked again at the end of every round,
which is what makes building **wide** worth a turn — and what makes an early plate worth more than a
late one, without any rule having to say so.

Counted for every anchor that exists, enclosed or not. Enclosing one is a feat and pays stems; having
one is a decision about the shape of the board, and pays points.

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

These are **deliberately unresolved**. Drafting and payment are now implemented; scoring is not, so
none of these block current work. The rules module must leave room for them rather than answer them.

1. ~~**Payment** — is the drawer the only source? Can plates be spent, or only tiles?~~ **Resolved** —
   see [Payment](#payment-azul-style). The drawer is the only source; plates may be spent and pay as
   their own token. Still open: whether the placed item's own tile counts toward anything in scoring.
2. **Value-group scoring** — exact formula. The "no duplicate colour" half is now settled: both groups
   are checked for duplicates at placement time.
3. ~~**Rule enforcement** — is a no-duplicate violation an *illegal placement* or a *legal but
   non-scoring* one?~~ **Resolved — illegal.** It is a hard gate: the model refuses the move and the
   drop marker turns red. See [Groups, and the no-duplicates rule](#groups-and-the-no-duplicates-rule).
4. ~~**Shared source** — when does it refill?~~ **Resolved.** Composition (36 plates, 108 tiles by
   default, now a settings dial) and
   shape (lots of a face-down plate under four loose tiles) were already settled; the timing now is
   too. Lots fill **progressively**, one per turn once the top lot has been touched, up to the round's
   quota — see [When the source restocks](#when-the-source-restocks) — and the column is swept at the
   end of the round.
5. ~~**Drawer cap** — is 16 a rule or only the mockup's layout?~~ **Resolved — a rule, and a dial.**
   Tile slots are 10, 12, 14 or 16 and default to 12; bays are 1–3 and default to 2. See
   [Drawer size](#drawer-size).
6. **Stages** — how many. What *resets* is now settled: the **drawer carries over** with its
   unaffordable tiles, the board and the banked scores carry over, and the **shared source is swept to
   the discard piles**. Only the number of stages, and whether a stage is more than a round, is open.
7. ~~**Jokers** — what they do and how they are spent.~~ **Resolved** — they are
   [stems](#stems-the-jokers), and they are spent as wild payment. See question 15 for how they are
   earned, which is still open.
8. **Bonuses and goals** — the mockup shows per-goal bonuses ("complete all goals before the
   opponent"), but the goal system itself is not designed yet.
9. **Puzzles mode** — fixed *sequence* or fixed *pool*?
10. **Plate placement freedom** — half resolved, and now load-bearing: external anchors only exist
    *because* plates may sit off-lattice and wrap a gap, so snapping them to the sublattice would
    delete that half of the stem economy. Plates **must touch** an existing plate; see
    [The connection rule](#the-connection-rule). Still open: whether they must also **snap to the flower
    sublattice** (generated by `(1,2)` and `(3,-1)`, so the board tessellates and no cell is stranded).
    Today 18 holes are legal around a plate, of which only 6 interlock; the other 12 connect but leave
    gaps, and gaps are what strand cells.
11. ~~**Pass** — always available, or only when no other action is legal?~~ **Resolved — always.**
    Passing ends your round rather than skipping a turn, and choosing to stop early is a real decision
    the game should not make for you.
14. ~~**Spending a stem** — what does a stem buy when placing a tile?~~ **Resolved** — a stem is a wild
    payer: it counts as one item toward the price, matches nothing, and is exempt from the equal-items
    rule. Any number may be used in one payment. See [Payment](#payment-azul-style).
15. ~~**Earning stems** — beyond the opening allowance, how are they awarded?~~ **Resolved** —
    enclosing an anchor of either kind; see [Anchors](#anchors-and-earning-stems).
16. **What "strict" means with mixed neighbours** — under the strict placement rule, each neighbour is
    currently judged on its own, so one may agree by colour and another by value. Should a *single*
    attribute have to satisfy all of them instead, as it does for drafting and payment? Only affects
    positions where neighbours agree on different attributes. See
    [The neighbour rule](#the-neighbour-rule).
12. **Drafting a face-down plate** — a plate's color and symbol are hidden in the source, so it cannot
    be matched against a draft criterion. Does drafting a color/symbol also sweep plates whose hidden
    tile matches (revealed on take)? Or are plates taken by a separate action? Currently plates are
    not draftable at all.
13. ~~**Does payment survive?**~~ **Resolved — yes.** Placing costs (L − 1) items and is confirmed in a
    second step; the action list is draft / place / pass, where *place* means place-and-pay.

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
