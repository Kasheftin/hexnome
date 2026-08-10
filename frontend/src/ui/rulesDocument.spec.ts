import { describe, expect, it } from 'vitest'
import { renderRules, sectionsOf, slugOf } from './rulesDocument'

/**
 * The contents rail, and the one property that matters.
 *
 * A rail entry and the heading it scrolls to are produced by two different functions, and if they
 * ever disagree the navigation silently goes nowhere. So most of what is here is the two of them
 * being asked the same question.
 */

const DOC = `# Hexnome

Some opening prose.

## What you are doing

A paragraph.

### A detail

Not a section.

## A turn

More prose.

## Scoring, and the end
`

describe('the sections a document offers', () => {
  it('lists its top-level headings, in order', () => {
    expect(sectionsOf(DOC).map(s => s.title))
      .toEqual(['What you are doing', 'A turn', 'Scoring, and the end'])
  })

  /** The title is the document, not a place inside it, and a rail of every `###` would be longer
   *  than the rules. */
  it('ignores the document title and anything below a section', () => {
    const titles = sectionsOf(DOC).map(s => s.title)
    expect(titles).not.toContain('Hexnome')
    expect(titles).not.toContain('A detail')
  })

  it('has nothing to say about a document with no headings', () => {
    expect(sectionsOf('Just some prose.\n\nAnd more.')).toEqual([])
  })

  it('reads a heading holding markup as its text', () => {
    expect(sectionsOf('## Paying for a `put`').map(s => s.title)).toEqual(['Paying for a `put`'])
  })
})

describe('the slug a heading gets', () => {
  it('is the words, lowercased and joined', () => {
    expect(slugOf('Scoring, and the end')).toBe('scoring-and-the-end')
  })

  it('does not begin or end with a dash, whatever the punctuation', () => {
    expect(slugOf('— Stems (the jokers) —')).toBe('stems-the-jokers')
  })
})

/**
 * The two halves agreeing. This is the test that would catch the rail going dead.
 */
describe('the rail and the document', () => {
  it('gives every section an id that its rail entry points at', () => {
    const html = renderRules(DOC)

    for (const section of sectionsOf(DOC)) {
      expect(`${section.title}: ${html.includes(`id="${section.slug}"`)}`)
        .toBe(`${section.title}: true`)
    }
  })

  it('anchors sections and leaves other headings alone', () => {
    const html = renderRules(DOC)
    expect(html).toContain('<h2 id="a-turn">A turn</h2>')
    expect(html).toContain('<h3>A detail</h3>')
    expect(html).not.toContain('<h1 id=')
  })

  /**
   * Two sections could be named the same, and two headings sharing an id would send both rail
   * entries to the first one. Numbered the same way on both sides, so they stay in step.
   */
  it('keeps two identically named sections apart, in both places', () => {
    const twice = '## Scoring\n\ntext\n\n## Scoring\n'

    expect(sectionsOf(twice).map(s => s.slug)).toEqual(['scoring', 'scoring-2'])
    const html = renderRules(twice)
    expect(html).toContain('id="scoring"')
    expect(html).toContain('id="scoring-2"')
  })

  it('renders ordinary markdown as ordinary html', () => {
    const html = renderRules('A **bold** claim and a [link](/rules/x.png).')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('href="/rules/x.png"')
  })
})
