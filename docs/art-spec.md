# hexnome — Art Spec

What art hexnome needs, in priority order, and how to produce it. Target look: `screen1.png` in
`external assets/` — dark slate and brass, ornate frames, pastel tiles — but with the tiles as real 3D
geometry instead of flat sprites.

Rendering context is in [tech-spec.md](tech-spec.md).

## What changed from the 2D version

The previous art spec's headline asset was `tile_body.png`: a grayscale hexagon with a bevel and drop
shadow baked in, tinted per colour at runtime. **That asset is obsolete and should not be generated.**

Tiles are now extruded geometry with a `MeshPhysicalMaterial`, lit by an environment map. The bevel,
the dome, the rim highlight, and the drop shadow are all produced by the renderer, from real geometry
and real lights. Baking them into a texture would fight the lighting rather than help it — a painted
highlight sits still while the real one moves with the camera and the tile.

The tint-a-grayscale-master principle still applies, just not to the tile body. It is the right
approach for **symbols** and **frames**.

## Tuning symbol size

`SYMBOL_FIT` in `scene/constants.ts` sets how much of a tile every symbol fills, as a fraction of the
tile's **apothem** — its narrow half-width, so a symbol stays clear of the flats as well as the points.
`SYMBOL_SCALE` then corrects each value 1–6 individually.

Both are meant to be eyeballed against the screen. A single fit cannot serve all six, because
`createSymbolPlane` normalises each image by its bounding-box diagonal — that equalises area, not
apparent weight, so an open motif reads smaller than a dense one at the identical fit.

`SYMBOL_OFFSET_UP` nudges each symbol vertically, in fractions of `HEX_SIZE`, **positive being up the
screen**. The motifs are symmetric left-to-right but several are not top-to-bottom, so their *optical*
centre sits off their bounding-box centre — and it is the bounding box that gets centred. Scaling cannot
fix that; it needs a nudge. As a feel for the units, `0.12` moves a symbol about 4px on a drawer-sized
tile.

Scaling never moves a symbol off centre by itself: the plane is built centred on the tile's origin and
grows about it. Worth knowing, though, that the **source art** is not perfectly centred — ink centres sit up to 2.1%
off canvas centre (worst: `3.png`, the codon). That is under a pixel at present sizes and grows with
scale, so if a symbol is pushed much larger and starts to look off, the fix is re-cropping the PNG rather
than anything in code.

| Value | Canvas | Ink centre offset |
|------:|--------|-------------------|
| 1 | 178×448 | centred |
| 2 | 302×448 | −0.7% x, −1.7% y |
| 3 | 448×435 | **+2.1% x**, −1.4% y |
| 4 | 448×442 | centred |
| 5 | 448×409 | +0.7% x, +0.2% y |
| 6 | 400×448 | +0.1% x, +0.1% y |

## Stem emblem

**File:** `frontend/public/textures/stem.png`, 448×448 — from `external assets/joker.png`.

The source is a 1024×1536 render on an **opaque** brown background, so it needed keying rather than a
straight crop. A flood fill from the corners cleared 40% of it but left a halo: the vignette right around
the emblem is too dark to fall inside any threshold that also spares the emblem's near-black outline.

Since a stem is drawn on a **round** coin, the answer was a circular mask rather than a better key —
centred on the emblem at (512, 752) with radius 380, supersampled and lightly blurred so the edge is not
jagged, then cropped square and scaled to a 448 long edge like the value symbols. What vignette survives
inside the circle reads as the coin's rim shadow.

Provisional art. Size and position on the coin are tunable without touching it, via `STEM_SYMBOL_SCALE`
and `STEM_SYMBOL_OFFSET_UP` in `scene/constants.ts`.

## Asset 0 — Plate socket art (in hand, **not used**)

**File:** `frontend/public/textures/plate-full.png` — currently one tile, from
`external assets/fullTile200x230.png`.

> **Tried twice on the plate's face, dropped twice.** The ornate brass-and-green art does not sit with
> the plain brown-cardboard slab the reverse established — it reads as a different material, not a
> different side of one piece. Plates now draw their cells procedurally on both faces
> (`PLATE_TONES`, `PLATE_CELL_*` in `scene/constants.ts`), differing only in the centre mark's colour.
>
> Kept in the repo. If ornate sockets come back, the reverse needs a matching treatment at the same
> time, or the two faces will diverge again in exactly this way.

A full-bleed pointy-top hexagon: brass ornate frame, dark mottled green face, fully transparent
corners. It dresses a plate's six **petal sockets** — the places a tile actually goes.

It began as the board cell art, tiled across all 1661 cells. That put the richest thing on screen
underneath flat grey sockets, drawing the eye to the least interesting part of the board, so the two
swapped: the board is now a bare honeycomb on dark slate and this art moved onto the petals.

**Hard requirement — the bounding box ratio.** A pointy-top hexagon of edge length 1 is `√3` wide and
`2` tall, so the image must be **`√3 : 2` = 0.86603**. For a 200 px width that is **230.94 px**, not
230 — the supplied tile is 0.4% vertically stretched, which is invisible but worth fixing at the next
export. Any tile that misses this ratio will not line up with the grid.

Other requirements:

- The hexagon fills the bounding box exactly: apex touching top and bottom edges, flat sides touching
  left and right. The renderer maps the hexagon's extent to the full 0–1 UV range
  ([tech-spec.md](tech-spec.md#plates-and-how-tiles-are-addressed)).
- **Transparent corners**, and ideally the frame colour bled a few pixels into them — the corners are
  never sampled, but bleeding costs nothing and protects against filtering at coarse mip levels.
- Lighting painted from the **upper left**, consistently across every variant. Note that plates *can*
  be rotated in sixth-turns, which turns this art with them — so the painted highlight will disagree
  with the scene's key light at four of the six rotations. Keep the shading soft and close to
  rotationally neutral; a hard directional highlight will read as wrong once a plate is turned.

**More variants are a drop-in.** Add files and list them in `PLATE_SOCKET_TEXTURE_URLS`. Note that all
six petals of a plate currently share the first entry — the per-cell hash that picked a variant belonged
to the board cells and went with them, so choosing per petal is a small change in `plateVisual.ts` if
you want the sockets to differ.

## Asset 1 — Lighting environment (for the game tiles)

Needed for the **glossy game tiles**, not the board plates — the plates are unlit, because their
lighting is painted in ([tech-spec.md](tech-spec.md#plates-and-how-tiles-are-addressed)). `clearcoat` renders what it
reflects; with an empty environment the game tiles come out flat and plastic, and no amount of material
tweaking rescues them.

**Recommended: procedural `Lightformer`s, no file at all.** cientos supports `<Lightformer>` children
inside `<Environment>` — emissive rectangles and rings placed in the scene that become the image-based
lighting. For a dark studio look this beats a downloaded HDRI on every axis that matters here: zero
bytes over the wire, and you position the specular streaks exactly where you want them on the tile
faces instead of hunting for an HDRI that happens to put them there.

A starting rig:

| Light | Shape | Purpose |
|---|---|---|
| Large soft rect, upper-left, high intensity | `rect` | The key streak along the top bevel |
| Narrow bright ring, above and behind | `ring` | A crisp specular glint that reads as glass |
| Dim wide rect, lower-right | `rect` | Fill so shadowed tile sides do not crush to black |

**Alternative:** a real dark-studio HDRI, 1k resolution, from Poly Haven (CC0). Set `background` off
and `blur` around `0.3` — the tiles should reflect soft light, not a recognisable room. Budget the
download: a 1k `.hdr` is several MB, which is a lot to spend on a free browser game's first paint.
Load it lazily after the scene is interactive if you go this way.

To get moving immediately, Three's built-in `RoomEnvironment` is procedural, ships with the library,
and is good enough to confirm the material is working. It is a scaffold, not the final look.

## Asset 2 — Value symbols (in hand)

**Files:** `frontend/public/textures/symbols/1.png` … `6.png`, prepared from
`external assets/tiles/`.

Six ornate gold-and-green motifs, one per value. Full colour with their lighting
painted in, so they are drawn on the tile by an **unlit** material — lighting them
again would multiply shading twice.

**They must be prepared before use.** The originals are 1024 × 1536 with the motif
occupying a fraction of the frame, at **2.2 MB each — 13.6 MB for six**, which is
unshippable for a free browser game. The prep step crops to the alpha bounding box
(threshold 140, plus a 6% margin), scales the long edge to 448 px, and re-encodes:
**13.6 MB → 1.3 MB**. Re-run it whenever the source art changes.

**Do not square-pad them.** Their content aspects range from 0.40 (the tall DNA
helix) to 1.09 (the pentose), so padding everything to a square would render the
helix at 40% of the width of its neighbours. Each file keeps its own aspect and the
renderer sizes the plane from `texture.image` at runtime, fitting the bounding box
inside the hexagon's inradius by diagonal — no metadata file needed, and the six read
at comparable visual weight.

Further compression is available if the budget tightens: 256 px instead of 448, or
WebP, which suits these gold gradients far better than PNG.

## Asset 3 — Symbol atlas (superseded, kept for reference)

**File:** `frontend/public/textures/symbols.png` — plus the SVG sources it is built from.

Six symbols, one per value: DNA helix (1), chromosome pair (2), codon (3), DNA bases (4), pentose (5),
benzene ring (6).

**Author as SVG, rasterise to an atlas with a script.** The SVGs are the source of truth and stay
editable; the atlas is a build artifact. Committing only a hand-assembled PNG means every symbol tweak
becomes a manual re-export, which is exactly the kind of friction that stops symbols from being
iterated on.

**Requirements**

- **White on fully transparent.** The renderer uses the atlas as an `alphaMap` and applies colour
  itself, so any colour baked in here is wrong.
- Atlas is a **3 × 2 grid of 512 × 512 cells → 1536 × 1024**, in value order 1–6, left to right then
  top to bottom.
- Each symbol occupies ~**70%** of its cell, centred, with padding so mipmapping never bleeds a
  neighbour into it.
- **Bold silhouettes, not accurate diagrams.** Uniform stroke weight, heavy enough to survive being
  drawn at 60 px on screen. The existing drafts from the ideation log are too fine and too literal.
- **The 6 must not read as a plain hexagon** — the board is made of hexagons and the tile it sits on is
  one. Keep the inner ring so the silhouette is distinct.

**Prompt, if generating rather than drawing**

> Six minimal icon silhouettes in a flat vector style, pure white on a fully transparent background,
> uniform thick stroke weight, no colour, no text, no shading. Arranged in a 3 by 2 grid, each icon
> centred in its cell with generous padding. The icons: a DNA double helix with three rungs; two chunky
> X-shaped chromosomes side by side; three connected hexagons in a row; four rounded diamonds arranged
> around a centre point; a pentagon with a dot at each vertex; a hexagon with a bold circle inside it.
> Bold board-game iconography, instantly readable at small sizes.

Silhouette check before accepting a set: shrink to 32 px, desaturate, and confirm all six are still
distinguishable from one another. If two blur together, that pair will be misread mid-game every time.

## Asset 3 — Ornate panel frame (9-patch)

**File:** `frontend/public/ui/panel_frame.png`

Used through CSS `border-image`, not as a mesh — the chrome is DOM ([tech-spec.md](tech-spec.md#ui-chrome)).

**Requirements**

- **512 × 512 px**, PNG with alpha.
- Brass and dark-bronze **bevelled border ~48 px thick**, subtle engraved filigree in the corners,
  matching `screen1.png`. Dark slate interior around `#1E2026`.
- **Corners self-contained within 64 px**, edges tileable horizontally and vertically — `border-image`
  slices at 64 px and stretches or repeats the edges, so any detail crossing a slice line will smear.
- Transparency only in the outermost margin.

**Prompt**

> An ornate rectangular UI panel frame, brass and dark bronze bevelled border with subtle engraved
> filigree in the corners, dark slate interior with a faint parchment texture, fantasy and steampunk
> board-game aesthetic. Designed as a 9-slice frame: decorative border, flat tileable edges, all
> corner detail contained within the corner squares. 512x512, PNG, transparency in the outer margin
> only. No text.

Grayscale-plus-tint does not apply here. Brass is a specific hue with a specific bevel; generate it in
colour.

## Asset 4 — Board backdrop

Behind the tiles: the faint empty honeycomb, **procedural in a fragment shader**, no asset
([tech-spec.md](tech-spec.md#board-backdrop)). A texture cannot hold a one-pixel line across the zoom
range without going soft in its mips.

The dark slate surface the honeycomb sits on can be a flat colour plus a vignette to start. If it
needs more, a subtle tileable noise or engraved-metal texture (512², grayscale, tileable) multiplied
under the grid is the cheapest upgrade.

## Asset 5 — Small UI pieces

Lower priority; placeholders are fine until the board looks right.

- **Score coin** — the brass star from the mockup. SVG, white or brass, ~64 px.
- **Buttons** — the framed "End Turn" style. Prefer CSS gradients and borders over a raster asset;
  reach for 9-patch only if CSS cannot get there.
- **Icons** — book, gear, hamburger from the title bar. Any consistent open-licence icon set.

## Typography

The mockup uses a serif display face in small caps for titles and labels. **Cinzel** (Google Fonts,
OFL) is the closest free match and carries the engraved-brass feel. Pair it with a plain, highly
legible sans for numbers and body text — **Inter** or system UI — because a display serif at 12 px in
a stat readout is a legibility problem, not a style.

Self-host both. Google's CDN is a third-party request and a privacy consideration for an EU-hosted
free game.

## Conventions

- Textures: PNG with alpha for anything masked; power-of-two dimensions so mipmapping behaves.
- Anything the renderer tints ships **white on transparent**, never pre-coloured.
- SVG is the source of truth for symbols and icons; rasterised atlases are build artifacts.
- Colour palette lives in code (`scene/materials.ts`), not in the assets. Values are in
  [tech-spec.md](tech-spec.md#material-and-palette).
- Every asset needs its licence recorded before it lands. This ships publicly and free, so CC0 or OFL
  only for anything not made in-house — no "found it in a texture pack" assets.
- If a generator cannot produce transparency, use pure magenta `#FF00FF` as the background and note it
  so it can be keyed out on import.
