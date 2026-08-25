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
import { mdiClose } from '@mdi/js'
import { nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { RulesSection } from './rulesDocument'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

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
  watchHeadings()
})

onBeforeUnmount(() => watching?.disconnect())
</script>

<template>
  <!--
    A `v-dialog`, which is what removes most of this component.
    
    The backdrop, the scrim, Escape, the focus trap, returning focus to whatever opened it and the
    enter/leave transition were all hand-written here and are all the dialog's job. What is left is
    the reading pane and its rail — the part that is actually about rules.

    `:model-value` and an emit rather than `v-model`, so the existing `open` / `close` contract with
    both call sites is untouched by the change of shell.
  -->
  <v-dialog
    :model-value="open"
    :max-width="920"
    scrollable
    aria-label="Game rules"
    @update:model-value="emit('close')"
  >
    <v-card class="hx-rules">
      <v-card-title class="hx-rules__head">
        <span class="chrome-title">Game rules</span>
        <v-spacer />
        <v-btn
          :icon="mdiClose"
          :border="false"
          variant="text"
          density="comfortable"
          aria-label="Close the rules"
          @click="emit('close')"
        />
      </v-card-title>

      <v-divider />

      <div class="hx-rules__columns">
        <!-- Every entry the document offers, in its own order. -->
        <nav
          v-if="sections.length"
          class="hx-rules__rail"
          aria-label="Sections"
        >
          <v-btn
            v-for="section in sections"
            :key="section.slug"
            :border="false"
            :active="section.slug === here"
            :color="section.slug === here ? 'primary' : 'muted'"
            variant="text"
            class="hx-rules__entry"
            @click="goTo(section.slug)"
          >
            {{ section.title }}
          </v-btn>
        </nav>

        <div
          ref="body"
          class="hx-rules__body"
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
    </v-card>
  </v-dialog>
</template>

<style lang="scss">
@use '@/styles/mixins.import' as *;

/*
 * Not `scoped`. A scoped style stamps every selector with a `[data-v-…]` attribute, which raises its
 * specificity — the one thing cascade layers exist to make irrelevant. Unscoped inside `components`,
 * a plain `.prose h2` already wins, and `` stops being needed at all: it existed only to reach
 * past the scope attribute into `v-html` output, which has no scope id of its own.
 */
@layer components {
  /*
   * What the dialog does not do.
   *
   * The backdrop, the panel's own frame, the header row, the close button and the focus ring are all
   * gone: `v-dialog` and `v-card` draw them, and Escape, the focus trap and returning focus to the
   * opener come with them. Left here are the reading pane's two columns, which are layout, and the
   * rendered document below, which is the actual subject.
   */
  .hx-rules {
    display: flex;
    flex-direction: column;
    max-height: min(88vh, 820px);
    overflow: hidden;
}

  .hx-rules__head {
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
}

  .hx-rules__columns {
    display: flex;
    min-height: 0;
    /* The rail scrolls with nothing; only the prose does. */
    align-items: stretch;
}

  .hx-rules__rail {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 1px;
    width: 208px;
    padding: 14px 10px 20px;
    overflow-y: auto;
    border-right: thin solid rgba(var(--v-border-color), var(--v-border-opacity));
}

  /* Entries read as a list, not as a column of buttons: ragged left, full width, no frame. */
  .hx-rules__entry {
    justify-content: flex-start;
    height: auto;
    min-height: 32px;
    padding: 6px 10px;
    text-align: left;

    .v-btn__content {
      width: 100%;
      justify-content: flex-start;
      white-space: normal;
    }
}

  .hx-rules__body {
    flex: 1 1 auto;
    min-width: 0;
    padding: 6px 26px 28px;
    overflow-y: auto;
}

  /* ── the rendered document ────────────────────────────────────────────────────── */

  .prose {
    /* A measure, not a width: prose past about 80 characters a line is hard to track back. */
    max-width: 62ch;
    font-size: var(--text-base);
    line-height: var(--text-base-line);
}

  .prose h1 {
    margin: 18px 0 6px;
    color: rgb(var(--v-theme-primary));
    font-size: var(--text-lg);
    line-height: var(--text-lg-line);
}

  .prose h2 {
    /* Clears the top edge when a rail entry scrolls one into view. */
    margin: 30px 0 10px;
    padding-top: 14px;
    border-top: 1px solid rgb(var(--v-theme-divider));
    color: rgb(var(--v-theme-primary));
    font-size: var(--text-base);
    line-height: var(--text-base-line);
    scroll-margin-top: 6px;
}

  .prose h3 {
    margin: 20px 0 6px;
    color: rgb(var(--v-theme-on-surface));
    font-size: var(--text-base);
    line-height: var(--text-base-line);
}

  .prose p,
  .prose ul,
  .prose ol {
    margin: 0 0 12px;
}

  .prose ul,
  .prose ol {
    padding-left: 20px;
}

  .prose li {
    margin-bottom: 5px;
}

  .prose strong {
    color: rgb(var(--v-theme-on-surface));
    font-weight: 600;
}

  .prose em {
    color: rgb(var(--v-theme-on-surface));
}

  /*
   * Dense material, deliberately one step down.
   *
   * A three-column rules table is 334px wide at the base size against a 278px column on a phone — it
   * overflowed. Tables and inline code are what the small tier is *for*: they are scanned rather than
   * read, and they are the one place where fitting the width matters more than matching the body.
   */
  .prose code {
    padding: 1px 4px;
    border-radius: 2px;
    background: rgb(255 255 255 / 6%);
    color: rgb(var(--v-theme-primary));
    font-size: var(--text-sm);
    line-height: var(--text-sm-line);
}

  .prose a {
    color: rgb(var(--v-theme-success));
}

  .prose img {
    display: block;
    max-width: 100%;
    margin: 14px 0;
    border: 1px solid rgb(var(--v-theme-divider));
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
  .prose td:first-child {
    width: 46px;
    padding: 5px 10px 5px 0;
}

  .prose td:first-child img {
    width: 36px;
    height: 45px;
    margin: 0;
    padding: 3px;
    border: 1px solid rgb(var(--v-theme-secondary));
    border-radius: 3px;
    background: rgb(var(--v-theme-primary-darken-1));
    object-fit: contain;
}

  .prose blockquote {
    margin: 0 0 12px;
    padding: 2px 0 2px 14px;
    border-left: 2px solid rgb(var(--v-theme-border-brass));
    color: rgb(var(--v-theme-muted));
}

  .prose table {
    width: 100%;
    margin: 0 0 14px;
    border-collapse: collapse;
    font-size: var(--text-sm);
    line-height: var(--text-sm-line);
}

  .prose th,
  .prose td {
    padding: 6px 10px;
    border-bottom: 1px solid rgb(var(--v-theme-divider));
    text-align: left;
}

  .prose th {
    color: rgb(var(--v-theme-muted));
    font-weight: 500;
    text-transform: uppercase;
}

  .prose hr {
    margin: 22px 0;
    border: 0;
    border-top: 1px solid rgb(var(--v-theme-divider));
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
      border-bottom: 1px solid rgb(var(--v-theme-divider));
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
}
</style>
