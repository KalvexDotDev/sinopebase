import { describe, it, expect } from 'bun:test'
import { normalizeExpands } from '~/core/record_query_expand.ts'

describe('normalizeExpands', () => {
  it('removes empty entries', () => {
    expect(normalizeExpands(['', '  ', 'a', null as unknown as string])).toEqual(['a'])
  })

  it('strips whitespace and dots', () => {
    const result = normalizeExpands([' author ', '.article.'])
    expect(result).toContain('author')
    expect(result).toContain('article')
  })

  it('deduplicates entries', () => {
    const result = normalizeExpands(['author', 'author', 'category'])
    expect(result).toEqual(['author', 'category'])
  })

  it('removes subsumed paths', () => {
    const result = normalizeExpands(['author', 'author.name', 'category'])
    // 'author.name' is subsumed by 'author' (shorter prefix)
    expect(result).toContain('author')
    expect(result).toContain('category')
    expect(result).not.toContain('author.name')
  })

  it('keeps unrelated paths', () => {
    const result = normalizeExpands(['author.name', 'category.tags'])
    expect(result).toContain('author.name')
    expect(result).toContain('category.tags')
  })
})
