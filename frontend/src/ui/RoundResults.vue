<script setup lang="ts">
/**
 * What a round came to, shown when it ends.
 *
 * **It shows its working.** Every target gets a row listing the tiles it actually matched, so the
 * arithmetic is visible: these tiles, times this much, equals that. A round that simply announced a
 * number would be asking the player to trust it, and would teach them nothing about which targets are
 * worth chasing — which is the whole decision the agenda panel exists to inform.
 *
 * A modal, unlike the turn card: it waits rather than passing, because it ends with a choice. The board
 * stays visible behind it, since the tiles being counted are on it.
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import type { RoundTally } from '@/game/agenda'
import { TILE_COLORS } from '@/scene/constants'
import TileChip from './TileChip.vue'

const props = defineProps<{
  round: number
  tally: RoundTally
  /** True on the last round of the game, which changes what the button offers. */
  final: boolean
  /**
   * Set once the last round has been banked: the same panel becomes the end of the game.
   *
   * The final round's working is still the most useful thing on screen at that moment, so it stays and
   * the footer changes rather than replacing one panel with another the player has to read afresh.
   */
  over: boolean
  /** Every round banked so far, for the closing total. */
  total: number
}>()

defineEmits<{ next: [] }>()

/** "all 3s" / "all indigo" — the same phrasing the action bar uses when it names a draft. */
function nameOf(row: RoundTally['rows'][number]): string {
  return row.target.kind === 'value'
    ? `all ${row.target.value}s`
    : `all ${TILE_COLORS[row.target.color]?.name.toLowerCase() ?? 'tiles'}`
}

const empty = computed(() => props.tally.total === 0)
</script>

<template>
  <div class="backdrop">
    <section
      class="chrome-panel results"
      role="dialog"
      aria-modal="true"
      :aria-label="`Round ${props.round} results`"
    >
      <h2 class="chrome-title">
        Round {{ props.round }} results
      </h2>

      <ol class="rows">
        <li
          v-for="(row, index) in props.tally.rows"
          :key="index"
          class="row"
        >
          <span class="what">{{ nameOf(row) }}</span>
          <span class="tiles">
            <TileChip
              v-for="(tile, at) in row.tiles"
              :key="at"
              :color="tile.color"
              :value="tile.value"
            />
            <span
              v-if="row.tiles.length === 0"
              class="none"
            >none</span>
          </span>
          <span class="sum">
            <span class="each">{{ row.tiles.length }} × {{ row.target.points }}</span>
            <strong>{{ row.points }}</strong>
          </span>
        </li>
      </ol>

      <p class="total">
        <span>Round total</span>
        <strong>{{ props.tally.total }}</strong>
      </p>
      <p
        v-if="empty"
        class="note"
      >
        Nothing on the board matched this round's targets.
      </p>

      <template v-if="props.over">
        <p class="grand">
          <span>Final score</span>
          <strong>{{ props.total }}</strong>
        </p>
        <p class="note">
          Group scoring — connected runs of a colour or a value — is not built yet, so this is the
          round totals only.
        </p>
        <RouterLink
          to="/"
          class="action next"
        >
          Back to menu
        </RouterLink>
      </template>
      <button
        v-else
        type="button"
        class="action next"
        @click="$emit('next')"
      >
        {{ props.final ? 'Finish the game' : 'Next round' }}
      </button>
    </section>
  </div>
</template>

<style scoped>
/*
 * A scrim, so the panel is legible over whatever the board happens to look like — and so it is obvious
 * that play has stopped. It takes pointer events: the round is over, and a stray click on the board
 * should land on nothing rather than on a tile.
 */
.backdrop {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgb(4 5 8 / 55%);
  z-index: 50;
}

.results {
  min-width: 380px;
  max-width: min(680px, 90vw);
  max-height: 86vh;
  padding: 18px 20px;
  overflow-y: auto;
  font-size: 12px;
}

.rows {
  margin: 14px 0 0;
  padding: 0;
  list-style: none;
}

.row {
  display: grid;
  grid-template-columns: 92px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 8px 0;
  border-top: 1px solid #2a2c33;
}

.what {
  color: #79808f;
  letter-spacing: 0.04em;
}

/* Wraps, because a colour target late in a game can match a great many tiles. */
.tiles {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  align-items: center;
}

.none {
  color: #4d535e;
  font-style: italic;
}

.sum {
  display: flex;
  gap: 10px;
  align-items: baseline;
  justify-content: flex-end;
}

.each {
  color: #6b7382;
  font-variant-numeric: tabular-nums;
}

.sum strong {
  min-width: 28px;
  color: #cfd4de;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.total {
  display: flex;
  justify-content: space-between;
  margin: 0;
  padding-top: 12px;
  border-top: 1px solid #3a3222;
  color: #79808f;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.total strong {
  color: #e8c878;
  font-size: 18px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.note {
  margin: 8px 0 0;
  color: #6b7382;
  font-size: 11px;
}

.grand {
  display: flex;
  justify-content: space-between;
  margin: 10px 0 0;
  padding-top: 10px;
  border-top: 1px solid #3a3222;
  color: #79808f;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.grand strong {
  color: #8fe6c0;
  font-size: 22px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.next {
  display: block;
  margin-top: 16px;
  text-align: center;
  text-decoration: none;
  padding: 9px 16px;
  width: 100%;
  border: 1px solid #4a6b58;
  border-radius: 3px;
  background: transparent;
  color: #8fe6c0;
  font: inherit;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
  transition: border-color 140ms, background-color 140ms;
}

.next:hover {
  border-color: #8fe6c0;
  background: rgb(143 230 192 / 8%);
}

.next:focus-visible {
  outline: 2px solid #8fe6c0;
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .next {
    transition: none;
  }
}
</style>
