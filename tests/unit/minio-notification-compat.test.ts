import { describe, expect, it } from 'bun:test'
import { Readable } from 'node:stream'
import { Client } from 'minio'

describe('patched MinIO notification parser', () => {
  it('emits a JSON-line notification with the patched stream-json version', async () => {
    const client = new Client({
      endPoint: '127.0.0.1',
      port: 9000,
      useSSL: false,
      accessKey: 'local-test-key',
      secretKey: 'local-test-secret',
    })
    const record = { eventName: 's3:ObjectCreated:Put', s3: { object: { key: 'fixture' } } }
    const request = client as unknown as {
      makeRequestAsync: () => Promise<Readable>
    }
    request.makeRequestAsync = async () =>
      Readable.from([`${JSON.stringify({ Records: [record] })}\n`])

    const listener = client.listenBucketNotification('test-bucket', '', '', [])
    const received = await new Promise<unknown>((resolve, reject) => {
      listener.once('notification', resolve)
      listener.once('error', reject)
    })
    listener.stop()

    expect(received).toEqual(record)
  })
})
