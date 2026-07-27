import { describe, expect, it } from 'bun:test'
import './excerpt_modifier.ts' // triggers registration
import { initModifier } from './modifiers.ts'

describe('excerpt modifier', () => {
  it('truncates text to max length', () => {
    const mod = initModifier('excerpt(10)')
    const result = mod.modify('hello world this is long') as string
    expect(result.length).toBeLessThanOrEqual(10)
  })

  it('does not truncate short text', () => {
    const mod = initModifier('excerpt(100)')
    const result = mod.modify('short')
    expect(result).toBe('short')
  })

  it('adds ellipsis when withEllipsis is true', () => {
    const mod = initModifier('excerpt(10,true)')
    const result = mod.modify('hello world this is long') as string
    expect(result).toMatch(/\.\.\.$/)
    // Total should be max + 3 (ellipsis)
    expect(result.length).toBeLessThanOrEqual(13)
  })

  it('does not add ellipsis when withEllipsis is false', () => {
    const mod = initModifier('excerpt(10,false)')
    const result = mod.modify('hello world this is long') as string
    expect(result).not.toMatch(/\.\.\.$/)
  })

  it('strips HTML tags before truncation', () => {
    const mod = initModifier('excerpt(15)')
    const result = mod.modify('<p>hello <b>world</b> this is a long text</p>') as string
    expect(result).not.toContain('<')
    expect(result).not.toContain('>')
    expect(result.length).toBeLessThanOrEqual(15)
  })

  it('returns non-string values unchanged', () => {
    const mod = initModifier('excerpt(10)')
    expect(mod.modify(42)).toBe(42)
    expect(mod.modify(null)).toBe(null)
    expect(mod.modify(undefined)).toBe(undefined)
    expect(mod.modify([1, 2, 3])).toEqual([1, 2, 3])
  })

  it('handles HTML with excluded tags', () => {
    const mod = initModifier('excerpt(50)')
    const result = mod.modify(
      "<p>visible text</p><script>alert('hidden')</script><p>more text</p>",
    ) as string
    expect(result).toContain('visible text')
    expect(result).toContain('more text')
    expect(result).not.toContain('alert')
    expect(result).not.toContain('hidden')
  })

  it('throws without max argument', () => {
    expect(() => initModifier('excerpt')).toThrow(/max argument/)
  })

  it('throws with too many arguments', () => {
    expect(() => initModifier('excerpt(10,true,extra)')).toThrow(/too many arguments/)
  })

  it('throws with non-positive max', () => {
    expect(() => initModifier('excerpt(0)')).toThrow(/must be > 0/)
    expect(() => initModifier('excerpt(-5)')).toThrow(/must be > 0/)
  })

  it('handles empty HTML', () => {
    const mod = initModifier('excerpt(10)')
    expect(mod.modify('')).toBe('')
  })
})
