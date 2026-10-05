/**
 * @new-code-test positive src/core/app.ts
 * @new-code-test negative src/core/app.ts
 */
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

  test('normalizes a bare hostname before applying its default port', () => {
    expect(parseS3Endpoint('RUSTFS')).toEqual({ host: 'rustfs', port: 9000, useSSL: false })
  })

  test('does not treat a path segment as part of an explicit bare-host port', () => {
    expect(parseS3Endpoint('localhost:80/path')).toEqual({
      host: 'localhost',
      port: 9000,
      useSSL: false,
    })
  })

  test('recognizes a URL scheme only at the start of the endpoint', () => {
    expect(parseS3Endpoint('prefixhttps://s3.example.com')).toEqual({
      host: 'prefixhttps',
      port: 9000,
      useSSL: false,
    })
  })

  test('malformed endpoint retains the existing bare-host fallback', () => {
    expect(parseS3Endpoint('not a valid host')).toEqual({
      host: 'not a valid host',
      port: 9000,
      useSSL: false,
    })
  })

  test('bare host keeps the RustFS default port 9000', () => {
    expect(parseS3Endpoint('rustfs')).toEqual({ host: 'rustfs', port: 9000, useSSL: false })
    expect(parseS3Endpoint('localhost:9100')).toEqual({
      host: 'localhost',
      port: 9100,
      useSSL: false,
    })
    expect(parseS3Endpoint('localhost:80')).toEqual({
      host: 'localhost',
      port: 80,
      useSSL: false,
    })
  })
})
