// ---------------------------------------------------------------------------
// DropFunctions — Function execution endpoint
// HTTP POST/GET /api/functions/v1/:name
// ---------------------------------------------------------------------------

import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { Elysia } from 'elysia'
import type { DropFunctionsPluginOptions } from '../config'
import { resolveFunctionConfig } from '../config'
import {
  checkRateLimit,
  extractBearerToken,
  parseWindow,
  validateFunctionAuth,
} from '../middleware'
import { buildFunctionContext } from '../runtime'
import { executeInSandbox } from '../sandbox'
import type { FunctionModule } from '../types'

/**
 * Create the function execution route group.
 */
export function createExecuteRoutes(
  options: DropFunctionsPluginOptions,
  auth: unknown,
  prefix = '/api/functions/v1',
) {
  const functionsDir = options.functionsDir || './functions'

  return new Elysia({ name: 'sinopebase-drop-fn-execute' }).all(
    `${prefix}/:name`,
    async ({ request, params, set, headers }) => {
      const functionName = (params as { name: string }).name

      // Prevent path traversal — only allow alphanumeric, hyphens, underscores
      if (!/^[a-zA-Z0-9_-]+$/.test(functionName)) {
        set.status = 400
        return { error: 'Invalid function name', status: 400 }
      }

      // Rate limiting
      const ip =
        (headers['x-forwarded-for'] as string) || (headers['x-real-ip'] as string) || '127.0.0.1'
      const windowMs = parseWindow(options.rateLimit?.window || '1m')
      const maxReq = options.rateLimit?.requests || 100
      if (!checkRateLimit(ip, functionName, maxReq, windowMs)) {
        set.status = 429
        return { error: 'Too many requests', status: 429 }
      }

      // Skip disabled functions (prefixed with _)
      if (functionName.startsWith('_')) {
        set.status = 404
        return { error: `Function "${functionName}" not found`, status: 404 }
      }

      // Load the function file
      const exts = ['.ts', '.js']
      let filePath = ''
      for (const ext of exts) {
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
        mod = (await import(
          `file:///${filePath.replace(/\\/g, '/')}?t=${Date.now()}`
        )) as FunctionModule
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

      // Execute the function in an isolated Bun Worker with timeout
      try {
        const result = await executeInSandbox(
          filePath,
          serialisedReq,
          JSON.parse(JSON.stringify(ctx)),
          { timeout: resolvedConfig.timeout },
        )

        // If the function returns a Response object, forward it directly
        if (result instanceof Response) {
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
    },
  )
}
