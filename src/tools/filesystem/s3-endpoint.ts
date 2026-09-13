/** Resolve the S3 host, explicitly configured port, and TLS independently. */
export function parseS3Endpoint(endpoint: string) {
  let host = endpoint
  let port = 9000
  let useSSL = false
  try {
    const target = endpoint.startsWith('http') ? endpoint : `http://${endpoint}`
    const url = new URL(target)
    host = url.hostname
    // URL.port omits explicitly stated defaults such as :443 and :80.
    // Preserve those values without changing the historical no-port default.
    const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(target)?.[1] ?? ''
    const stated = /:(\d+)$/.exec(authority)?.[1]
    if (stated) port = Number(stated)
    useSSL = url.protocol === 'https:'
  } catch {
    const parts = endpoint.split(':')
    host = parts[0] ?? endpoint
    if (parts[1]) port = Number(parts[1])
  }
  return { endpoint: host, port, useSSL }
}
