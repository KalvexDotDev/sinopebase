import { describe, it, expect } from 'bun:test'
import { UploadedFileSize, UploadedFileMimeType } from '~/core/validators/file.ts'
import type { UploadedFile } from '~/core/validators/file.ts'

function makeFile(name: string, size: number, mimeType: string = 'text/plain'): UploadedFile {
  return { name, size, mimeType }
}

describe('UploadedFileSize', () => {
  it('returns null for files under the limit', () => {
    expect(UploadedFileSize(1000)(makeFile('test.txt', 500))).toBeNull()
  })

  it('returns null for files exactly at the limit', () => {
    expect(UploadedFileSize(1000)(makeFile('test.txt', 1000))).toBeNull()
  })

  it('returns error for files over the limit', () => {
    const err = UploadedFileSize(1000)(makeFile('test.txt', 2000))
    expect(err).not.toBeNull()
    expect(err!.code).toBe('validation_file_size_limit')
  })

  it('returns error for non-file input', () => {
    expect(UploadedFileSize(1000)(null)).not.toBeNull()
    expect(UploadedFileSize(1000)('not a file')).not.toBeNull()
    expect(UploadedFileSize(1000)({})).not.toBeNull()
  })
})

describe('UploadedFileMimeType', () => {
  it('returns null for files with allowed mime type', () => {
    const file = makeFile('photo.jpg', 1000, 'image/jpeg')
    expect(UploadedFileMimeType(['image/jpeg', 'image/png'])(file)).toBeNull()
  })

  it('returns error for files with disallowed mime type', () => {
    const file = makeFile('file.exe', 1000, 'application/x-msdownload')
    const err = UploadedFileMimeType(['image/jpeg', 'image/png'])(file)
    expect(err).not.toBeNull()
    expect(err!.code).toBe('validation_invalid_mime_type')
  })

  it('returns error for empty validTypes list', () => {
    const file = makeFile('test.txt', 1000, 'text/plain')
    const err = UploadedFileMimeType([])(file)
    expect(err).not.toBeNull()
  })

  it('returns error for non-file input', () => {
    expect(UploadedFileMimeType(['text/plain'])(null)).not.toBeNull()
    expect(UploadedFileMimeType(['text/plain'])('not a file')).not.toBeNull()
  })
})
