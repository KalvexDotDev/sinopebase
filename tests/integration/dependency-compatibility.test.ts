import { expect, test } from 'bun:test'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'

const require = createRequire(import.meta.url)

test('patched query decoder preserves MinIO URL parsing', () => {
  const query = require('query-string')
  expect(query.parse('prefix=caf%C3%A9%2Fnotes&marker=a%20b')).toEqual({
    prefix: 'café/notes',
    marker: 'a b',
  })
  expect(query.parse('prefix=%E0%A4%A')).toHaveProperty('prefix')
})

test('MinIO notifications retain Node stream parsing with the patched JSON parser', async () => {
  const { NotificationPoller } = require('minio/dist/main/notification.js')
  const record = { eventName: 's3:ObjectCreated:Put' }
  const response = Readable.from([`${JSON.stringify({ Records: [record] })}\n`])
  const poller = new NotificationPoller(
    { makeRequestAsync: async () => response },
    'fixture',
    '',
    '',
    [],
  )
  const received = new Promise((resolve, reject) => {
    poller.once('notification', (value: unknown) => {
      poller.stop()
      resolve(value)
    })
    poller.once('error', reject)
  })
  try {
    poller.start()
    expect(await received).toEqual(record)
  } finally {
    poller.stop()
    response.destroy()
  }
})
