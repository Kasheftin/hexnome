# Hexnome

A tile game about building a garden of hexagons, one careful placement at a time. You draft tiles
from a shared column, pay for them out of your own drawer, and lay them on plates in front of you.
Every round scores for different things, and the board you have built scores again at the end.

This describes the game as it ships. Almost every number below is a dial on the setup screen; where
one is, the default is given and the dial is named.

![Four plates laid out mid-game, their petals part-filled with coloured tiles](/rules/finished-tableau.png)

## What you are building

Your **tableau** is a sheet of **plates**. A plate is a flower: a middle cell — its **hole** — with
six **petals** around it. Petals hold tiles; the hole never does.

Every plate arrives carrying one tile of its own, welded to a petal. That tile is part of the plate
and never moves off it, but it is a tile in every other respect: it counts for scoring, and its
neighbours have a say about what goes next to it.

You start with one plate already on the board, and there is no board to speak of beyond that — plates
extend it. A plate placed on the board must **touch one already there**. The first plate is exempt,
having nothing to touch.

**Tiles have two attributes and nothing else**: a **colour** (one of six) and a **value** (1 to 6,
shown as a symbol). Almost every rule in the game is about matching one of those two.

## The symbols

A tile shows its value as a symbol rather than a number, and the six are drawn from what a genome is
made of — the game is called hexnome for a reason. Until you know them, this is the table to come
back to.

| | Value | Symbol | Why that one |
|---|------:|--------|-------------|
| ![](/textures/symbols/1.png) | 1 | DNA helix | One strand |
| ![](/textures/symbols/2.png) | 2 | Chromosome pair | Inherited in pairs |
| ![](/textures/symbols/3.png) | 3 | Codon | Exactly three nucleotides |
| ![](/textures/symbols/4.png) | 4 | DNA bases | A, C, G and T |
| ![](/textures/symbols/5.png) | 5 | Pentose sugar | A five-carbon ring |
| ![](/textures/symbols/6.png) | 6 | Benzene ring | A six-member carbon ring |

Each is shown here on the same background on purpose. Colour and value are **independent** — any
symbol turns up in any of the six colours, and a table that gave each value its own colour would
suggest a pairing the game does not have.

## A turn

On your turn you do exactly one of three things:

- **Take** — draft tiles from the shared source into your drawer.
- **Put** — place one item from your drawer onto the board, and pay for it.
- **Pass** — leave the round.

Passing is not skipping a turn. A player who passes is **out until the round ends**, and the round
ends when everybody has passed. So passing is a decision about the round, not about the moment.

![The action bar offering Take, Put and Pass](/rules/turn-bar.gif)

## The shared source

Everyone drafts from one column of **lots**. A lot is a face-down plate with 4 loose tiles heaped on
it. The column has as many slots as the round has plates — **4 plates per round** by default
(*plates/round*).

The column is a stack that grows from the top. At the start of a turn, if the **topmost** lot is no
longer full — somebody has drafted out of it — everything shifts down and a fresh lot is pushed in on
top. Only the topmost lot matters: drafting from a lower one leaves the stack alone.

A lot's plate lies **face down**, so you cannot see what tile it carries. Pick a lot clean of its
4 tiles and the plate **turns over**, and from then on it can be drafted like anything else — as
its own tile.

At the end of a round the whole column is swept away, and the next round deals fresh.

## Taking: the sweep

A draft is defined by **one attribute** and takes **every distinct tile in the source carrying it**.
You cannot take one nice tile and leave the rest.

1. Pick any tile. Its colour and its value are both still live as the criterion.
2. Pick a second, and the criterion **pins**. Two tiles that share only a colour can only be a colour
   draft, so every remaining value match goes dark.
3. **At most one of each kind.** The bag holds several copies of every tile, so the source often shows
   duplicates. Take one red-2 and any *other* red-2 goes dark — it is already represented, and it
   stays in the source.

A revealed plate counts as the tile it carries, so a red-1 plate and a red-1 tile are the same kind:
take one or the other, never both.

The take is legal as soon as one sweep is **complete**. With `indigo-6  indigo-2  magenta-2  blue-2`:

- Select **magenta-2** — the only magenta, so the colour sweep is already finished. You may take it now,
  even though two more 2s are sitting there.
- Select **magenta-2** and **blue-2** — they share only the value, so the criterion pins to value. Not
  legal yet: `indigo-2` is a 2 and is not selected.
- Add **indigo-2** — every 2 taken. Legal.

![Selecting one tile, then a second, and the rest of the source going dark as the criterion pins](/rules/draft-sweep.gif)

What you take goes into your **drawer**, which holds **12 tiles** (*tile slots*) and **2 plates**
(*plate bays*). You cannot draft more than will fit.

## Putting: where a tile may go

A tile goes onto a free petal of a plate on your board. What decides whether it may is the
**placement rule** (*placement*), and there are two:

- **Regular** (the default) — **at least one** neighbour must share the tile's colour or its value.
- **Strict** — **every** neighbour must share its colour or its value.

A cell with no filled neighbours at all takes anything: an isolated tile answers to nobody. Each
neighbour is judged on its own, so under strict one may match by colour while the next matches by
value.

A plate is judged the same way, through the tile it carries.

### Two of a kind may not meet

A **group** is a run of touching tiles that all share a colour, or all share a value. No group may
contain the same tile twice — the same colour *and* the same value.

This is a hard rule, not a scoring one: a placement that would create such a group is refused. And it
is not always the tile you are holding that duplicates. Dropping a magenta-1 between two blue-1s
duplicates neither of the things you dropped; it joins two groups that were legal apart.

![A refused placement, with the panel explaining which rule it broke](/rules/duplicate-refusal.png)

## Paying for it

Placing an item of value **V** costs **V − 1** items out of your drawer. A value-1 tile is free; a
value-6 tile costs five.

What may pay is decided by one attribute, anchored on the item you are placing:

- Every payer shares the placed item's **colour**, or every payer shares its **value**.
- **No two equal items** anywhere in the deal — that spans the placed item as well as the payment. A
  blue-3 cannot be paid for with another blue-3, and two yellow-3s cannot pay together.
- **Stems are wild**: any number of them, no matching, and they are exempt from the equal-items rule.

Because a payer sharing both attributes would be *equal* to the item, the first non-stem payer settles
the strategy outright.

A plate pays as the tile it carries, exactly as it drafts as one. Spent items leave the game.

**What you cannot pay for, you cannot place.** A drawer full of expensive tiles you can no longer
afford is a real position, and the fine at the end of the game is what it costs you.

## Stems, and the anchors that pay them

A **stem** is a wild card. It lives in a drawer slot like a tile, and its only use is as payment,
where it matches anything. You start with **3** (*starting stems*).

Stems are earned by **enclosing anchors**. An anchor is a cell that a ring of six tiles can be closed
around, and there are two kinds:

- **Internal** — a plate's own hole. Fill all six of its petals and it is enclosed.
- **External** — a bare cell with no plate under it, which the plates around it have wrapped. These
  exist because plates need not line up on a lattice; laid at an angle, they leave gaps.

Enclosing one pays **3 stems** for an internal anchor and **2** for an external one (*internal stems*,
*external stems*). If the ring of six is **strict** — every neighbouring pair in it matching — it pays
**1 more** (*strict bonus*). Under the strict placement rule every ring is strict by then, so that
bonus is earned every time — a strict game pays 4 for an internal anchor rather than 3.

An anchor pays **once**, the first time it closes.

![The sixth petal landing, closing the ring, and stems arriving in the drawer](/rules/enclosure.gif)

You can only be paid what you have room for: a placement whose reward will not fit in your drawer is
refused. The room counted is the drawer as the turn will *leave* it — the slot the tile itself vacates
and the slots its payment frees both count.

## The end of a round

A round ends when every player has passed. Then, for each player:

**The round's targets are counted.** Each round scores for a few things, and every value 1–6 and every
colour appears exactly once across the whole game — twelve targets in all.

- A **value target** pays its own number for each tile of that value on your board: every 4 pays 4.
- A **colour target** pays **1** for each tile of that colour.

Counting is over your whole board as it stands, not only what you placed this round, and a plate's own
tile counts like any other. A tile can be paid for by two targets at once.

**Anchors pay again, by the round.** Every anchor on your board pays **1** if internal and **0** if
external (*internal points*, *external points*). This is for the anchor *existing*, not for closing
it — the stems above are the reward for closing. It is what makes laying another plate worth a turn.

**The first player out pays a fine** of **1 point** (*first-pass fine*), and takes the first turn of
the next round in exchange. In a solo game there is no fine, since passing first is the only way to
pass at all.

The source column is swept, and the next round deals a fresh one.

![The round scoresheet counting itself out, target by target](/rules/round-results.gif)

## The end of the game

**Classic** is 4 rounds; **Random** is 6 (*mode*). After the last round, the board is scored once
more, differently.

**Groups score.** A group is a run of touching tiles all sharing a colour, or all sharing a value. A
group scores the **sum of its tiles' values** once it reaches **3** tiles (*min group*), plus a bonus
for its exact size — by default **6** for a group of six (*group bonus*) and nothing below that. The
bonus is for the exact size and never accumulates.

A tile belongs to a colour group *and* a value group and is paid for by both.

**Then the drawer is settled.** Everything left unplaced is charged at its **value** (*fine
unplaced*), and every stem still held pays **1** (*stem bonus*).

Your final score is every round's total, plus the closing reckoning.

![The closing sheet totalling the twelve group categories](/rules/final-score.gif)

## Playing with other people

Two to four players (*players*). Everyone builds their own tableau; the only thing shared is the
source column, which is where all the interaction lives — a sweep that takes every green also takes
the green somebody else was waiting for.

Turns go round in seat order, skipping anyone who has passed. The board you are looking at is always
your own; click a player in the scoring panel to look at theirs, and click again to come home.

A green dot beside a player means the game has heard from them in the last minute or so; a red warning
triangle means it has not, and they may have closed the tab.

## The dials

Everything on the setup screen, with its default. The game remembers what you last started, so the
setup screen opens on it; **Reset to defaults** appears whenever anything differs.

| Dial | Default | What it does |
|---|---|---|
| Players | 2 | Seats at the table. Solo is its own kind. |
| Mode | Classic | Classic and Classic reversed are 4 rounds; Random is 6. |
| Placement | Regular | Whether one neighbour must match, or all of them. |
| Plates per round | 4 | Also the height of the source column. |
| Tiles in the bag | 108 | 36 kinds, 3 copies each. |
| Plates in the bag | 36 | 36 kinds, 1 copy each. |
| Tile slots | 12 | How much your drawer holds. |
| Plate bays | 2 | How many plates you can hold. |
| Starting stems | 3 | Wild payment, in hand at the start. |
| Internal stems | 3 | Paid for enclosing a plate's hole. |
| External stems | 2 | Paid for enclosing a wrapped gap. |
| Strict bonus | 1 | Extra stem when the enclosing ring all matches. |
| Internal points | 1 | Per internal anchor, every round. |
| External points | 0 | Per external anchor, every round. |
| First-pass fine | 1 | Charged to whoever leaves the round first. |
| Min group | 3 | Smallest run that scores at the end. |
| Group bonus | 6 at size 6 | Extra points for a group's exact size. |
| Fine unplaced | Yes | Charge the value of what is left in the drawer. |
| Stem bonus | Yes | Pay 1 for each stem left over. |
