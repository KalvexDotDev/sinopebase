/**
 * Port of PocketBase tools/inflector/singularize.go
 *
 * English word singularization.
 * Layer 0 -- zero internal dependencies.
 *
 * The rules are extracted from popular Ruby / PHP / Node.js inflector packages.
 */

// ---------------------------------------------------------------------------
// Regex cache
// ---------------------------------------------------------------------------

const compiledPatterns = new Map<string, RegExp>()

function getOrCompile(pattern: string): RegExp | null {
  let re = compiledPatterns.get(pattern)
  if (re === undefined) {
    try {
      // Go's (?i) prefix → JS `i` flag
      const jsPattern = pattern.replace(/^\(\?i\)/, '')
      re = new RegExp(jsPattern, 'i')
      compiledPatterns.set(pattern, re)
    } catch {
      return null
    }
  }
  return re
}

// ---------------------------------------------------------------------------
// Singular rules
// ---------------------------------------------------------------------------

interface SingularRule {
  pattern: string
  replacement: string
}

const singularRules: SingularRule[] = [
  { pattern: '(?i)([nrlm]ese|deer|fish|sheep|measles|ois|pox|media|ss)$', replacement: '$1' },
  { pattern: '(?i)^(sea[- ]bass)$', replacement: '$1' },
  { pattern: '(?i)(s)tatuses$', replacement: '$1tatus' },
  { pattern: '(?i)(f)eet$', replacement: '$1oot' },
  { pattern: '(?i)(t)eeth$', replacement: '$1ooth' },
  { pattern: '(?i)^(.*)(menu)s$', replacement: '$1$2' },
  { pattern: '(?i)(quiz)zes$', replacement: '$1' },
  { pattern: '(?i)(matr)ices$', replacement: '$1ix' },
  { pattern: '(?i)(vert|ind)ices$', replacement: '$1ex' },
  { pattern: '(?i)^(ox)en', replacement: '$1' },
  { pattern: '(?i)(alias)es$', replacement: '$1' },
  {
    pattern: '(?i)(alumn|bacill|cact|foc|fung|nucle|radi|stimul|syllab|termin|viri?)i$',
    replacement: '$1us',
  },
  { pattern: '(?i)([ftw]ax)es', replacement: '$1' },
  { pattern: '(?i)(cris|ax|test)es$', replacement: '$1is' },
  { pattern: '(?i)(shoe)s$', replacement: '$1' },
  { pattern: '(?i)(o)es$', replacement: '$1' },
  { pattern: '(?i)ouses$', replacement: 'ouse' },
  { pattern: '(?i)([^a])uses$', replacement: '$1us' },
  { pattern: '(?i)([m|l])ice$', replacement: '$1ouse' },
  { pattern: '(?i)(x|ch|ss|sh)es$', replacement: '$1' },
  { pattern: '(?i)(m)ovies$', replacement: '$1ovie' },
  { pattern: '(?i)(s)eries$', replacement: '$1eries' },
  { pattern: '(?i)([^aeiouy]|qu)ies$', replacement: '$1y' },
  { pattern: '(?i)([lr])ves$', replacement: '$1f' },
  { pattern: '(?i)(tive)s$', replacement: '$1' },
  { pattern: '(?i)(hive)s$', replacement: '$1' },
  { pattern: '(?i)(drive)s$', replacement: '$1' },
  { pattern: '(?i)([^fo])ves$', replacement: '$1fe' },
  { pattern: '(?i)(^analy)ses$', replacement: '$1sis' },
  {
    pattern: '(?i)(analy|diagno|^ba|(p)arenthe|(p)rogno|(s)ynop|(t)he)ses$',
    replacement: '$1$2sis',
  },
  { pattern: '(?i)([ti])a$', replacement: '$1um' },
  { pattern: '(?i)(p)eople$', replacement: '$1erson' },
  { pattern: '(?i)(m)en$', replacement: '$1an' },
  { pattern: '(?i)(c)hildren$', replacement: '$1hild' },
  { pattern: '(?i)(n)ews$', replacement: '$1ews' },
  { pattern: '(?i)(n)etherlands$', replacement: '$1etherlands' },
  { pattern: '(?i)eaus$', replacement: 'eau' },
  { pattern: '(?i)(currenc)ies$', replacement: '$1y' },
  { pattern: '(?i)^(.*us)$', replacement: '$1' },
  { pattern: '(?i)s$', replacement: '' },
]

// ---------------------------------------------------------------------------
// Singularize
// ---------------------------------------------------------------------------

/**
 * Converts an English plural word to its singular form.
 *
 * Returns the input unchanged if no rule matches (or if the input is empty).
 *
 * @example
 *   Singularize("people")   // => "person"
 *   Singularize("cats")     // => "cat"
 *   Singularize("analyses") // => "analysis"
 */
export function Singularize(word: string): string {
  if (word === '') {
    return ''
  }

  for (const rule of singularRules) {
    const re = getOrCompile(rule.pattern)
    if (re === null) {
      // Log and skip (mirrors Go behaviour of logging the failure).
      console.warn(`[Singularize] failed to compile rule pattern "${rule.pattern}"`)
      continue
    }

    if (re.test(word)) {
      return word.replace(re, rule.replacement)
    }
  }

  return word
}
