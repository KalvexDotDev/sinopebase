/**
 * Excerpt modifier: truncates HTML text to a maximum length with optional ellipsis.
 *
 * Port of PocketBase tools/picker/excerpt_modifier.go
 * Layer 1 -- imports from Layer 0 tools.
 */

import type { Modifier } from './modifiers.ts'
import { Modifiers } from './modifiers.ts'

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

Modifiers.excerpt = (...args: string[]): Modifier => {
  return newExcerptModifier(args)
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXCLUDE_TAGS = [
  'head',
  'style',
  'script',
  'iframe',
  'embed',
  'applet',
  'object',
  'svg',
  'img',
  'picture',
  'dialog',
  'template',
  'button',
  'form',
  'textarea',
  'input',
  'select',
  'option',
]

const INLINE_TAGS = [
  'a',
  'abbr',
  'acronym',
  'b',
  'bdo',
  'big',
  'br',
  'button',
  'cite',
  'code',
  'em',
  'i',
  'label',
  'q',
  'small',
  'span',
  'strong',
  'strike',
  'sub',
  'sup',
  'time',
]

// ---------------------------------------------------------------------------
// ExcerptModifier
// ---------------------------------------------------------------------------

class ExcerptModifier implements Modifier {
  private max: number
  private withEllipsis: boolean

  constructor(max: number, withEllipsis: boolean) {
    this.max = max
    this.withEllipsis = withEllipsis
  }

  modify(value: unknown): unknown {
    if (typeof value !== 'string') {
      return value
    }

    const stripped = stripTags(value)

    let result = stripped.trim()

    if (result.length > this.max) {
      // Truncate by rune/codepoint (matching Go's []rune behavior)
      const runes = [...result]
      if (runes.length > this.max) {
        result = runes.slice(0, this.max).join('')
        result = result.trimEnd()
        if (this.withEllipsis) {
          result += '...'
        }
      }
    }

    return result
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function newExcerptModifier(args: string[]): Modifier {
  const totalArgs = args.length

  if (totalArgs === 0) {
    throw new Error('max argument is required - expected (max, withEllipsis?)')
  }

  if (totalArgs > 2) {
    throw new Error('too many arguments - expected (max, withEllipsis?)')
  }

  const max = Number(args[0])
  if (!Number.isFinite(max) || max <= 0) {
    throw new Error('max argument must be > 0')
  }

  let withEllipsis = false
  if (totalArgs > 1) {
    withEllipsis = args[1] === 'true' || args[1] === '1' || args[1]?.toLowerCase() === 'true'
  }

  return new ExcerptModifier(max, withEllipsis)
}

// ---------------------------------------------------------------------------
// Helper: strip tags (simplified HTML tag removal)
// ---------------------------------------------------------------------------

/**
 * Strip HTML tags from a string, inserting spaces at block boundaries.
 *
 * This is the excerpt-specific variant that:
 * - Removes content from excluded tags (style, script, etc.)
 * - Inserts spaces before/after block-level elements
 * - Collapses whitespace
 */
function stripTags(html: string): string {
  const output: string[] = []
  let inSkip = 0
  const skipDepth: number[] = []
  let hasPrevSpace = false
  const MAX_PREVIEW = 10000 // safety limit to avoid excessive recursion

  let i = 0
  while (i < html.length && output.join('').length < MAX_PREVIEW) {
    if (html[i] === '<') {
      // Comment
      if (html.startsWith('<!--', i)) {
        const end = html.indexOf('-->', i + 4)
        i = end !== -1 ? end + 3 : html.length
        continue
      }

      // Closing tag: </...>
      if (html[i + 1] === '/') {
        const end = html.indexOf('>', i)
        if (end === -1) break
        const tag = html
          .slice(i + 2, end)
          .trim()
          .split(/\s+/)[0]
          ?.toLowerCase()

        // Exit skip depth
        if (EXCLUDE_TAGS.includes(tag) && skipDepth.length > 0) {
          skipDepth.pop()
          inSkip--
        }

        if (inSkip === 0 && !INLINE_TAGS.includes(tag) && !hasPrevSpace) {
          output.push(' ')
          hasPrevSpace = true
        }

        i = end + 1
        continue
      }

      // Opening or self-closing tag
      const end = html.indexOf('>', i)
      if (end === -1) break

      const tagContent = html.slice(i + 1, end).trim()
      const isSelfClose = tagContent.endsWith('/')
      const cleaned = isSelfClose ? tagContent.slice(0, -1).trim() : tagContent
      const spaceIdx = cleaned.search(/[\s/>]/)
      const tagName = (spaceIdx === -1 ? cleaned : cleaned.slice(0, spaceIdx)).toLowerCase()

      const isBlock = !INLINE_TAGS.includes(tagName) && !EXCLUDE_TAGS.includes(tagName)

      if (isSelfClose || tagName === 'br') {
        if (inSkip === 0) {
          output.push(' ')
          hasPrevSpace = true
        }
        i = end + 1
        continue
      }

      // Opening tag
      if (EXCLUDE_TAGS.includes(tagName)) {
        skipDepth.push(1)
        inSkip++
        i = end + 1
        continue
      }

      if (inSkip === 0 && isBlock && !hasPrevSpace) {
        output.push(' ')
        hasPrevSpace = true
      }

      i = end + 1
      continue
    }

    // Text content
    if (inSkip === 0) {
      let text = ''
      while (i < html.length && html[i] !== '<') {
        const ch = html[i]
        if (ch === undefined) break
        text += ch
        i++
      }

      let txt = text.replace(/\s+/g, ' ')
      if (hasPrevSpace) {
        txt = txt.replace(/^ +/, '')
      }

      if (txt !== '') {
        hasPrevSpace = txt.endsWith(' ')
        output.push(txt)
      }
    } else {
      i++
    }
  }

  return output.join('')
}

export { ExcerptModifier }
