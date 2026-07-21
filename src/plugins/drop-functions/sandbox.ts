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
import type { SandboxMessage, SandboxResult, SandboxError } from './types'

export interface SandboxOptions {
  timeout: number
}

/**
 * Execute an edge function inside a dedicated Bun Worker isolate.
 *
 * Reads sandbox-worker.ts as bootstrap code, creates a Blob URL,
 * spawns a Worker, passes invocation data via postMessage, and
 * enforces a hard timeout via worker.terminate(). Falls back to
 * a temp file if Blob URL workers aren't supported by the runtime.
 */
export async function executeInSandbox(
  filePath: string,
  req: { method: string; url: string; headers: Record<string, string>; body: string },
  ctx: Record<string, unknown>,
  options: SandboxOptions,
): Promise<unknown> {
  // Read the static worker bootstrap code
  const workerCode = await Bun.file(
    join(import.meta.dir, 'sandbox-worker.ts'),
  ).text()

  // Create a Blob URL wrapping the worker script
  const blob = new Blob([workerCode], { type: 'application/javascript' })
  const workerURL = URL.createObjectURL(blob)

  let worker: Worker | null = null
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  let tempFilePath: string | null = null

  try {
    // Spawn the worker — try Blob URL first, fall back to temp file
    try {
      worker = new Worker(workerURL, {
        smol: true,
        env: {},
      })
    } catch {
      const fileName = `sandbox-worker-${randomUUID()}.ts`
      tempFilePath = join(tmpdir(), fileName)
      await Bun.write(tempFilePath, workerCode)
      worker = new Worker(tempFilePath, {
        smol: true,
        env: {},
      })
    }

    return await new Promise<unknown>((resolve, reject) => {
      // Enforce a hard timeout — terminate the worker to stop execution
      timeoutHandle = setTimeout(() => {
        worker?.terminate()
        reject(
          new Error(`Function execution timed out after ${options.timeout}ms`),
        )
      }, options.timeout)

      // Listen for the worker's result or error message
      worker!.onmessage = (event: MessageEvent<SandboxMessage>) => {
        clearTimeout(timeoutHandle!)
        const msg = event.data

        if (msg.type === 'result') {
          resolve(msg.data)
        } else {
          const err = new Error(msg.error)
          if (msg.stack) {
            err.stack = msg.stack
          }
          reject(err)
        }
      }

      // Listen for uncaught worker errors (e.g. runtime exceptions)
      worker!.onerror = (event: ErrorEvent) => {
        clearTimeout(timeoutHandle!)
        reject(new Error(event.message || 'Unknown worker error'))
      }

      // Send invocation data to the worker
      worker!.postMessage({ filePath, serializedReq: req, ctx })
    })
  } finally {
    URL.revokeObjectURL(workerURL)
    if (timeoutHandle) clearTimeout(timeoutHandle)

    // Terminate the worker to free resources after the promise settles
    worker?.terminate()

    // Best-effort cleanup of the fallback temp file
    if (tempFilePath) {
      try {
        await unlink(tempFilePath)
      } catch {
        // Temp directory cleanup is best-effort
      }
    }
  }
}
