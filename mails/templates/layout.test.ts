import { describe, it, expect } from 'bun:test'
import { renderEmailLayout } from './layout.ts'

describe('renderEmailLayout', () => {
  it('returns a complete HTML document', () => {
    const html = renderEmailLayout('<p>Hello</p>')
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<p>Hello</p>')
    expect(html).toContain('</html>')
  })

  it('includes the app name in the header', () => {
    const html = renderEmailLayout('', 'MyApp')
    expect(html).toContain('MyApp')
  })

  it('escapes HTML in app name', () => {
    const html = renderEmailLayout('', '<script>alert("xss")</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('includes footer with current year', () => {
    const html = renderEmailLayout('')
    const year = new Date().getFullYear().toString()
    expect(html).toContain(year)
  })

  it('includes default app name when not specified', () => {
    const html = renderEmailLayout('')
    expect(html).toContain('Sinopebase')
  })
})
