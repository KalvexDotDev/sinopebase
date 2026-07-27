// ---------------------------------------------------------------------------
// DropFunctions — Function CRUD management endpoints
// Auth-required routes for listing, creating, updating, deleting functions.
// ---------------------------------------------------------------------------

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, resolve } from 'node:path'
import { Elysia } from 'elysia'
import { extractBearerToken, validateFunctionAuth } from '../middleware'

/**
 * Create the function management route group (auth-required).
 *
 * @param functionsDir Directory containing function files
 * @param auth          better-auth instance (null in dev/in-memory mode)
 * @param prefix        Route prefix (default: /api/functions/v1)
 */
export function createManageRoutes(
  functionsDir: string,
  auth: unknown,
  prefix = '/api/functions/v1',
) {
  // Ensure the directory exists
  if (!existsSync(functionsDir)) {
    mkdirSync(functionsDir, { recursive: true })
  }

  return (
    new Elysia()
      // List all functions
      .get(prefix, async ({ request, set }) => {
        if (auth) {
          const token = extractBearerToken(request)
          const user = await validateFunctionAuth(auth, token)
          if (!user) {
            set.status = 401
            return { error: 'Authentication required', status: 401 }
          }
        }
        const files = readFunctionFiles(functionsDir)
        return { data: files, count: files.length }
      })

      // Get a specific function's source (separate path to avoid collision with execute)
      .get(`${prefix}/:name/source`, ({ params, set }) => {
        const filePath = findFunctionFile(functionsDir, (params as { name: string }).name)
        if (!filePath) {
          set.status = 404
          return { error: `Function "${(params as { name: string }).name}" not found`, status: 404 }
        }
        const source = readFileSync(filePath, 'utf-8')
        return {
          data: {
            name: basename(filePath, filePath.endsWith('.ts') ? '.ts' : '.js'),
            source,
            path: filePath,
          },
        }
      })

      // Create a new function
      .post(prefix, ({ body, set }) => {
        const { name, source } = body as { name?: string; source?: string }
        if (!name || !source) {
          set.status = 400
          return { error: 'name and source are required', status: 400 }
        }

        // Sanitize name — only alphanumeric, hyphens, underscores
        const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, '')
        if (!sanitized) {
          set.status = 400
          return { error: 'Invalid function name', status: 400 }
        }

        const filePath = resolve(functionsDir, `${sanitized}.ts`)
        if (existsSync(filePath)) {
          set.status = 409
          return { error: `Function "${sanitized}" already exists`, status: 409 }
        }

        writeFileSync(filePath, source, 'utf-8')
        return {
          data: { name: sanitized, path: filePath },
          message: `Function "${sanitized}" created`,
        }
      })

      // Update a function
      .patch(`${prefix}/:name`, ({ params, body, set }) => {
        const filePath = findFunctionFile(functionsDir, (params as { name: string }).name)
        if (!filePath) {
          set.status = 404
          return { error: `Function "${(params as { name: string }).name}" not found`, status: 404 }
        }

        const { source, rename } = body as { source?: string; rename?: string }

        if (source) {
          writeFileSync(filePath, source, 'utf-8')
        }

        if (rename) {
          const sanitized = rename.replace(/[^a-zA-Z0-9_-]/g, '')
          const newPath = resolve(functionsDir, `${sanitized}.ts`)
          if (existsSync(newPath) && newPath !== filePath) {
            set.status = 409
            return { error: `Function "${sanitized}" already exists`, status: 409 }
          }
          renameSync(filePath, newPath)
          return {
            data: { name: sanitized, path: newPath },
            message: `Function renamed to "${sanitized}"`,
          }
        }

        return { message: `Function "${(params as { name: string }).name}" updated` }
      })

      // Delete a function
      .delete(`${prefix}/:name`, ({ params, set }) => {
        const filePath = findFunctionFile(functionsDir, (params as { name: string }).name)
        if (!filePath) {
          set.status = 404
          return { error: `Function "${(params as { name: string }).name}" not found`, status: 404 }
        }

        unlinkSync(filePath)
        return { message: `Function "${(params as { name: string }).name}" deleted` }
      })
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findFunctionFile(dir: string, name: string): string | null {
  // Prevent path traversal attacks
  if (name.includes('..') || name.includes('/') || name.includes('\\')) return null
  for (const ext of ['.ts', '.js']) {
    const candidate = resolve(dir, name + ext)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function readFunctionFiles(dir: string): Array<{ name: string; path: string; size: number }> {
  if (!existsSync(dir)) return []

  const files: Array<{ name: string; path: string; size: number }> = []
  for (const entry of readdirSync(dir)) {
    const fullPath = resolve(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) continue
    if (entry.startsWith('_')) continue // disabled
    const match = entry.match(/^(.+)\.(ts|js)$/)
    if (!match) continue
    const name = match[1]
    if (!name) continue
    files.push({
      name,
      path: fullPath,
      size: stat.size,
    })
  }

  return files
}
