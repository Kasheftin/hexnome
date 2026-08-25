<script setup lang="ts">
/**
 * A game that could not be opened, said in a sentence.
 *
 * The two ways to get here are a link to a game that is not there and a server that is not
 * answering, and they want different things of the reader: one is over, the other is worth trying
 * again. So the retry is offered whenever the server said *nothing* — a status of 0 from
 * `api/games.ts` — and withheld when it answered plainly.
 *
 * The menu's lockup, deliberately: this is still the same app, and a failure that redecorates the
 * page reads as a crash rather than as an answer.
 */
defineProps<{
  message: string
  /** False for a game that genuinely is not there — there is nothing to try again. */
  retryable?: boolean
}>()

const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <main class="page">
    <div class="lockup">
      <h1>hexnome</h1>
      <p class="tagline">
        Build · Adapt · Evolve
      </p>
    </div>

    <section
      class="panel"
      aria-label="Cannot open this game"
    >
      <p class="what">
        {{ message }}
      </p>
      <div class="ways">
        <button
          v-if="retryable"
          type="button"
          class="option"
          @click="emit('retry')"
        >
          <span class="option-label">Try again</span>
        </button>
        <RouterLink
          to="/"
          class="option"
        >
          <span class="option-label">Back to menu</span>
        </RouterLink>
      </div>
    </section>
  </main>
</template>

<style scoped>
/* The menu's two-column lockup — see LobbyView for why the rules are copied rather than shared. */
.page {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 64px;
  align-items: center;
  justify-content: center;
  height: 100%;
  max-width: 940px;
  margin: 0 auto;
  padding: 32px;
}

@media (width <= 760px) {
  .page {
    grid-template-columns: minmax(0, 1fr);
    gap: 32px;
    align-content: center;
  }
}

h1 {
  margin: 0;
  color: #e8c878;
  font-weight: 600;
  /*
   * The game lockup: display type, outside the text scale in styles/main.css.
   *
   * It has to opt out of the base **line height** as well as the size. That line height is absolute
   * (1.5rem), so it does not grow with the font — inheriting it put 52px capitals in a 24px box and
   * pulled the tagline up under them. An exception is only an exception if it declines both.
   */
  font-size: clamp(34px, 6vw, 52px);
  line-height: normal;
  text-transform: uppercase;
}

.tagline {
  margin: 6px 0 0;
  color: #6b7382;
  font-size: var(--text-base);
  line-height: var(--text-base-line);
  text-transform: uppercase;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 22px;
  border: 1px solid #3a3222;
  border-radius: 4px;
  background: rgb(21 23 28 / 82%);
  box-shadow: 0 2px 24px rgb(0 0 0 / 45%);
}

.what {
  margin: 0;
  color: #cfd4de;
  font-size: var(--text-base);
  line-height: var(--text-base-line);
}

.ways {
  display: flex;
  gap: 10px;
}

.option {
  flex: 1 1 auto;
  padding: 12px 14px;
  border: 1px solid #33383f;
  border-radius: 3px;
  background: transparent;
  color: #cfd4de;
  font: inherit;
  text-align: center;
  cursor: pointer;
  transition: border-color 140ms, background-color 140ms, color 140ms;
}

.option:first-child {
  border-color: #7d6a41;
  color: #e8c878;
}

.option:hover {
  background: rgb(232 200 120 / 14%);
}

.option-label {
  font-size: var(--text-base);
  line-height: var(--text-base-line);
  text-transform: uppercase;
}

.option:focus-visible {
  outline: 2px solid #8fe6c0;
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .option {
    transition: none;
  }
}
</style>
