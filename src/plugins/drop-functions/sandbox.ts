// ---------------------------------------------------------------------------
// DropFunctions — Function execution via Bun Worker isolation
//
// Executes user edge functions in a separate Bun Worker thread with
// configurable timeout. The worker is terminated on timeout, ensuring
// clean isolation between function invocations.
// ---------------------------------------------------------------------------

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export interface SandboxOptions {
  timeout: number
}

/** Pre-resolved path to the worker bootstrap file. */
const WORKER_BOOTSTRAP_PATH = join(
  fileURLToPath(new URL('.', import.meta.url)),
  'sandbox-worker.ts',
)

/**
 * Execute an edge function inside a dedicated Bun Worker isolate.
 */
export async function executeInSandbox(
  filePath: string,
  req: { method: string; url: string; headers: Record<string, string>; body: string },
  ctx: Record<string, unknown>,
  options: SandboxOptions,
): Promise<unknown> {
  const workerCode = await Bun.file(WORKER_BOOTSTRAP_PATH).text()

  const blob = new Blob([workerCode], { type: 'application/javascript' })
  const workerURL = URL.createObjectURL(blob)

  let worker: Worker | null = null
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  let tempFilePath: string | null = null

  try {
    // Spawn the worker — try Blob URL first, fall back to temp file
    try {
      worker = new Worker(workerURL, { smol: true, env: {} })
    } catch {
      const fileName = `sandbox-worker-${randomUUID()}.ts`
      tempFilePath = join(tmpdir(), fileName)
      await Bun.write(tempFilePath, workerCode)
      worker = new Worker(tempFilePath, { smol: true, env: {} })
    }

    return await new Promise<unknown>((resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        worker?.terminate()
        reject(new Error(`Function execution timed out after ${options.timeout}ms`))
      }, options.timeout)

      worker!.onmessage = (event: MessageEvent<{ type: string; data?: unknown; error?: string; stack?: string }>) => {
        clearTimeout(timeoutHandle!)
        const msg = event.data
        if (msg.type === 'result') {
          // Reconstruct Response objects that were serialized by the worker
          const data = msg.data as any
          if (data && data.__response === true) {
            resolve(new Response(data.body, {
              status: data.status,
              statusText: data.statusText,
              headers: data.headers,
            }))
          } else {
            resolve(data)
          }
        } else {
          const err = new Error(msg.error)
          if (msg.stack) err.stack = msg.stack
          reject(err)
        }
      }

      worker!.onerror = (event: ErrorEvent) => {
        clearTimeout(timeoutHandle!)
        reject(new Error(event.message || 'Unknown worker error'))
      }

      worker!.postMessage({ filePath, serializedReq: req, ctx })
    })
  } finally {
    URL.revokeObjectURL(workerURL)
    if (timeoutHandle) clearTimeout(timeoutHandle)
    worker?.terminate()
    if (tempFilePath) {
      try { await unlink(tempFilePath) } catch { /* best-effort */ }
    }
  }
}
