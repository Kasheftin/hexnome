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
import { computed, nextTick, ref, watch } from 'vue'
import type { GameSettings } from '@hexnome/rules/gameSettings'
import { settingRows } from './gameSettingsRows'

const props = defineProps<{
  open: boolean
  /** Null before the game has loaded, which is also when there is nothing to show. */
  settings: GameSettings | null
}>()

const emit = defineEmits<{ close: [] }>()

const panel = ref<HTMLElement | null>(null)
const rows = computed(() => (props.settings ? settingRows(props.settings) : []))

watch(() => props.open, async (open) => {
  if (!open) return
  await nextTick()
  panel.value?.focus()
})
</script>

<template>
  <Transition name="settings">
    <div
      v-if="open"
      class="backdrop"
      @click.self="emit('close')"
      @keydown.esc="emit('close')"
    >
      <section
        ref="panel"
        class="chrome-panel sheet"
        role="dialog"
        aria-modal="true"
        aria-label="This game's settings"
        tabindex="-1"
      >
        <header class="head">
          <h2 class="chrome-title">
            This game
          </h2>
          <button
            type="button"
            class="close"
            aria-label="Close the settings"
            @click="emit('close')"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </header>

        <p class="note">
          Chosen when the game was made, and fixed for its whole life. Nothing here can be changed.
        </p>

        <div class="body">
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
        </div>

        <footer class="actions">
          <button
            type="button"
            class="done"
            @click="emit('close')"
          >
            Done
          </button>
        </footer>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(4 5 8 / 62%);
  z-index: 60;
}

.sheet {
  display: flex;
  flex-direction: column;
  width: min(560px, 100%);
  max-height: min(86vh, 760px);
  overflow: hidden;
}

.head {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 8px;
}

.close {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: #79808f;
  cursor: pointer;
}

.close svg {
  width: 16px;
  height: 16px;
  fill: currentcolor;
}

.close:hover {
  border-color: #33383f;
  color: #cfd4de;
}

.note {
  flex: none;
  margin: 0;
  padding: 0 20px 12px;
  color: #79808f;
  font-size: 11px;
  line-height: 1.5;
}

.body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 0 20px 8px;
  overflow-y: auto;
}

.rows {
  width: 100%;
  border-collapse: collapse;
}

.rows th {
  padding: 8px 12px 8px 0;
  border-top: 1px solid #22252b;
  font-weight: 400;
  text-align: left;
}

.rows tr:first-child th,
.rows tr:first-child td {
  border-top: 0;
}

.name {
  display: block;
  color: #cfd4de;
  font-size: 12px;
}

.hint {
  display: block;
  margin-top: 2px;
  color: #6b7382;
  font-size: 11px;
  line-height: 1.45;
}

.value {
  padding: 8px 0;
  border-top: 1px solid #22252b;
  color: #e8c878;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  text-align: right;
  vertical-align: top;
  white-space: nowrap;
}

.actions {
  flex: none;
  padding: 12px 20px 18px;
  border-top: 1px solid #2a2c33;
}

.done {
  display: block;
  width: 100%;
  padding: 9px 16px;
  border: 1px solid #7d6a41;
  border-radius: 3px;
  background: transparent;
  color: #e8c878;
  font: inherit;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
  transition: border-color 140ms, background-color 140ms;
}

.done:hover {
  border-color: #e8c878;
  background: rgb(232 200 120 / 8%);
}

.done:focus-visible,
.sheet:focus-visible {
  outline: 2px solid #8fe6c0;
  outline-offset: 2px;
}

.settings-enter-active,
.settings-leave-active {
  transition: opacity 140ms;
}

.settings-enter-from,
.settings-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .done,
  .settings-enter-active,
  .settings-leave-active {
    transition: none;
  }
}
</style>
