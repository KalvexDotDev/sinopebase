// ---------------------------------------------------------------------------
// DropFunctions — Sandbox Worker (Bun Worker isolate)
//
// Runs inside a dedicated Bun Worker thread. Receives invocation data via
// postMessage, dynamically imports the user's edge function, calls it with a
// reconstructed Request, and posts the result/error back to the parent.
//
// Types are inlined because import paths don't resolve from Blob URL workers.
// ---------------------------------------------------------------------------

type SandboxMessage =
  | { type: 'result'; data: unknown }
  | { type: 'error'; error: string; stack?: string }

interface WorkerData {
  filePath: string
  serializedReq: {
    method: string
    url: string
    headers: Record<string, string>
    body: string
  }
  ctx: Record<string, unknown>
}

/** `self` is a built-in global in Bun Workers — declared here for TS. */
declare var self: {
  onmessage: ((event: MessageEvent<WorkerData>) => void) | null
  postMessage(message: SandboxMessage): void
}

/**
 * Handle incoming messages from the parent thread.
 * The first (and only) message contains the file path, serialized request,
 * and function context. We dynamically import the function, execute it,
 * and post the result back.
 */
self.onmessage = async (event: MessageEvent<WorkerData>) => {
  const { filePath, serializedReq, ctx } = event.data

  // Strip parent env — Bun Worker env:{} may not fully isolate in all versions
  for (const key of Object.keys(process.env)) {
    delete process.env[key]
  }

  try {
    // Cache-busting query param so updated functions aren't served stale
    const importUrl = `file:///${filePath.replace(/\\/g, '/')}?t=${Date.now()}`

    // Dynamically import the user's edge function module
    const mod = await import(importUrl)

    const handler = mod.default
    if (!handler || typeof handler !== 'function') {
      throw new Error(`Function at "${filePath}" has no default export`)
    }

    // Reconstruct a standard Request object from the serialized data
    const request = new Request(serializedReq.url, {
      method: serializedReq.method || 'GET',
      headers: new Headers(serializedReq.headers || {}),
      body:
        serializedReq.method !== 'GET' && serializedReq.method !== 'HEAD' && serializedReq.body
          ? serializedReq.body
          : undefined,
    })

    // Execute the handler and capture the result
    const result = await handler(request, ctx)

    // Response objects are not structured-cloneable — serialize them
    if (result instanceof Response) {
      const serialized = {
        __response: true,
        status: result.status,
        statusText: result.statusText,
        headers: Object.fromEntries(result.headers.entries()),
        body: await result.text(),
      }
      self.postMessage({ type: 'result', data: serialized } as SandboxMessage)
    } else {
      self.postMessage({ type: 'result', data: result } as SandboxMessage)
    }
  } catch (err) {
    // Post error back to the parent thread
    const message: SandboxMessage = {
      type: 'error',
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }
    self.postMessage(message)
  }
}
