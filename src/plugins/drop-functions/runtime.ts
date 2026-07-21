// ---------------------------------------------------------------------------
// DropFunctions — Runtime context builder
// Builds the FunctionContext object passed to every edge function invocation.
// ---------------------------------------------------------------------------

import type { FunctionContext, FunctionAuth } from './types'

/**
 * Build the FunctionContext for a function invocation.
 */
export function buildFunctionContext(
  requestId: string,
  functionName: string,
  auth: FunctionAuth | null,
): FunctionContext {
  return {
    requestId,
    functionName,
    auth,
    env: Object.freeze({ ...process.env }) as Record<string, string>,
    log: (level, message, extra?) => {
      const timestamp = new Date().toISOString()
      const prefix = `[${timestamp}] [${level.toUpperCase()}] [${functionName}] [${requestId}]`
      const extraStr = extra ? ` ${JSON.stringify(extra)}` : ''
      const line = `${prefix} ${message}${extraStr}`

      switch (level) {
        case 'debug':
        case 'info':
          console.log(line)
          break
        case 'warn':
          console.warn(line)
          break
        case 'error':
          console.error(line)
          break
      }
    },
  }
}
