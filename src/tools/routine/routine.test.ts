import { describe, expect, it } from 'bun:test'
import { fireAndForget, safeWrap } from './routine.ts'

describe('fireAndForget', () => {
  it('executes the function', async () => {
    let called = false
    fireAndForget(() => {
      called = true
    })
    // Wait for microtask to execute
    await Promise.resolve()
    expect(called).toBe(true)
  })

  it('catches errors without crashing', async () => {
    let errorCaught = false
    const orig = console.error
    console.error = () => {
      errorCaught = true
    }
    try {
      fireAndForget(() => {
        throw new Error('test error')
      })
      await Promise.resolve()
      expect(errorCaught).toBe(true)
    } finally {
      console.error = orig
    }
  })

  it('catches async rejections without crashing', async () => {
    let errorCaught = false
    const orig = console.error
    console.error = () => {
      errorCaught = true
    }
    try {
      fireAndForget(async () => {
        throw new Error('async error')
      })
      await Promise.resolve()
      await Promise.resolve()
      expect(errorCaught).toBe(true)
    } finally {
      console.error = orig
    }
  })

  it('calls onDone when provided', async () => {
    let done = false
    fireAndForget(
      () => {
        /* noop */
      },
      () => {
        done = true
      },
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(done).toBe(true)
  })
})

describe('safeWrap', () => {
  it('returns the result on success', async () => {
    const wrapped = safeWrap(() => 42)
    const result = await wrapped()
    expect(result).toBe(42)
  })

  it('returns Error when function throws', async () => {
    const wrapped = safeWrap(() => {
      throw new Error('boom')
    })
    const result = await wrapped()
    expect(result).toBeInstanceOf(Error)
    if (result instanceof Error) expect(result.message).toContain('boom')
  })

  it('returns Error when async function rejects', async () => {
    const wrapped = safeWrap(async () => {
      throw new Error('async boom')
    })
    const result = await wrapped()
    expect(result).toBeInstanceOf(Error)
    if (result instanceof Error) expect(result.message).toContain('async boom')
  })

  it('converts non-Error throws to Error', async () => {
    const wrapped = safeWrap(() => {
      throw 'string error'
    })
    const result = await wrapped()
    expect(result).toBeInstanceOf(Error)
  })
})
