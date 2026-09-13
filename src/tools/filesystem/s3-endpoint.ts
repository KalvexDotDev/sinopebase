/** Resolve the S3 host, explicitly configured port, and TLS independently. */
export function parseS3Endpoint(endpoint: string) {
  try {
    const target = endpoint.startsWith('http') ? endpoint : `http://${endpoint}`
    const url = new URL(target)
    const host = url.hostname
    // A scheme without default ports preserves explicit :80 and :443.
    // Use the HTTP URL above for standard hostname normalization and TLS.
    const statedPort = new URL('s3:' + target.slice(target.indexOf(':') + 1)).port
    const port = statedPort ? Number(statedPort) : 9000
    const useSSL = url.protocol === 'https:'
    return { endpoint: host, port, useSSL }
  } catch {
    return parseBareEndpoint(endpoint)
  }
}

function parseBareEndpoint(endpoint: string) {
  const [host = endpoint, port] = endpoint.split(':')
  return { endpoint: host, port: port ? Number(port) : 9000, useSSL: false }
}
