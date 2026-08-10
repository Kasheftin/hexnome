import { Marked, marked } from 'marked'

/**
 * A markdown document, turned into the two things a reader needs: the prose, and a way around it.
 *
 * Kept out of the component because it is the only part with anything to be wrong about. Both
 * functions are pure — text in, values out — so they can be tested without a DOM, a panel or a
 * scroll position.
 *
 * ## The contents come from the document
 *
 * There is no list of sections anywhere. `sectionsOf` reads the headings straight out of the
 * markdown, and `renderRules` stamps the *same slug* onto each heading as an `id`, so a rail entry
 * and the heading it scrolls to cannot disagree. Adding a section to `rules.md` adds it to the rail;
 * renaming one renames both. That property is the whole reason this file exists — the document it
 * replaced went stale precisely because two places had to be kept in step by hand.
 */

export interface RulesSection {
  /** The `id` on the rendered heading, and the rail's key. */
  readonly slug: string
  readonly title: string
}

/**
 * A heading's text as an anchor: lowercase, words joined by dashes.
 *
 * Deliberately simple rather than GitHub-compatible. These slugs are read by nothing outside this
 * app — no external link points at them — so the only thing that matters is that the two callers
 * agree, and the smallest rule that can be held in the head is the one least likely to drift.
 */
export function slugOf(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * The document's top-level sections, in the order they appear.
 *
 * `##` only. `#` is the document's own title, which is not a place to navigate to, and `###` is
 * detail within a section — a rail listing every one of those would be longer than the rules.
 *
 * Read from the lexer rather than from the rendered HTML: the tokens carry the depth and the plain
 * text, so nothing here has to parse markup or strip tags out of a heading that holds a `code` span.
 */
export function sectionsOf(markdown: string): RulesSection[] {
  const seen = new Set<string>()
  const sections: RulesSection[] = []

  for (const token of marked.lexer(markdown)) {
    if (token.type !== 'heading' || token.depth !== 2) continue
    const title = token.text.trim()
    /*
     * Two sections could be given the same name, and two ids the same value would send every rail
     * entry to the first of them. Numbered rather than dropped: the rail should still list what the
     * document contains.
     */
    let slug = slugOf(title) || 'section'
    for (let n = 2; seen.has(slug); n++) slug = `${slugOf(title) || 'section'}-${n}`
    seen.add(slug)
    sections.push({ slug, title })
  }
  return sections
}

/**
 * The document as HTML, with its `##` headings anchored.
 *
 * **`v-html` is safe for this and would not be for much else.** What goes in is a file in this
 * repository, compiled into this bundle by Vite — sanitising it would be sanitising our own source,
 * and pulling in a sanitiser would suggest to the next reader that the input is untrusted. If the
 * rules ever came from a server, from a URL or from anything a person could edit, that stops being
 * true and this needs `DOMPurify` before it renders a character.
 */
export function renderRules(markdown: string): string {
  const seen = new Set<string>()

  /*
   * A fresh instance per render, extended with `use` rather than handed a `renderer` in the options.
   *
   * Both halves matter. Passing `renderer` to `parse` **replaces** the whole renderer in marked 18,
   * so every method this object does not define is gone and the first paragraph throws. And the
   * heading override carries state — the `seen` set that numbers duplicates — so a shared instance
   * would keep numbering across calls and give one document different ids on a second render.
   */
  const md = new Marked()
  md.use({
    renderer: {
      heading({ text, depth, tokens }) {
        const inner = this.parser.parseInline(tokens)
        if (depth !== 2) return `<h${depth}>${inner}</h${depth}>\n`

        // The same numbering `sectionsOf` applies, so the nth duplicate gets the nth id there too.
        const base = slugOf(text.trim()) || 'section'
        let slug = base
        for (let n = 2; seen.has(slug); n++) slug = `${base}-${n}`
        seen.add(slug)
        return `<h2 id="${slug}">${inner}</h2>\n`
      },
    },
  })
  return md.parse(markdown, { async: false })
}
