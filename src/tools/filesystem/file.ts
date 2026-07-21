/**
 * File metadata and FileHandle for the PocketBase-style filesystem layer.
 *
 * Port of github.com/pocketbase/pocketbase/tree/master/tools/filesystem/file.go
 * Layer 1 -- wraps the existing IFileStore implementations (Layer 0).
 */

// ---------------------------------------------------------------------------
// FileInfo
// ---------------------------------------------------------------------------

/**
 * FileInfo holds metadata about a stored file.
 */
export interface FileInfo {
  /** Name is the file path / key within the bucket. */
  Name: string
  /** Size is the file size in bytes. */
  Size: number
  /** ContentType is the MIME type of the file. */
  ContentType: string
  /** CreatedAt is when the file was first stored. */
  CreatedAt: Date
  /** UpdatedAt is when the file was last modified. */
  UpdatedAt: Date
}

// ---------------------------------------------------------------------------
// FileHandle
// ---------------------------------------------------------------------------

/**
 * FileHandle provides read/write/close access to a stored file.
 *
 * This is an in-memory handle backed by a Buffer.  The buffer is loaded
 * on construction (via ReadFile) and written back on Close (if modified).
 */
export class FileHandle {
  private _data: Buffer
  private _dirty: boolean = false

  /** Info contains the file's metadata. */
  readonly Info: FileInfo

  constructor(data: Buffer, info: FileInfo) {
    this._data = data
    this.Info = info
  }

  /**
   * Read returns the full contents of the file.
   */
  async Read(): Promise<Buffer> {
    return this._data
  }

  /**
   * Write replaces the file contents with the provided data.
   * The data is buffered in memory until Close() is called.
   */
  async Write(data: Buffer): Promise<void> {
    this._data = data
    this._dirty = true
  }

  /**
   * Close finalises the file handle.
   *
   * For the in-memory handle this is a no-op.  Subclasses that back
   * to a persistent store would flush here.
   */
  async Close(): Promise<void> {
    // No-op for in-memory handles.
    this._dirty = false
  }

  /**
   * IsDirty returns true if the file has been modified since creation / load.
   */
  get IsDirty(): boolean {
    return this._dirty
  }
}
