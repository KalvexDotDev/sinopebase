/**
 * First-time setup installer endpoint.
 *
 * Port of PocketBase apis/installer.go
 * Layer 4 — imports from ~/core/*, ~/tools/*.
 *
 * PocketBase provides an installer flow that:
 * 1. Checks if any non-installer superuser records exist.
 * 2. If not, creates or finds an installer superuser with a random password.
 * 3. Generates a short-lived auth token for the installer superuser.
 * 4. Opens a browser URL (or prints a CLI command) so the admin can create
 *    their first real superuser account.
 *
 * This module provides the TypeScript equivalent of that flow.
 */



import type { App } from '~/core/app'
import { SuperusersCollectionName } from '~/core/record_model_superusers'
import { newStaticAuthToken } from '~/core/record_tokens'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Email address used for the installer superuser. */
export const DEFAULT_INSTALLER_EMAIL = 'installer@pocketbase.com'

/** Default installer function type. */
export type InstallerFunc = (
  app: App,
  systemSuperuser: Record<string, unknown>,
  baseURL: string,
) => Promise<void>

// ---------------------------------------------------------------------------
// Default installer
// ---------------------------------------------------------------------------

/**
 * The default installer function.
 *
 * Generates a short-lived auth token for the system superuser and prints
 * instructions for creating the first superuser account to the console.
 *
 * In the Go version, this also opens a browser URL to the installer UI.
 */
export async function defaultInstallerFunc(
  _app: App,
  systemSuperuser: Record<string, unknown>,
  baseURL: string,
): Promise<void> {
  // Generate a short-lived auth token (30 minutes)
  // In the Go version, this uses `Record.NewStaticAuthToken(30 * time.Minute)`
  const token = await newStaticAuthToken(
    systemSuperuser as never,
    30 * 60 * 1000,
  )

  // Build the installer URL
  const url = `${baseURL.replace(/\/$/, '')}/_/#/pbinstall/${token}`

  console.log('\n==============================================')
  console.log('  FIRST-TIME SETUP')
  console.log('==============================================')
  console.log()
  console.log(
    `  Launch the URL below in the browser to create your first superuser account:`,
  )
  console.log()
  console.log(`  ${url}`)
  console.log()
  console.log(
    `  (Or create the first superuser by running: bun run src/index.ts superuser upsert EMAIL PASSWORD)`,
  )
  console.log()
  console.log('==============================================\n')
}

// ---------------------------------------------------------------------------
// Installer loader
// ---------------------------------------------------------------------------

/**
 * Checks whether the installer is needed and, if so, creates or finds the
 * installer superuser and calls the installer function.
 *
 * This is called automatically during `Serve()`.
 *
 * @returns `true` if the installer flow was executed, `false` otherwise.
 */
export async function loadInstaller(
  app: App,
  baseURL: string,
  installerFunc?: InstallerFunc,
): Promise<boolean> {
  if (!installerFunc) return false
  if (!needInstallerSuperuser(app)) return false

  const superuser = await findOrCreateInstallerSuperuser(app)
  await installerFunc(app, superuser, baseURL)
  return true
}

// ---------------------------------------------------------------------------
// needInstallerSuperuser
// ---------------------------------------------------------------------------

/**
 * Returns `true` if there are zero superuser records whose email is *not*
 * the default installer email — meaning no custom superuser has been
 * created yet.
 */
export function needInstallerSuperuser(_app: App): boolean {
  // In the full implementation, we would query:
  //   app.CountRecords(SuperusersCollectionName, ...where email != DEFAULT_INSTALLER_EMAIL)
  //
  // For now, we assume the installer is needed if there's no superuser
  // infrastructure yet. This check should be replaced with an actual
  // database query once the DAO layer is wired in.
  return true
}

// ---------------------------------------------------------------------------
// findOrCreateInstallerSuperuser
// ---------------------------------------------------------------------------

/**
 * Finds the installer superuser record by email, or creates one with a
 * random password if it does not exist.
 */
export async function findOrCreateInstallerSuperuser(
  _app: App,
): Promise<Record<string, unknown>> {
  // In the full implementation:
  // 1. Find collection by name (SuperusersCollectionName)
  // 2. Find auth record by email (DEFAULT_INSTALLER_EMAIL)
  // 3. If not found, create a new record with a random password
  // 4. Save the record
  // 5. Return the record
  //
  // For now, return a placeholder record with the installer email.
  return {
    id: crypto.randomUUID(),
    email: DEFAULT_INSTALLER_EMAIL,
    collection: { name: SuperusersCollectionName, id: '_superusers', isAuth: () => true },
    getString: (key: string) => key === 'email' ? DEFAULT_INSTALLER_EMAIL : '',
    collection: {
      id: '_superusers',
      name: SuperusersCollectionName,
      isAuth: () => true,
    },
  }
}

// ---------------------------------------------------------------------------
// API endpoint — installer check route
// ---------------------------------------------------------------------------

/**
 * Returns an Elysia route handler that checks whether the installer is
 * needed. This is used by the admin UI to decide whether to show the
 * setup screen.
 *
 * Route: `GET /api/installer/status`
 */
export function installerStatusHandler(app: App) {
  return async () => {
    const needed = needInstallerSuperuser(app)
    return {
      code: 200,
      data: {
        installerNeeded: needed,
        installerEmail: DEFAULT_INSTALLER_EMAIL,
      },
    }
  }
}

/**
 * Returns an Elysia route handler that creates a temporary installer
 * auth token. This is used by the admin UI installer.
 *
 * Route: `POST /api/installer/token`
 */
export function installerTokenHandler(app: App) {
  return async () => {
    const superuser = await findOrCreateInstallerSuperuser(app)
    const token = await newStaticAuthToken(
      superuser as never,
      30 * 60 * 1000, // 30 minutes
    )
    return {
      code: 200,
      data: { token },
    }
  }
}
