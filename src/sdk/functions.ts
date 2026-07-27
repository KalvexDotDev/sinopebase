// ---------------------------------------------------------------------------
// Functions Client — Supabase-compatible Edge Functions client
//
// Mirrors supabase-js `functions.invoke()`.
// ---------------------------------------------------------------------------

export interface FunctionInvokeOptions {
  /** HTTP method (default: POST) */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Request body (serialized as JSON) */
  body?: unknown
  /** Custom headers */
  headers?: Record<string, string>
}

export interface FunctionResponse<T = unknown> {
  data: T | null
  error: { message: string; status: number } | null
}

export interface FunctionsClient {
  /**
   * Invoke an edge function by name.
   *
   * Calls the Supabase-compatible /functions/v1/:name endpoint.
   *
   * @example
   * ```ts
   * const { data, error } = await sinopebase.functions.invoke('hello', {
   *   body: { name: 'World' }
   * })
   * ```
   */
  invoke<T = unknown>(
    functionName: string,
    options?: FunctionInvokeOptions,
  ): Promise<FunctionResponse<T>>
}

export function createFunctionsClient(baseUrl: string, apiKey: string): FunctionsClient {
  return {
    async invoke<T = unknown>(
      functionName: string,
      options?: FunctionInvokeOptions,
    ): Promise<FunctionResponse<T>> {
      const method = options?.method ?? 'POST'
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...options?.headers,
      }

      try {
        const res = await fetch(`${baseUrl}/functions/v1/${functionName}`, {
          method,
          headers,
          body: options?.body ? JSON.stringify(options.body) : undefined,
        })

        const json = (await res.json()) as Record<string, unknown>

        if (!res.ok) {
          return {
            data: null,
            error: {
              message: json?.error || json?.message || `Function returned ${res.status}`,
              status: res.status,
            },
          }
        }

        // Unwrap Sinopebase { data, requestId } envelope if present
        const payload = json?.data !== undefined ? json.data : json
        return { data: payload as T, error: null }
      } catch (err) {
        return {
          data: null,
          error: {
            message: err instanceof Error ? err.message : 'Network error',
            status: 0,
          },
        }
      }
    },
  }
}
