// ---------------------------------------------------------------------------
// DropFunctions — Function execution via direct import + timeout
//
// For v0.2 we use Promise.race() with a timeout rather than Worker isolation.
// Worker isolation (the "Guillotine") will be added in v0.3.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'

export interface SandboxOptions {
  timeout: number
}

/**
 * Load and execute a function module with a timeout.
 *
 * The function file is imported dynamically, its default export is called
 * with the serialised request and context, and the result is returned.
 * A Promise.race enforces the timeout.
 */
export async function executeInSandbox(
  filePath: string,
  req: { method: string; url: string; headers: Record<string, string>; body: string },
  ctx: Record<string, unknown>,
  options: SandboxOptions,
): Promise<unknown> {
  // Import the function module with a cache-busting query parameter
  const importUrl = `file:///${filePath.replace(/\\/g, '/')}?t=${Date.now()}`

  const mod = await import(importUrl) as {
    default?: (...args: unknown[]) => unknown
    config?: { auth?: boolean; timeout?: number }
  }

  const handler = mod.default
  if (!handler || typeof handler !== 'function') {
    throw new Error(`Function at "${filePath}" has no default export`)
  }

  // Reconstruct a minimal Request-like object
  const request = new Request(req.url, {
    method: req.method || 'GET',
    headers: new Headers(req.headers || {}),
    body: req.method !== 'GET' && req.method !== 'HEAD' && req.body
      ? req.body
      : undefined,
  })

  // Execute with timeout via Promise.race
  const result = await Promise.race([
    handler(request, ctx),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Function execution timed out after ${options.timeout}ms`)),
        options.timeout,
      ),
    ),
  ])

  return result
}
