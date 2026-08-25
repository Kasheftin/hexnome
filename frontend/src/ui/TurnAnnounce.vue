<script setup lang="ts">
/**
 * The announcement card: "TURN 4" or "ROUND 2", big, in the middle of the screen, between one and the
 * next.
 *
 * A turn used to end invisibly. Confirming a draft moved the tiles, bumped the counter in the header
 * and reset the bar all on the same frame, which read as one continuous fidget rather than as *my turn
 * ended and another began*. The header still says which turn it is, but a number that changes in the
 * corner is a fact, not a beat.
 *
 * So the transition is given time of its own, and the table is restocked **during** it: the card comes
 * up, the new lot arrives behind it, the card leaves. What was an instantaneous swap becomes something
 * you watch happen.
 *
 * DOM rather than in-scene, like the rest of the chrome — it is large text, and text belongs where it
 * can be crisp and read aloud. `pointer-events: none` throughout: it is an announcement, never a
 * dialog, and it must not eat a click that lands as it fades.
 */
const props = defineProps<{
  /**
   * What to announce, or null when play is live and nothing should show.
   *
   * A round and a turn are the same card with a different word — the beat is what carries the meaning,
   * and giving a new round its own kind of card would say it is a different sort of event when it is
   * the same one at a larger scale.
   */
  announcing: {
    readonly label: string
    readonly n: number
    /**
     * Who is about to play, or undefined in a solo game.
     *
     * The number says which turn this is; a table also needs to know whose. Omitted rather than
     * spelled out when there is one seat, where the answer is never in doubt and printing it would
     * read as the game addressing somebody else.
     */
    readonly whose?: string
  } | null
  /** False once the card should start leaving. Separate from `announcing` so the exit can be watched. */
  visible: boolean
}>()

/**
 * The card reports its own arrival and departure, and the sequence is driven by these rather than by
 * a stopwatch.
 *
 * Timers and animations disagree whenever the main thread is busy, and on the very first turn it always
 * is — the scene is compiling shaders and loading textures behind this card. A `setTimeout` chain keeps
 * counting through that; a CSS transition cannot. Measured on the page's own frame clock, the card sat
 * at zero opacity for 700ms while the timers ran ahead of it, and the action bar came back before the
 * card had visibly done anything at all.
 *
 * Anchoring on `after-enter` makes the sequence start from what actually happened rather than from a
 * stopwatch that began before the browser was listening. The rest of the sequence is timed by the owner
 * from that point, by which time the scene work is finished and clocks and animations agree again.
 */
const emit = defineEmits<{ shown: [] }>()
</script>

<template>
  <Transition
    name="announce"
    @after-enter="emit('shown')"
  >
    <div
      v-if="props.announcing !== null && props.visible"
      class="announce"
      role="status"
      aria-live="polite"
    >
      <div class="card">
        <p class="headline">
          <span class="label">{{ props.announcing.label }}</span>
          <span class="number">{{ props.announcing.n }}</span>
        </p>
        <p
          v-if="props.announcing.whose"
          class="whose"
        >
          {{ props.announcing.whose }}'s turn
        </p>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/*
 * Full-screen, so the scrim can be a radial gradient centred behind the text.
 *
 * The scrim is not decoration. The board's starting plate sits at the centre of the screen, in the same
 * brass the number is drawn in, and without it "TURN 1" was laid over a plate of near-identical colour
 * and was genuinely hard to read. A soft radial darkening fixes that while leaving the rest of the
 * board visible — which matters, because the restock is happening underneath and is meant to be seen.
 */
.announce {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
  user-select: none;
  background: radial-gradient(
    ellipse 42% 34% at 50% 50%,
    rgb(4 5 8 / 88%) 0%,
    rgb(4 5 8 / 66%) 45%,
    rgb(4 5 8 / 0%) 100%
  );
  /* Above the canvas and the drawer. The bar is hidden rather than layered under it. */
  z-index: 40;
}

/*
 * A column, because the name is a caption to the number rather than another item beside it. The
 * transitions below still take hold of `.card`, so the whole card travels as one thing.
 */
.card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin: 0;
}

.headline {
  display: flex;
  align-items: center;
  gap: 20px;
  margin: 0;
}

/*
 * Display type, deliberately outside the 12/16/20 text scale in styles/main.css — as the `h1` game
 * lockup is. This is a full-screen announcement whose whole job is to be unmissable for a moment; at
 * 20px it would read as a caption and stop announcing anything.
 */
.label {
  color: #9aa2b1;
  font-size: 32px;
  /* Opts out of the base line height too, which is absolute — see the `h1` lockup. Matches `.number`. */
  line-height: 1;
  font-weight: 500;
  text-transform: uppercase;
}

/* Tabular figures so 9 → 10 does not shift the card sideways. */
.number {
  color: #f0d79a;
  font-size: 120px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  text-shadow: 0 2px 30px rgb(0 0 0 / 90%), 0 0 4px rgb(0 0 0 / 95%);
}

/*
 * The name, not the number: sentence case, no tracking, and warm rather than grey.
 *
 * Left as it was typed. Everything else on this card is set in the chrome's small-caps, and a name put
 * through the same treatment stops looking like a person's name and starts looking like another label.
 *
 * Carries the number's shadow because it needs it for the same reason — the scrim thins toward the
 * edges, and a long name reaches into the part of it that has already faded.
 */
.whose {
  margin: 0;
  color: #d8bd8b;
  font-size: var(--text-lg);
  line-height: var(--text-lg-line);
  font-weight: 500;
  text-shadow: 0 2px 20px rgb(0 0 0 / 90%), 0 0 4px rgb(0 0 0 / 95%);
}

/*
 * The scrim fades; the text also travels. Separating them matters — a gradient that slides looks like a
 * bug, while text that merely fades does not read as getting out of the way.
 *
 * In from slightly small, out upward: the exit says the card is clearing the table for a turn that is
 * now yours.
 */
/*
 * Vue times the transition from the **root** element, so the root's own durations have to be the longest
 * ones in play. Otherwise `after-leave` fires — and the element is removed — while the card inside is
 * still travelling, and the tail of the fly-out is simply cut off.
 */
.announce-enter-active {
  transition: opacity 300ms ease-out;
}

.announce-leave-active {
  transition: opacity 400ms ease-in;
}

.announce-enter-active .card {
  transition: transform 280ms cubic-bezier(0.16, 0.9, 0.3, 1);
}

.announce-leave-active .card {
  transition: transform 380ms cubic-bezier(0.5, 0, 0.75, 0);
}

.announce-enter-from,
.announce-leave-to {
  opacity: 0;
}

.announce-enter-from .card {
  transform: scale(0.88);
}

.announce-leave-to .card {
  transform: translateY(-130%) scale(0.96);
}

@media (prefers-reduced-motion: reduce) {
  /*
   * The card still appears and still holds — the beat is the point, not the movement — but nothing
   * travels. The transitions stay non-zero so `after-enter` and `after-leave` still fire, which is what
   * the sequence is driven by.
   */
  .announce-enter-active .card,
  .announce-leave-active .card {
    transition: none;
  }

  .announce-enter-from .card,
  .announce-leave-to .card {
    transform: none;
  }
}
</style>
