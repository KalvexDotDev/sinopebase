// ---------------------------------------------------------------------------
// DropFunctions — Plugin configuration
// ---------------------------------------------------------------------------

import type { FunctionConfig } from './types'

export interface DropFunctionsPluginOptions {
  /** Directory containing function files (default: './functions') */
  functionsDir?: string
  /** Default execution timeout in ms (default: 5000) */
  defaultTimeout?: number
  /** Require auth by default for all functions (default: false) */
  defaultAuth?: boolean
  /** Global rate limit configuration */
  rateLimit?: {
    requests: number
    window: string
  }
}

/** Resolved defaults for the plugin. */
export const DEFAULTS: Required<DropFunctionsPluginOptions> = {
  functionsDir: './functions',
  defaultTimeout: 5000,
  defaultAuth: false,
  rateLimit: {
    requests: 100,
    window: '1m',
  },
}

/**
 * Merge a per-function config with the plugin defaults.
 */
export function resolveFunctionConfig(
  pluginOptions: DropFunctionsPluginOptions,
  fnConfig: FunctionConfig | undefined,
): { auth: boolean; timeout: number } {
  return {
    auth: fnConfig?.auth ?? pluginOptions.defaultAuth ?? DEFAULTS.defaultAuth,
    timeout: fnConfig?.timeout ?? pluginOptions.defaultTimeout ?? DEFAULTS.defaultTimeout,
  }
}
