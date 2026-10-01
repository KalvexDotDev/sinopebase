import { describe, expect, test } from 'bun:test'
import { parseS3Endpoint } from '~/core/app'

describe('parseS3Endpoint', () => {
  test('https URL without a port uses 443 (hosted S3 such as Atlas)', () => {
    expect(parseS3Endpoint('https://s3.atlascloud.is')).toEqual({
      host: 's3.atlascloud.is',
      port: 443,
      useSSL: true,
    })
  })

  test('http URL without a port uses 80', () => {
    expect(parseS3Endpoint('http://s3.internal')).toEqual({
      host: 's3.internal',
      port: 80,
      useSSL: false,
    })
  })

  test('explicit port wins', () => {
    expect(parseS3Endpoint('http://rustfs:9000')).toEqual({
      host: 'rustfs',
      port: 9000,
      useSSL: false,
    })
    expect(parseS3Endpoint('https://s3.example.com:8443')).toEqual({
      host: 's3.example.com',
      port: 8443,
      useSSL: true,
    })
  })

  test('bare host keeps the RustFS default port 9000', () => {
    expect(parseS3Endpoint('rustfs')).toEqual({ host: 'rustfs', port: 9000, useSSL: false })
    expect(parseS3Endpoint('localhost:9100')).toEqual({
      host: 'localhost',
      port: 9100,
      useSSL: false,
    })
  })
})
