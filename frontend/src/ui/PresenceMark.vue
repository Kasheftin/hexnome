<script setup lang="ts">
/**
 * Whether the server has heard from a seat lately, as a mark beside their name.
 *
 * **Two shapes, not two colours of one shape.** A green dot and a red dot are the same mark to a
 * colour-blind player, to a greyscale screenshot and to anyone glancing past. A filled circle and a
 * warning triangle are told apart by outline alone, and the colour is then only reinforcement.
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
      viewBox="0 0 12 12"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        v-if="online"
        cx="6"
        cy="6"
        r="3.2"
      />
      <!-- A triangle with its bar and dot cut out, so the glyph reads at 12px without a second fill. -->
      <path
        v-else
        d="M6 1 11.2 10.4H0.8zM5.3 4.6h1.4l-.2 3.1H5.5zM6 8.3a.7.7 0 1 1 0 1.4.7.7 0 0 1 0-1.4z"
      />
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
  width: 10px;
  height: 10px;
  fill: currentcolor;
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
