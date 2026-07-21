// ---------------------------------------------------------------------------
// DropFunctions — Function execution endpoint
// HTTP POST/GET /api/functions/v1/:name
// ---------------------------------------------------------------------------

import { Elysia } from 'elysia'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DropFunctionsPluginOptions } from '../config'
import { resolveFunctionConfig } from '../config'
import { buildFunctionContext } from '../runtime'
import {
  validateFunctionAuth,
  extractBearerToken,
  checkRateLimit,
  parseWindow,
} from '../middleware'
import type { FunctionModule } from '../types'

/**
 * Create the function execution route group.
 */
export function createExecuteRoutes(
  options: DropFunctionsPluginOptions,
  auth: any,
) {
  const functionsDir = options.functionsDir || './functions'

  return new Elysia()
    .all('/api/functions/v1/:name', async ({ request, params, set, headers }) => {
      const functionName = params.name

      // Rate limiting
      const ip = headers['x-forwarded-for'] as string
        || headers['x-real-ip'] as string
        || '127.0.0.1'
      const windowMs = parseWindow(options.rateLimit?.window || '1m')
      const maxReq = options.rateLimit?.requests || 100
      if (!checkRateLimit(ip, functionName, maxReq, windowMs)) {
        set.status = 429
        return { error: 'Too many requests', status: 429 }
      }

      // Load the function file
      const exts = ['.ts', '.js']
      let filePath = ''
      for (const ext of exts) {
        // Skip disabled functions (prefixed with _)
        if (functionName.startsWith('_')) {
          set.status = 404
          return { error: `Function "${functionName}" not found`, status: 404 }
        }
        const candidate = resolve(functionsDir, functionName + ext)
        if (existsSync(candidate) && !statSync(candidate).isDirectory()) {
          filePath = candidate
          break
        }
      }

      if (!filePath) {
        set.status = 404
        return { error: `Function "${functionName}" not found`, status: 404 }
      }

      // Read and validate function module
      let mod: FunctionModule
      try {
        mod = await import(`file:///${filePath.replace(/\\/g, '/')}?t=${Date.now()}`) as FunctionModule
      } catch (err) {
        set.status = 500
        console.error(`Failed to load function "${functionName}":`, err)
        return { error: `Failed to load function "${functionName}"`, status: 500 }
      }

      const handler = mod.default
      const fnConfig = mod.config
      if (!handler || typeof handler !== 'function') {
        set.status = 500
        return { error: `Function "${functionName}" has no default export`, status: 500 }
      }

      const resolvedConfig = resolveFunctionConfig(options, fnConfig)

      // Auth check (if required by function config)
      const requestId = crypto.randomUUID()
      let functionAuth = null
      if (resolvedConfig.auth) {
        const token = extractBearerToken(request)
        functionAuth = await validateFunctionAuth(auth, token)
        if (!functionAuth) {
          set.status = 401
          return { error: 'Missing or invalid Authorization header', status: 401 }
        }
      }

      // Build context
      const ctx = buildFunctionContext(requestId, functionName, functionAuth)

      // Serialise the request for the function handler
      const serialisedReq = {
        method: request.method,
        url: request.url,
        headers: Object.fromEntries(request.headers.entries()),
        body: request.body ? await request.text() : '',
      }

      // Build a real Request for the function handler
      const fnRequest = new Request(request.url, {
        method: serialisedReq.method || 'GET',
        headers: new Headers(serialisedReq.headers || {}),
        body: serialisedReq.body && serialisedReq.method !== 'GET'
          ? serialisedReq.body
          : undefined,
      })

      // Execute the function with timeout
      try {
        const result = await Promise.race([
          handler(fnRequest, ctx),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Function execution timed out after ${resolvedConfig.timeout}ms`)),
              resolvedConfig.timeout,
            ),
          ),
        ])

        // If the function returns a Response object, forward it
        if (result && typeof result === 'object' && (result as any).__type === 'response') {
          return result
        }

        return {
          data: result,
          requestId,
          functionName,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        set.status = message.includes('timed out') ? 504 : 500
        return { error: message, status: set.status, requestId, functionName }
      }
    })
}
