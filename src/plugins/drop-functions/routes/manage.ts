// ---------------------------------------------------------------------------
// DropFunctions — Function CRUD management endpoints
// Superuser-only routes for listing, creating, updating, deleting functions.
// ---------------------------------------------------------------------------

import { Elysia } from 'elysia'
import { existsSync, readFileSync, writeFileSync, unlinkSync, renameSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { resolve, basename } from 'node:path'

/**
 * Create the function management route group (superuser-only).
 */
export function createManageRoutes(functionsDir: string) {
  // Ensure the directory exists
  if (!existsSync(functionsDir)) {
    mkdirSync(functionsDir, { recursive: true })
  }

  return new Elysia()
    // List all functions
    .get('/api/functions/v1', () => {
      const files = readFunctionFiles(functionsDir)
      return { data: files, count: files.length }
    })

    // Get a specific function's source (separate path to avoid collision with execute)
    .get('/api/functions/v1/:name/source', ({ params, set }) => {
      const filePath = findFunctionFile(functionsDir, params.name)
      if (!filePath) {
        set.status = 404
        return { error: `Function "${params.name}" not found`, status: 404 }
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
    .post('/api/functions/v1', ({ body, set }) => {
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
    .patch('/api/functions/v1/:name', ({ params, body, set }) => {
      const filePath = findFunctionFile(functionsDir, params.name)
      if (!filePath) {
        set.status = 404
        return { error: `Function "${params.name}" not found`, status: 404 }
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

      return { message: `Function "${params.name}" updated` }
    })

    // Delete a function
    .delete('/api/functions/v1/:name', ({ params, set }) => {
      const filePath = findFunctionFile(functionsDir, params.name)
      if (!filePath) {
        set.status = 404
        return { error: `Function "${params.name}" not found`, status: 404 }
      }

      unlinkSync(filePath)
      return { message: `Function "${params.name}" deleted` }
    })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findFunctionFile(dir: string, name: string): string | null {
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
    files.push({
      name: match[1]!,
      path: fullPath,
      size: stat.size,
    })
  }

  return files
}
