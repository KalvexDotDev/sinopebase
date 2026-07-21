// ---------------------------------------------------------------------------
// DropFunctions — Sandbox Worker (Bun Worker isolate)
//
// This file runs inside a separate Bun Worker thread with restricted globals.
// It receives function metadata via postMessage, dynamically imports the user's
// edge function, calls it with a reconstructed Request, and posts the result
// back to the parent thread.
// ---------------------------------------------------------------------------

import type { SandboxMessage } from '../types'

/** Data received from the parent thread when the worker is started. */
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

/**
 * Handle incoming messages from the parent thread.
 * The first (and only) message contains the file path, serialized request,
 * and function context. We dynamically import the function, execute it,
 * and post the result back.
 */
self.onmessage = async (event: MessageEvent<WorkerData>) => {
  const { filePath, serializedReq, ctx } = event.data

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

    // Post success back to the parent thread
    const message: SandboxMessage = { type: 'result', data: result }
    self.postMessage(message)
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
