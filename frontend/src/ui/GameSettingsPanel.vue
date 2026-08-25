<script setup lang="ts">
/**
 * What this game was set up with, read-only.
 *
 * A game's settings are frozen against its id the moment it is created, so there is nothing here to
 * change — and that is the point of the panel. Mid-game the question is not "what would I like" but
 * "what am I playing", which the setup screen cannot answer because by then it is showing whatever
 * the *next* game would be.
 *
 * The names and explanations are the setup screen's, through `dialText`; the values are this game's,
 * through `settingRows`. Neither is written here, so this panel cannot describe a game it is not
 * looking at, or explain a dial differently from the screen that sets it.
 */
import { computed } from 'vue'
import type { GameSettings } from '@hexnome/rules/gameSettings'
import SettingsFlyout from './SettingsFlyout.vue'
import { settingRows } from './gameSettingsRows'

/**
 * **The shell is `SettingsFlyout`**, the same one the setup screen opens.
 *
 * Two panels that are a header, a scrolling body and a pinned Done should not be two implementations
 * of that — they sit one keypress apart in the same game, and the pair that drifts is the pair nobody
 * is looking at. Everything this file used to draw for itself — the scrim, the frame, the title row,
 * the close button, Escape, the focus trap, the transition — belongs to the shell.
 *
 * Wider than the shell's default: this is a two-column table whose explanations need room, not a
 * stack of dials.
 */
const WIDTH = 560

const props = defineProps<{
  open: boolean
  /** Null before the game has loaded, which is also when there is nothing to show. */
  settings: GameSettings | null
}>()

const emit = defineEmits<{ close: [] }>()

const rows = computed(() => (props.settings ? settingRows(props.settings) : []))
</script>

<template>
  <SettingsFlyout
    :open="open"
    :width="WIDTH"
    title="This game"
    @close="emit('close')"
  >
    <p class="note">
      Chosen when the game was made, and fixed for its whole life. Nothing here can be changed.
    </p>

    <table class="rows">
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.key"
        >
          <!--
            The explanation sits under the name rather than in a third column: at this width a
            three-line sentence beside a two-word label leaves both hard to read.
          -->
          <th scope="row">
            <span class="name">{{ row.label }}</span>
            <span
              v-if="row.hint"
              class="hint"
            >{{ row.hint }}</span>
          </th>
          <td class="value">
            {{ row.value }}
          </td>
        </tr>
      </tbody>
    </table>
  </SettingsFlyout>
</template>

<style scoped>
/* The shell's body pads itself, so this only needs the gap to the table below it. */
.note {
  margin: 0 0 12px;
  color: rgb(var(--v-theme-muted));
  font-size: var(--text-base);
  line-height: var(--text-base-line);
}

.rows {
  width: 100%;
  border-collapse: collapse;
}

.rows th {
  padding: 8px 12px 8px 0;
  border-top: 1px solid rgb(var(--v-theme-surface-bright));
  font-weight: 400;
  text-align: left;
}

.rows tr:first-child th,
.rows tr:first-child td {
  border-top: 0;
}

.name {
  display: block;
  color: rgb(var(--v-theme-on-surface));
  font-size: var(--text-base);
  line-height: var(--text-base-line);
}

.hint {
  display: block;
  margin-top: 2px;
  color: rgb(var(--v-theme-muted-dim));
  font-size: var(--text-base);
  line-height: var(--text-base-line);
}

.value {
  padding: 8px 0;
  border-top: 1px solid rgb(var(--v-theme-surface-bright));
  color: rgb(var(--v-theme-primary));
  font-size: var(--text-base);
  line-height: var(--text-base-line);
  font-variant-numeric: tabular-nums;
  text-align: right;
  vertical-align: top;
  white-space: nowrap;
}

</style>
