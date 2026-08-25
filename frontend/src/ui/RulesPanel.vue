<script setup lang="ts">
/**
 * The rulebook, read in a panel.
 *
 * The rules are a markdown file in this repository (`content/rules.md`), rendered here. Keeping them
 * as prose rather than as components means the person changing a rule edits a sentence, and the one
 * place that has to know a rule exists is the file that states it — which is the failure the design
 * doc demonstrated by quietly losing five of them.
 *
 * ## Both the text and the renderer arrive on the first press
 *
 * `rulesDocument` — and through it `marked`, which is the bulk of it — and the document itself are
 * both behind dynamic imports, so a player who never opens the rules never downloads either. The
 * type import above is erased at compile time and pulls nothing with it.
 *
 * Deliberately the *module* rather than the component: making `RulesPanel` itself async would mean
 * not rendering it until it is wanted, since Vue fetches an async component as soon as it appears in
 * a template, and this one is always there with an `open` prop. Lazy-loading what is heavy is
 * simpler than arranging for the wrapper not to exist. The panel shows a line while it is in flight,
 * which on any real connection is one frame.
 *
 * ## Two columns, and one source for both
 *
 * The rail is built from the document's own `##` headings, and the headings are rendered with the
 * matching ids — see `rulesDocument`. Nothing lists the sections; adding one to the markdown adds it
 * here. Which entry is lit follows an `IntersectionObserver` over the headings rather than a scroll
 * handler, so it costs nothing while the panel is still.
 */
import { nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { RulesSection } from './rulesDocument'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const panel = ref<HTMLElement | null>(null)
const body = ref<HTMLElement | null>(null)
const html = shallowRef('')
const sections = shallowRef<readonly RulesSection[]>([])
const here = ref('')
const failed = ref(false)

let watching: IntersectionObserver | null = null

/**
 * How far below the top of the reading area a heading counts as passed.
 *
 * Without it a heading resting exactly on the edge flickers between two answers as the browser
 * rounds its position.
 */
const SPY_MARGIN = 12

/** Fetched once and kept: the rules do not change while the tab is open. */
async function load(): Promise<void> {
  if (html.value || failed.value) return
  try {
    const [{ renderRules, sectionsOf }, { default: text }] = await Promise.all([
      import('./rulesDocument'),
      import('@/content/rules.md?raw'),
    ])
    sections.value = sectionsOf(text)
    here.value = sections.value[0]?.slug ?? ''
    html.value = renderRules(text)
  } catch {
    // The document ships in the bundle, so this is a chunk that would not load — an offline reload
    // against a stale service worker, or a deploy mid-session. Saying so beats an empty panel.
    failed.value = true
  }
}

/**
 * Follow the reader down the page.
 *
 * **The observer is a trigger, not the answer.** Asking it which heading is intersecting sounds
 * right and is not: between two far-apart headings none of them is, so the rail keeps whatever it
 * last saw and sticks — three sections went by under "The shared source" before this was measured.
 * So a crossing merely prompts a rescan, and the answer is the last heading at or above the top of
 * the reading area, which is the one whose section the reader is inside.
 *
 * Rebuilt whenever the document is rendered, because the headings are new elements each time.
 */
function watchHeadings(): void {
  watching?.disconnect()
  const root = body.value
  if (!root) return

  const headings = [...root.querySelectorAll<HTMLElement>('h2[id]')]
  if (headings.length === 0) return

  const settle = (): void => {
    const top = root.getBoundingClientRect().top + SPY_MARGIN
    const passed = headings.filter(heading => heading.getBoundingClientRect().top <= top)
    here.value = (passed.at(-1) ?? headings[0])?.id ?? ''
  }

  watching = new IntersectionObserver(settle, { root })
  for (const heading of headings) watching.observe(heading)
  settle()
}

function goTo(slug: string): void {
  here.value = slug
  body.value?.querySelector(`#${CSS.escape(slug)}`)?.scrollIntoView({ block: 'start' })
}

watch(() => props.open, async (open) => {
  if (!open) {
    watching?.disconnect()
    watching = null
    return
  }
  await load()
  await nextTick()
  panel.value?.focus()
  watchHeadings()
})

onBeforeUnmount(() => watching?.disconnect())
</script>

<template>
  <Transition name="rules">
    <div
      v-if="open"
      class="backdrop"
      @click.self="emit('close')"
      @keydown.esc="emit('close')"
    >
      <section
        ref="panel"
        class="panel"
        role="dialog"
        aria-modal="true"
        aria-label="Game rules"
        tabindex="-1"
      >
        <header class="head">
          <h2>Game rules</h2>
          <button
            type="button"
            class="close"
            aria-label="Close the rules"
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

        <div class="columns">
          <!-- Every entry the document offers, in its own order. -->
          <nav
            v-if="sections.length"
            class="rail"
            aria-label="Sections"
          >
            <button
              v-for="section in sections"
              :key="section.slug"
              type="button"
              class="rail-entry"
              :class="{ here: section.slug === here }"
              @click="goTo(section.slug)"
            >
              {{ section.title }}
            </button>
          </nav>

          <div
            ref="body"
            class="body"
          >
            <p v-if="failed">
              The rules could not be loaded. Reloading the page should fix it.
            </p>
            <!--
              Our own markdown, compiled into this bundle by Vite. Sanitising it would be sanitising
              this repository's own source; the reasoning, and what would have to change if the rules
              ever came from anywhere else, is on `renderRules`.
            -->
            <!-- eslint-disable vue/no-v-html -->
            <article
              v-else-if="html"
              class="prose"
              v-html="html"
            />
            <!-- eslint-enable vue/no-v-html -->
            <p v-else>
              Opening the rules…
            </p>
          </div>
        </div>
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

/* Wider than the settings flyout, which holds a column of dials. This holds prose and pictures. */
.panel {
  display: flex;
  flex-direction: column;
  width: min(920px, 100%);
  max-height: min(88vh, 820px);
  overflow: hidden;
  border: 1px solid #3a3222;
  border-radius: 4px;
  background: rgb(21 23 28 / 97%);
  box-shadow: 0 8px 40px rgb(0 0 0 / 60%);
}

.panel:focus-visible {
  outline: 2px solid #8fe6c0;
  outline-offset: -2px;
}

.head {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  padding: 16px 22px;
  border-bottom: 1px solid #2a2c33;
}

.head h2 {
  margin: 0;
  color: #e8c878;
  font-weight: 600;
  font-size: var(--text-base);
  line-height: var(--text-base-line);
  text-transform: uppercase;
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

.columns {
  display: flex;
  min-height: 0;
  /* The rail scrolls with nothing; only the prose does. */
  align-items: stretch;
}

.rail {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 1px;
  width: 208px;
  padding: 14px 10px 20px;
  overflow-y: auto;
  border-right: 1px solid #2a2c33;
}

.rail-entry {
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: #79808f;
  font: inherit;
  font-size: var(--text-base);
  line-height: var(--text-base-line);
  text-align: left;
  cursor: pointer;
  transition: color 140ms, background-color 140ms;
}

.rail-entry:hover {
  color: #cfd4de;
}

.rail-entry.here {
  background: rgb(232 200 120 / 8%);
  color: #e8c878;
}

.rail-entry:focus-visible {
  outline: 2px solid #8fe6c0;
  outline-offset: -2px;
}

.body {
  flex: 1 1 auto;
  min-width: 0;
  padding: 6px 26px 28px;
  overflow-y: auto;
  color: #cfd4de;
}

/* ── the rendered document ────────────────────────────────────────────────────── */

.prose {
  /* A measure, not a width: prose past about 80 characters a line is hard to track back. */
  max-width: 62ch;
  font-size: var(--text-base);
  line-height: var(--text-base-line);
}

.prose :deep(h1) {
  margin: 18px 0 6px;
  color: #e8c878;
  font-size: var(--text-lg);
  line-height: var(--text-lg-line);
}

.prose :deep(h2) {
  /* Clears the top edge when a rail entry scrolls one into view. */
  margin: 30px 0 10px;
  padding-top: 14px;
  border-top: 1px solid #2a2c33;
  color: #e8c878;
  font-size: var(--text-base);
  line-height: var(--text-base-line);
  scroll-margin-top: 6px;
}

.prose :deep(h3) {
  margin: 20px 0 6px;
  color: #cfd4de;
  font-size: var(--text-base);
  line-height: var(--text-base-line);
}

.prose :deep(p),
.prose :deep(ul),
.prose :deep(ol) {
  margin: 0 0 12px;
}

.prose :deep(ul),
.prose :deep(ol) {
  padding-left: 20px;
}

.prose :deep(li) {
  margin-bottom: 5px;
}

.prose :deep(strong) {
  color: #e8e4dc;
  font-weight: 600;
}

.prose :deep(em) {
  color: #cfd4de;
}

/*
 * Dense material, deliberately one step down.
 *
 * A three-column rules table is 334px wide at the base size against a 278px column on a phone — it
 * overflowed. Tables and inline code are what the small tier is *for*: they are scanned rather than
 * read, and they are the one place where fitting the width matters more than matching the body.
 */
.prose :deep(code) {
  padding: 1px 4px;
  border-radius: 2px;
  background: rgb(255 255 255 / 6%);
  color: #e8c878;
  font-size: var(--text-sm);
  line-height: var(--text-sm-line);
}

.prose :deep(a) {
  color: #8fe6c0;
}

.prose :deep(img) {
  display: block;
  max-width: 100%;
  margin: 14px 0;
  border: 1px solid #2a2c33;
  border-radius: 3px;
}

/*
 * A symbol in a table cell, shown the way the game shows it: on a tile.
 *
 * The art is dark brown on transparency — it is drawn to sit on a coloured tile face, and against
 * this panel it would be very nearly invisible. So the cell supplies the face. One warm neutral for
 * all six rather than the six tile colours, because colour and value are independent in this game and
 * a coloured-per-row table would teach a pairing that does not exist.
 */
.prose :deep(td:first-child) {
  width: 46px;
  padding: 5px 10px 5px 0;
}

.prose :deep(td:first-child img) {
  width: 36px;
  height: 45px;
  margin: 0;
  padding: 3px;
  border: 1px solid #7d6a41;
  border-radius: 3px;
  background: #c8a86d;
  object-fit: contain;
}

.prose :deep(blockquote) {
  margin: 0 0 12px;
  padding: 2px 0 2px 14px;
  border-left: 2px solid #3a3222;
  color: #9aa1ad;
}

.prose :deep(table) {
  width: 100%;
  margin: 0 0 14px;
  border-collapse: collapse;
  font-size: var(--text-sm);
  line-height: var(--text-sm-line);
}

.prose :deep(th),
.prose :deep(td) {
  padding: 6px 10px;
  border-bottom: 1px solid #2a2c33;
  text-align: left;
}

.prose :deep(th) {
  color: #79808f;
  font-weight: 500;
  text-transform: uppercase;
}

.prose :deep(hr) {
  margin: 22px 0;
  border: 0;
  border-top: 1px solid #2a2c33;
}

/*
 * Narrow: the rail goes above the prose rather than squeezing it. A 208px column against a phone
 * leaves the text about twenty characters wide, which is unreadable in a way no styling fixes.
 */
@media (width <= 700px) {
  .columns {
    flex-direction: column;
  }

  .rail {
    flex-direction: row;
    width: auto;
    overflow-x: auto;
    border-right: none;
    border-bottom: 1px solid #2a2c33;
  }

  .rail-entry {
    white-space: nowrap;
  }
}

.rules-enter-active,
.rules-leave-active {
  transition: opacity 160ms;
}

.rules-enter-from,
.rules-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .rail-entry,
  .rules-enter-active,
  .rules-leave-active {
    transition: none;
  }
}
</style>
