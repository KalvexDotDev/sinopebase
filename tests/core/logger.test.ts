import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test'
import { logger, generateRequestId, withRequestId } from '../../src/core/logger'

// ---------------------------------------------------------------------------
// Helpers: capture process.stdout / process.stderr writes
// ---------------------------------------------------------------------------

interface Capture {
  stdout: string[]
  stderr: string[]
}

function captureStreams(): Capture {
  const cap: Capture = { stdout: [], stderr: [] }

  const origStdoutWrite = process.stdout.write.bind(process.stdout)
  const origStderrWrite = process.stderr.write.bind(process.stderr)

  // @ts-expect-error - mocking write for tests
  process.stdout.write = (chunk: string) => {
    cap.stdout.push(chunk)
    return true
  }
  // @ts-expect-error - mocking write for tests
  process.stderr.write = (chunk: string) => {
    cap.stderr.push(chunk)
    return true
  }

  return cap
}

function restoreStreams(): void {
  // No-op — the mock is per-test via capture/restore helpers
}

// ---------------------------------------------------------------------------
// Snapshot env.NODE_ENV at FILE level
// ---------------------------------------------------------------------------

const savedEnv = new Map<string, string | undefined>()

beforeAll(() => {
  savedEnv.set('NODE_ENV', process.env['NODE_ENV'])
})

afterAll(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('logger — production mode (JSON)', () => {
  beforeEach(() => {
    process.env['NODE_ENV'] = 'production'
  })

  it('outputs JSON lines to stdout for info', () => {
    const cap = captureStreams()
    try {
      logger.info('hello world', { foo: 'bar' })
      expect(cap.stdout.length).toBe(1)
      const parsed = JSON.parse(cap.stdout[0]!)
      expect(parsed.level).toBe('info')
      expect(parsed.msg).toBe('hello world')
      expect(parsed.foo).toBe('bar')
      expect(typeof parsed.ts).toBe('string')
      expect(() => new Date(parsed.ts as string)).not.toThrow()
    } finally {
      restoreStreams()
    }
  })

  it('outputs JSON lines to stderr for warn', () => {
    const cap = captureStreams()
    try {
      logger.warn('warning', { detail: 'something' })
      expect(cap.stderr.length).toBe(1)
      const parsed = JSON.parse(cap.stderr[0]!)
      expect(parsed.level).toBe('warn')
      expect(parsed.msg).toBe('warning')
      expect(parsed.detail).toBe('something')
    } finally {
      restoreStreams()
    }
  })

  it('outputs JSON lines to stderr for error', () => {
    const cap = captureStreams()
    try {
      logger.error('an error occurred')
      expect(cap.stderr.length).toBe(1)
      const parsed = JSON.parse(cap.stderr[0]!)
      expect(parsed.level).toBe('error')
      expect(parsed.msg).toBe('an error occurred')
    } finally {
      restoreStreams()
    }
  })

  it('outputs JSON lines to stdout for debug', () => {
    const cap = captureStreams()
    try {
      logger.debug('debugging', { x: 1 })
      expect(cap.stdout.length).toBe(1)
      const parsed = JSON.parse(cap.stdout[0]!)
      expect(parsed.level).toBe('debug')
      expect(parsed.msg).toBe('debugging')
      expect(parsed.x).toBe(1)
    } finally {
      restoreStreams()
    }
  })
})

describe('logger — development mode (pretty-print)', () => {
  beforeEach(() => {
    delete process.env['NODE_ENV']
  })

  it('outputs colored text to stdout for info', () => {
    const cap = captureStreams()
    try {
      logger.info('dev message')
      expect(cap.stdout.length).toBe(1)
      const line = cap.stdout[0]!
      expect(line).toContain('INFO')
      expect(line).toContain('dev message')
      // Should contain ANSI color codes
      expect(line).toContain('\x1b[')
    } finally {
      restoreStreams()
    }
  })

  it('outputs colored text to stderr for error', () => {
    const cap = captureStreams()
    try {
      logger.error('dev error')
      expect(cap.stderr.length).toBe(1)
      const line = cap.stderr[0]!
      expect(line).toContain('ERROR')
      expect(line).toContain('dev error')
    } finally {
      restoreStreams()
    }
  })

  it('includes extra context in dev mode', () => {
    const cap = captureStreams()
    try {
      logger.info('with context', { route: '/test', status: 200 })
      expect(cap.stdout.length).toBe(1)
      const line = cap.stdout[0]!
      expect(line).toContain('with context')
      expect(line).toContain('route')
      expect(line).toContain('/test')
      expect(line).toContain('status')
      expect(line).toContain('200')
    } finally {
      restoreStreams()
    }
  })
})

describe('logger — secret redaction', () => {
  beforeEach(() => {
    process.env['NODE_ENV'] = 'production'
  })

  it('redacts values with "secret" in the key', () => {
    const cap = captureStreams()
    try {
      logger.info('secrets check', { client_secret: 'super-secret-value' })
      const parsed = JSON.parse(cap.stdout[0]!)
      expect(parsed.client_secret).toBe('[REDACTED]')
    } finally {
      restoreStreams()
    }
  })

  it('redacts values with "key" in the key', () => {
    const cap = captureStreams()
    try {
      logger.info('api key', { api_key: 'sk-1234567890abcdef' })
      const parsed = JSON.parse(cap.stdout[0]!)
      expect(parsed.api_key).toBe('[REDACTED]')
    } finally {
      restoreStreams()
    }
  })

  it('redacts values with "token" in the key', () => {
    const cap = captureStreams()
    try {
      logger.info('token', { auth_token: 'eyJhbGciOiJIUzI1NiJ9' })
      const parsed = JSON.parse(cap.stdout[0]!)
      expect(parsed.auth_token).toBe('[REDACTED]')
    } finally {
      restoreStreams()
    }
  })

  it('redacts values with "password" in the key', () => {
    const cap = captureStreams()
    try {
      logger.info('password', { db_password: 'hunter2' })
      const parsed = JSON.parse(cap.stdout[0]!)
      expect(parsed.db_password).toBe('[REDACTED]')
    } finally {
      restoreStreams()
    }
  })

  it('redacts values with "authorization" in the key', () => {
    const cap = captureStreams()
    try {
      logger.info('auth header', { authorization: 'Bearer eyJhbGci' })
      const parsed = JSON.parse(cap.stdout[0]!)
      expect(parsed.authorization).toBe('[REDACTED]')
    } finally {
      restoreStreams()
    }
  })

  it('does not redact normal context values', () => {
    const cap = captureStreams()
    try {
      logger.info('normal', { userId: '123', email: 'test@example.com' })
      const parsed = JSON.parse(cap.stdout[0]!)
      expect(parsed.userId).toBe('123')
      expect(parsed.email).toBe('test@example.com')
    } finally {
      restoreStreams()
    }
  })
})

describe('generateRequestId', () => {
  it('returns a UUID v4 string', () => {
    const id = generateRequestId()
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it('generates unique values', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) {
      ids.add(generateRequestId())
    }
    expect(ids.size).toBe(100)
  })
})

describe('withRequestId', () => {
  beforeEach(() => {
    process.env['NODE_ENV'] = 'production'
  })

  it('includes request_id in log entries', () => {
    const cap = captureStreams()
    try {
      withRequestId('req-abc-123', () => {
        logger.info('inside request scope')
      })
      const parsed = JSON.parse(cap.stdout[0]!)
      expect(parsed.request_id).toBe('req-abc-123')
      expect(parsed.msg).toBe('inside request scope')
    } finally {
      restoreStreams()
    }
  })
})
