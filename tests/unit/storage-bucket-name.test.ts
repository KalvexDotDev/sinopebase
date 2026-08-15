/**
 * Storage bucket name validation — rejects path traversal out of /storage/v1/.
 */

import { describe, expect, it } from 'bun:test'
import { validateBucketName } from '../../src/sdk/storage-impl'

describe('validateBucketName', () => {
  it('accepts single-segment bucket names', () => {
    expect(validateBucketName('avatars')).toBe('avatars')
    expect(validateBucketName('my-bucket_1.v2')).toBe('my-bucket_1.v2')
  })

  it('rejects path traversal and separators', () => {
    expect(validateBucketName('../../../rest/v1/_admins')).toBeNull()
    expect(validateBucketName('../buckets')).toBeNull()
    expect(validateBucketName('a/b')).toBeNull()
    expect(validateBucketName('a%2Fb')).toBeNull()
    expect(validateBucketName('.')).toBeNull()
    expect(validateBucketName('..')).toBeNull()
  })
})
