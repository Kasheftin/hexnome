# hexnome — Task List / Roadmap

Build order. Rules: [game-design.md](game-design.md). Architecture:
[tech-spec.md](tech-spec.md). Assets: [art-spec.md](art-spec.md).

## Prior attempts — closed

Two earlier prototypes, both abandoned before shipping:

- **Unity** — hex grid, drag-and-drop of single tiles, orthographic top-down camera, endless
  honeycomb. Validated grid maths and interaction. No plates, drafting, payment, or scoring.
- **Godot** — 2D port of the same slice, for a developer-experience comparison.

Neither is carried forward. What survives is the design thinking, the mockup, and the symbol set.

## Stage 1 — graphics vertical slice ← current

**Goal: the board looks and feels right.** Thick glossy tiles on a hex grid, in the ornate frame,
picked up and placed with satisfying feedback. Rules beyond placement legality are out of scope, and
so is everything server-side.

**Done when:** you can drag a tile from the drawer onto a legal petal on a 3D board, it lands with
weight, it looks like `screen1.png` rendered in real 3D — and it is worth looking at for a minute
without touching anything.

### 1.1 Scaffold

- [ ] `frontend/` — Vite + Vue 3 + TypeScript strict, Pinia, Vue Router.
- [ ] TresJS (`@tresjs/core`, `@tresjs/cientos`); confirm a `<TresCanvas>` renders a lit box.
- [ ] Vitest wired and running.
- [ ] ESLint with the `game/`-may-not-import-`vue`-or-`three` rule
      ([tech-spec.md](tech-spec.md#the-one-hard-architectural-rule)). Add it now — retrofitting it
      after the imports creep in means untangling them.
- [ ] `git init`, first commit.

### 1.2 Rules module — only what the slice needs

Pure TypeScript, unit-tested, no framework imports.

- [ ] `hex.ts` — axial coords, six neighbours, axial ↔ world (XZ), world → nearest cell (fractional
      rounding), plus tests.
- [ ] `plateGrid.ts` — the index-7 flower sublattice, both directions, and plate-slot neighbours.
      **Test this hardest**; an error is invisible in the data and unmistakable on screen.
- [ ] `tile.ts`, `plate.ts` — `Tile { color, value }`, flower footprint with petal occupancy.
- [ ] `board.ts` — placed plates and tiles; validate tile placement (empty petal of a placed plate)
      and plate placement (edge-to-edge with an existing plate).
- [ ] Starting position: one plate at centre holding a value-1 tile.

Deliberately absent: drafting, payment, scoring, groups, jokers, turn order.

### 1.3 The tile — the make-or-break task

Everything downstream is judged against how good a single tile looks. Get one right before rendering
many.

- [ ] Shared bevelled hex prism from `ExtrudeGeometry`, X-rotation baked in.
- [ ] Shared `MeshPhysicalMaterial` with clearcoat; six colour clones from the palette.
- [ ] Lighting rig: `<Environment>` with `Lightformer`s, directional key light, soft shadows, ACES
      tone mapping.
- [ ] **Checkpoint: one tile, on screen, that looks like polished enamel.** Do not proceed until it
      does. Tune bevel size, roughness, clearcoat, and light placement against pixels — the spec's
      numbers are starting points, not answers.
- [ ] Symbol atlas from SVG sources + rasterising script; symbol plane above the top face, tinted.

### 1.4 Board

- [ ] Tilted orthographic camera; tune the tilt by eye.
- [ ] Pan and zoom with clamping, no orbit.
- [ ] Procedural honeycomb backdrop shader with derivative-based line width — verify it holds one pixel
      across the whole zoom range.
- [ ] Render placed plates and tiles from board state.
- [ ] Confirm on screen that petals of adjacent plates touch, and that the ~19.1° flower-lattice
      rotation looks intentional rather than broken.

### 1.5 Chrome and the three viewports

- [ ] DOM chrome laid out to match `screen1.png`: title bar, goals column, board, supply, drawer, cost
      legend. Static content is fine.
- [ ] `panel_frame.png` via CSS `border-image`; Cinzel and Inter self-hosted.
- [ ] Placeholder divs for the three 3D regions; `layout.ts` reads their rects via `ResizeObserver`.
- [ ] Scissored multi-viewport render loop through `renderer.replaceRenderFunction`, with per-region
      camera layers.
- [ ] **Decision point:** if the viewports fight TresJS, take the DOM-sprite fallback
      ([tech-spec.md](tech-spec.md#three-viewports-one-webgl-context)) and record why. Do not spend
      days here — the slice's purpose is the board.

### 1.6 Interaction

- [ ] Ray-plane picking → fractional axial → nearest cell.
- [ ] Drag state machine in `stores/drag.ts`.
- [ ] Hover feedback: ghost tile plus emissive rim on legal targets; quiet dimming on illegal ones.
- [ ] Carried tile lifts and tilts toward the drag direction.
- [ ] Drop tween: fall, small overshoot, settle, specular pulse.
- [ ] Pointer Events throughout — one code path for mouse, pen, and touch.

### 1.7 Polish and measure

- [ ] Measure against the budget: 60fps at 1440p, ~300 tiles. Record the actual number.
- [ ] Only if it misses, walk the escalation ladder
      ([tech-spec.md](tech-spec.md#performance)) and record what was measured at each step.
- [ ] Evaluate `renderMode: 'on-demand'` against the replaced render function.
- [ ] Check a 1280×720 laptop screen and a tablet in landscape. Phone portrait is not a Stage 1 target.

## Stage 2 — the game

Needs the open rules questions answered first ([game-design.md](game-design.md#open-questions)) —
several of them, particularly whether illegal placements are blocked or merely non-scoring, change the
UI and not just the rules.

- [ ] Shared source and per-player drawer; drafting by colour or value.
- [ ] Payment.
- [ ] Scoring: connected colour and value groups, with the duplicate constraints.
- [ ] Turn structure, end condition, score presentation.
- [ ] Goals and bonuses, once designed.
- [ ] Jokers and stages, once specified.
- [ ] Hot-seat multiplayer — two seats, one browser. Exercises the full rule set with no backend.
- [ ] Puzzle mode: fixed set, score, local highscore.

## Stage 3 — backend and online

- [ ] `backend/` — Nest.js, REST, OpenAPI from `@nestjs/swagger`.
- [ ] Extract the rules module so backend and frontend share one copy; server validates every move.
- [ ] Generated typed client into `frontend/src/api/generated/`.
- [ ] Google SSO end to end: GIS ID token → verified server-side → session JWT. Swap
      `GuestAuthService` for `GoogleAuthService`.
- [ ] Lobbies: create, list, join, leave. Sessions with reconnect.
- [ ] socket.io gateway for live turn and shared-source updates.
- [ ] Global leaderboard for puzzle mode.
- [ ] Playwright E2E over the real flows.

## Stage 4 — release

- [ ] Tutorial.
- [ ] Sound.
- [ ] hexnome.com: register, deploy the SPA to a CDN, deploy the API.
- [ ] Asset licences audited and recorded.
- [ ] Accessibility pass: keyboard placement as an alternative to dragging, colour-blind-safe palette
      check. The tiles encode information in colour *and* symbol, which helps, but the palette still
      needs verifying.

## Verification

- **Rules:** `npm test` in `frontend/`, green. Every rule that exists has a test.
- **Visuals:** judged by eye against `screen1.png` and the intent in [art-spec.md](art-spec.md). No
  screenshot regression tests while the look is still moving.
- **Performance:** measured, with the number written down — not "feels smooth".
