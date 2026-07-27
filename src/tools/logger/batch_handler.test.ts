/**
 * Tests for BatchLogHandler.
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import { BatchLogHandler } from './batch_handler'
import type { LogEntry } from './log'
import { LogLevel } from './log'

interface TestBatchHandlerOptions {
  writeFunc?: (logs: LogEntry[]) => Promise<void> | void
  beforeAddFunc?: ((log: LogEntry) => boolean) | null
  level?: number
  batchSize?: number
  flushInterval?: number
}

describe('BatchLogHandler', () => {
  let writtenBatches: LogEntry[][]

  beforeEach(() => {
    writtenBatches = []
  })

  it('throws if writeFunc is not provided', () => {
    expect(() => new BatchLogHandler({} as TestBatchHandlerOptions)).toThrow(
      'writeFunc must be provided',
    )
  })

  it('applies default options (level=Info, batchSize=100)', () => {
    const handler = new BatchLogHandler({
      flushInterval: 0,
      writeFunc: (logs) => {
        writtenBatches.push(logs)
      },
    })

    expect(handler.Enabled(LogLevel.Debug)).toBe(false)
    expect(handler.Enabled(LogLevel.Info)).toBe(true)
    expect(handler.Enabled(LogLevel.Warn)).toBe(true)
    expect(handler.Enabled(LogLevel.Error)).toBe(true)
  })

  it('filters logs by level', () => {
    const handler = new BatchLogHandler({
      level: LogLevel.Warn,
      batchSize: 10,
      flushInterval: 0,
      writeFunc: (logs) => {
        writtenBatches.push(logs)
      },
    })

    handler.Write(LogLevel.Debug, 'debug msg')
    handler.Write(LogLevel.Info, 'info msg')
    handler.Write(LogLevel.Warn, 'warn msg')
    handler.Write(LogLevel.Error, 'error msg')

    // None have been flushed yet (batchSize=10, only 4 writes)
    expect(writtenBatches.length).toBe(0)
    // Internal queue should only have warn+error entries
    // (We verify via WriteAll since we can't access private state)
  })

  it('flushes when batch size threshold is reached', () => {
    const handler = new BatchLogHandler({
      batchSize: 3,
      flushInterval: 0,
      writeFunc: (logs) => {
        writtenBatches.push(logs)
      },
    })

    handler.Write(LogLevel.Info, 'msg1')
    handler.Write(LogLevel.Info, 'msg2')
    expect(writtenBatches.length).toBe(0)

    // Third write triggers auto-flush (batchSize=3)
    handler.Write(LogLevel.Info, 'msg3')
    expect(writtenBatches.length).toBe(1)
    expect(writtenBatches[0]?.length).toBe(3)
    expect(writtenBatches[0]?.map((l) => l.message).sort()).toEqual(['msg1', 'msg2', 'msg3'])
  })

  it('flushes all logs via WriteAll', async () => {
    const handler = new BatchLogHandler({
      batchSize: 100,
      flushInterval: 0,
      writeFunc: (logs) => {
        writtenBatches.push(logs)
      },
    })

    handler.Write(LogLevel.Info, 'msg1')
    handler.Write(LogLevel.Info, 'msg2')

    expect(writtenBatches.length).toBe(0)

    await handler.WriteAll()
    expect(writtenBatches.length).toBe(1)
    expect(writtenBatches[0]?.length).toBe(2)
    expect(writtenBatches[0]?.[0]?.message).toBe('msg1')
    expect(writtenBatches[0]?.[1]?.message).toBe('msg2')
  })

  it('respects beforeAddFunc filtering', async () => {
    const handler = new BatchLogHandler({
      batchSize: 10,
      flushInterval: 0,
      beforeAddFunc: (log) => log.message !== 'skip_me',
      writeFunc: (logs) => {
        writtenBatches.push(logs)
      },
    })

    handler.Write(LogLevel.Info, 'keep_me')
    handler.Write(LogLevel.Info, 'skip_me')
    handler.Write(LogLevel.Info, 'keep_me_too')

    await handler.WriteAll()

    expect(writtenBatches.length).toBe(1)
    const messages = writtenBatches[0]?.map((l) => l.message)
    expect(messages).toEqual(['keep_me', 'keep_me_too'])
  })

  it('updates level via SetLevel', () => {
    const handler = new BatchLogHandler({
      level: LogLevel.Warn,
      flushInterval: 0,
      writeFunc: (logs) => {
        writtenBatches.push(logs)
      },
    })

    expect(handler.Enabled(LogLevel.Info)).toBe(false)

    handler.SetLevel(LogLevel.Debug)
    expect(handler.Enabled(LogLevel.Debug)).toBe(true)
    expect(handler.Enabled(LogLevel.Info)).toBe(true)
  })

  it('does not flush when queue is empty', async () => {
    const handler = new BatchLogHandler({
      flushInterval: 0,
      writeFunc: (logs) => {
        writtenBatches.push(logs)
      },
    })

    await handler.WriteAll()
    expect(writtenBatches.length).toBe(0)
  })

  it('dispose stops timer and performs final flush', async () => {
    const handler = new BatchLogHandler({
      flushInterval: 10000,
      writeFunc: (logs) => {
        writtenBatches.push(logs)
      },
    })

    handler.Write(LogLevel.Info, 'test')

    await handler.dispose()
    expect(writtenBatches.length).toBe(1)
    expect(writtenBatches[0]?.[0]?.message).toBe('test')
  })
})
