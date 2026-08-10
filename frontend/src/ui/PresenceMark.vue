<script setup lang="ts">
/**
 * Whether the server has heard from a seat lately, as a mark beside their name.
 *
 * **Two shapes, not two colours of one shape.** A green dot and a red dot are the same mark to a
 * colour-blind player, to a greyscale screenshot and to anyone glancing past. `mdiCircle` and
 * `mdiAlert` are told apart by outline alone, and the colour is then only reinforcement.
 *
 * The word goes with it, out of sight. A coloured shape says nothing at all to a screen reader, and
 * this is the one thing on the seat list that is not already written out.
 *
 * ## What it does not mean
 *
 * Not "playing" and not "connected". It means the server heard from this seat within a minute and a
 * half — see `backend/src/games/presence.service.ts`, which explains why that number and not a
 * tighter one. So a player who is there always shows present, and one who has just closed the tab
 * goes on showing present for a while yet. Erring that way is deliberate: *away* should mean gone.
 */
import { mdiAlert, mdiCircle } from '@mdi/js'

defineProps<{
  online: boolean
  /** Whose presence it is, for the word only a screen reader hears. */
  name: string
}>()
</script>

<template>
  <span
    class="mark"
    :class="{ away: !online }"
  >
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path :d="online ? mdiCircle : mdiAlert" />
    </svg>
    <span class="sr-only">{{ online ? `${name} is here` : `${name} has not been heard from` }}</span>
  </span>
</template>

<style scoped>
.mark {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  /* The palette's green, as used for anything the game is happy about. */
  color: #8fe6c0;
}

/* The same red the board turns for a refused drop — one red in the app, not two. */
.mark.away {
  color: #ff4d3d;
}

.mark svg {
  display: block;
  width: 11px;
  height: 11px;
  fill: currentcolor;
}

/* A filled disc is a heavier mark than an outlined triangle, so it is drawn a size down to match. */
.mark:not(.away) svg {
  width: 8px;
  height: 8px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
