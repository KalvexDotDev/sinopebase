import { expect, test } from 'bun:test'
import { parseS3Endpoint } from '~/tools/filesystem/s3-endpoint'

test.each([
  ['', '', 9000, false],
  ['bad host:9001', 'bad host', 9001, false],
  ['bad host', 'bad host', 9000, false],
  ['https://storage.example:443', 'storage.example', 443, true],
  ['http://storage.example:80', 'storage.example', 80, false],
  ['https://storage.example:8443', 'storage.example', 8443, true],
  ['http://storage.example:9000', 'storage.example', 9000, false],
  ['storage.example:9001/path', 'storage.example', 9001, false],
  ['storage.example:9001', 'storage.example', 9001, false],
  ['https://storage.example', 'storage.example', 9000, true],
  ['storage.example', 'storage.example', 9000, false],
  ['https://3232235777', '192.168.1.1', 9000, true],
  ['https://[::1]:443', '[::1]', 443, true],
  ['http://storage.example:80/path', 'storage.example', 80, false],
] as const)(
  'resolves %s without losing an explicit default port',
  (input, endpoint, port, useSSL) => {
    expect(parseS3Endpoint(input)).toEqual({ endpoint, port, useSSL })
  },
)

// @new-code-test positive src/tools/filesystem/s3-endpoint.ts
// @new-code-test negative src/tools/filesystem/s3-endpoint.ts
