import { describe, it, expect, beforeEach } from 'bun:test';
import {
  TestS3Filesystem,
  S3FilesystemStorage,
  S3FilesystemBackups,
} from './test_s3_filesystem';

describe('TestS3Filesystem', () => {
  let form: TestS3Filesystem;

  beforeEach(() => {
    // Create a form with a config resolver that returns a disabled config by default
    form = new TestS3Filesystem(() => ({
      enabled: false,
      bucket: 'test-bucket',
      region: 'us-east-1',
      endpoint: 's3.amazonaws.com',
      accessKey: 'test-key',
      secret: 'test-secret',
      forcePathStyle: false,
    }));
  });

  it('validates filesystem is required', () => {
    const errors = form.validate();
    expect(errors).not.toBeNull();
    expect(errors!['filesystem']).toContain('required');
  });

  it('validates filesystem must be storage or backups', () => {
    form.filesystem = 'invalid';
    const errors = form.validate();
    expect(errors).not.toBeNull();
    expect(errors!['filesystem']).toContain('storage');
  });

  it('accepts "storage" as valid filesystem', () => {
    form.filesystem = S3FilesystemStorage;
    const errors = form.validate();
    expect(errors).toBeNull();
  });

  it('accepts "backups" as valid filesystem', () => {
    form.filesystem = S3FilesystemBackups;
    const errors = form.validate();
    expect(errors).toBeNull();
  });

  it('submit returns error when filesystem not enabled', async () => {
    form.filesystem = S3FilesystemStorage;
    const error = await form.submit();
    expect(error).toContain('not enabled');
  });

  it('submit returns validation errors when invalid', async () => {
    const error = await form.submit();
    expect(error).toBeTruthy();
  });

  it('submit attempts connection test when enabled (override for test)', async () => {
    form = new TestS3Filesystem(() => ({
      enabled: true,
      bucket: 'test-bucket',
      region: 'us-east-1',
      endpoint: 's3.amazonaws.com',
      accessKey: 'test-key',
      secret: 'test-secret',
      forcePathStyle: false,
    }));
    form.filesystem = S3FilesystemStorage;

    // Override simulateS3Operations to confirm it gets called
    let operationsCalled = false;
    form['simulateS3Operations'] = async () => {
      operationsCalled = true;
    };

    const error = await form.submit();
    expect(error).toBeNull();
    expect(operationsCalled).toBe(true);
  });

  it('submit fails when simulateS3Operations throws', async () => {
    form = new TestS3Filesystem(() => ({
      enabled: true,
      bucket: 'test',
      region: 'us-east-1',
      endpoint: 'localhost:9000',
      accessKey: 'key',
      secret: 'secret',
      forcePathStyle: true,
    }));
    form.filesystem = S3FilesystemStorage;
    form['simulateS3Operations'] = async () => {
      throw new Error('Connection refused');
    };

    const error = await form.submit();
    expect(error).toContain('Connection refused');
  });

  it('simulateS3Operations can be overridden for testing', async () => {
    let called = false;
    form = new TestS3Filesystem(() => ({
      enabled: true,
      bucket: 'test',
      region: 'us-east-1',
      endpoint: 'localhost:9000',
      accessKey: 'key',
      secret: 'secret',
      forcePathStyle: true,
    }));

    // Override the simulate method
    form['simulateS3Operations'] = async () => {
      called = true;
    };

    form.filesystem = S3FilesystemStorage;
    const error = await form.submit();
    expect(called).toBe(true);
    expect(error).toBeNull();
  });

  it('buildAuthHeaders returns basic auth headers', () => {
    form.filesystem = S3FilesystemStorage;
    const headers = form['buildAuthHeaders'](
      {
        enabled: true,
        bucket: 'b',
        region: 'r',
        endpoint: 'e',
        accessKey: 'ak',
        secret: 'sk',
        forcePathStyle: false,
      },
      'GET',
      'http://example.com',
    );
    expect(headers['X-Auth-Token']).toContain('ak:sk');
  });

  it('parseListResponse extracts keys from XML', () => {
    const xml = `<?xml version="1.0"?>
<ListBucketResult>
  <Contents>
    <Key>test/file1.txt</Key>
  </Contents>
  <Contents>
    <Key>test/file2.txt</Key>
  </Contents>
</ListBucketResult>`;
    const keys = form['parseListResponse'](xml);
    expect(keys).toEqual(['test/file1.txt', 'test/file2.txt']);
  });

  it('parseListResponse handles empty XML', () => {
    const xml = '<?xml version="1.0"?><ListBucketResult></ListBucketResult>';
    const keys = form['parseListResponse'](xml);
    expect(keys).toEqual([]);
  });
});
