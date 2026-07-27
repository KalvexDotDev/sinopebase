// ---------------------------------------------------------------------------
// DropFunctions — Edge Functions Plugin for Sinopebase
//
// Port of dropfunctions execution model to Elysia plugin.
// Functions are .ts/.js files in a directory, each exporting a default handler
// and an optional named `config` export.
//
// Usage:
//   const plugin = new DropFunctionsPlugin({ functionsDir: './my-functions' })
//   await plugin.register(app)
// ---------------------------------------------------------------------------

import type { Elysia } from 'elysia'
import type { SinopebaseAuth } from '~/tools/auth-better'
import type { DropFunctionsPluginOptions } from './config'
import { DEFAULTS } from './config'
import { createExecuteRoutes } from './routes/execute'
import { createManageRoutes } from './routes/manage'

export class DropFunctionsPlugin {
  private options: Required<DropFunctionsPluginOptions>
  private auth: SinopebaseAuth | null = null

  constructor(options: DropFunctionsPluginOptions = {}) {
    this.options = { ...DEFAULTS, ...options }
  }

  /**
   * Register the plugin with a Sinopebase Elysia app.
   *
   * @param app  The Elysia app instance (the `.server` on Sinopebase)
   * @param auth Optional better-auth instance for auth-required functions
   */
  async register(app: Elysia, auth?: SinopebaseAuth | null): Promise<void> {
    this.auth = auth ?? null

    // Mount manage routes BEFORE execute routes so specific method handlers
    // (DELETE, PATCH) take priority over execute's catch-all .all() handler.
    // Mount under Sinopebase path
    app.use(createManageRoutes(this.options.functionsDir, this.auth, '/api/functions/v1'))
    app.use(createExecuteRoutes(this.options, this.auth, '/api/functions/v1'))

    // Mount under Supabase-compatible path
    app.use(createManageRoutes(this.options.functionsDir, this.auth, '/functions/v1'))
    app.use(createExecuteRoutes(this.options, this.auth, '/functions/v1'))

    console.log(`DropFunctions: watching "${this.options.functionsDir}"`)
  }

  /** Get the resolved plugin options. */
  getOptions(): Readonly<Required<DropFunctionsPluginOptions>> {
    return this.options
  }
}
