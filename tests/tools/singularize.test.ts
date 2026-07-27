import { describe, expect, it } from 'bun:test'
import { Singularize } from '~/tools/inflector/singularize'

describe('Singularize', () => {
  it('returns empty string for empty input', () => {
    expect(Singularize('')).toBe('')
  })

  // Irregular / invariant forms
  it('handles invariant plural forms', () => {
    expect(Singularize('series')).toBe('series')
    expect(Singularize('fish')).toBe('fish')
    expect(Singularize('sheep')).toBe('sheep')
    expect(Singularize('deer')).toBe('deer')
    expect(Singularize('news')).toBe('news')
    // "means" is not in the invariant list so the catch-all s$ rule produces "mean"
    expect(Singularize('means')).toBe('mean')
  })

  it('handles -ies endings', () => {
    expect(Singularize('cities')).toBe('city')
    expect(Singularize('puppies')).toBe('puppy')
    expect(Singularize('flies')).toBe('fly')
    expect(Singularize('currencies')).toBe('currency')
  })

  it('handles -ves endings', () => {
    expect(Singularize('wolves')).toBe('wolf')
    expect(Singularize('knives')).toBe('knife')
    expect(Singularize('lives')).toBe('life')
    expect(Singularize('shelves')).toBe('shelf')
  })

  it('handles -ses endings', () => {
    expect(Singularize('analyses')).toBe('analysis')
    expect(Singularize('diagnoses')).toBe('diagnosis')
    expect(Singularize('bases')).toBe('basis')
    expect(Singularize('crises')).toBe('crisis')
  })

  it('handles -xes endings', () => {
    expect(Singularize('axes')).toBe('axis')
    expect(Singularize('taxes')).toBe('tax')
    // "axes" could also fall under "ax" pattern via rule
  })

  it('handles -ches, -shes, -sses endings', () => {
    expect(Singularize('watches')).toBe('watch')
    expect(Singularize('bushes')).toBe('bush')
    expect(Singularize('classes')).toBe('class')
    expect(Singularize('kisses')).toBe('kiss')
  })

  it('handles -oes endings', () => {
    expect(Singularize('potatoes')).toBe('potato')
    expect(Singularize('tomatoes')).toBe('tomato')
    expect(Singularize('heroes')).toBe('hero')
  })

  it('handles -ices endings', () => {
    expect(Singularize('matrices')).toBe('matrix')
    expect(Singularize('vertices')).toBe('vertex')
    expect(Singularize('indices')).toBe('index')
  })

  it('handles -i endings (Latin plural)', () => {
    expect(Singularize('alumni')).toBe('alumnus')
    expect(Singularize('cacti')).toBe('cactus')
    expect(Singularize('foci')).toBe('focus')
    expect(Singularize('fungi')).toBe('fungus')
    expect(Singularize('nuclei')).toBe('nucleus')
    expect(Singularize('radii')).toBe('radius')
    expect(Singularize('stimuli')).toBe('stimulus')
    expect(Singularize('syllabi')).toBe('syllabus')
    expect(Singularize('termini')).toBe('terminus')
  })

  // Note: Latin -ae → -a plurals (algae, vertebrae) are not covered
  // by the current rule set and would remain unchanged.

  it('handles -people', () => {
    expect(Singularize('people')).toBe('person')
  })

  it('handles -men', () => {
    expect(Singularize('men')).toBe('man')
    expect(Singularize('women')).toBe('woman')
  })

  it('handles -children', () => {
    expect(Singularize('children')).toBe('child')
  })

  it('handles -feet', () => {
    expect(Singularize('feet')).toBe('foot')
  })

  it('handles -teeth', () => {
    expect(Singularize('teeth')).toBe('tooth')
  })

  it('handles -oxen', () => {
    expect(Singularize('oxen')).toBe('ox')
  })

  it('handles -ouses', () => {
    expect(Singularize('houses')).toBe('house')
    expect(Singularize('mouses')).toBe('mouse') // mice is handled separately
  })

  it('handles -ice (mice, lice)', () => {
    expect(Singularize('mice')).toBe('mouse')
    expect(Singularize('lice')).toBe('louse')
  })

  it('handles regular -s ending', () => {
    expect(Singularize('cats')).toBe('cat')
    expect(Singularize('dogs')).toBe('dog')
    expect(Singularize('books')).toBe('book')
    expect(Singularize('cars')).toBe('car')
  })

  it('handles -ss ending (already singular, s$ rule should not strip)', () => {
    // Words ending in -ss are caught by the first rule (media|ss)
    // or the "ss" in "(cris|ax|test)es$" pattern
    // For "class", it should remain as-is (not matched by s$ since
    // it's not followed by additional s)
    expect(Singularize('class')).toBe('class')
    expect(Singularize('glass')).toBe('glass')
  })

  it('handles singular word that ends in -us', () => {
    // The ^(.*us)$ rule should preserve it
    expect(Singularize('cactus')).toBe('cactus')
    expect(Singularize('focus')).toBe('focus')
    expect(Singularize('genus')).toBe('genus')
  })

  it('handles word unchanged when no rule matches', () => {
    expect(Singularize('information')).toBe('information')
    expect(Singularize('equipment')).toBe('equipment')
  })

  it('handles statuses -> status', () => {
    expect(Singularize('statuses')).toBe('status')
  })

  it('handles quizzes -> quiz', () => {
    expect(Singularize('quizzes')).toBe('quiz')
  })

  it('handles shoes -> shoe', () => {
    expect(Singularize('shoes')).toBe('shoe')
  })

  it('handles movies -> movie', () => {
    expect(Singularize('movies')).toBe('movie')
  })

  it('handles drives -> drive', () => {
    expect(Singularize('drives')).toBe('drive')
  })

  it('handles eaus -> eau', () => {
    expect(Singularize('beaus')).toBe('beau')
    expect(Singularize('tableaus')).toBe('tableau')
  })
})
