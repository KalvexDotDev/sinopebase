/**
 * Record API shared utilities — enrichRecord, resolveRecordRequest, checkRecordAccess.
 *
 * Port of PocketBase's apis/record_crud.go helper functions.
 * Layer 4 — imports from ~/core/*, ~/tools/*.
 */

import type { IDatabase } from '~/core/db-interface'
import type { Collection } from '~/core/collection_model'
import { Record } from '~/core/record_model'
import { canAccessRecord } from '~/core/record_query'
import { expandRecord } from '~/core/record_query_expand'
import { findAuthRecordByToken } from '~/core/record_query'
import { findCollectionByNameOrId } from '~/core/collection_query'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RequestAuthInfo {
  /** The authenticated record (if any). */
  record?: Record | null
  /** Whether the request has superuser auth. */
  isSuperuser: boolean
  /** Whether the request has collection-specific auth. */
  hasCollectionAuth: boolean
}

export interface PaginationInfo {
  page: number
  perPage: number
  skipTotal: boolean
}

// ---------------------------------------------------------------------------
// Resolve record request
// ---------------------------------------------------------------------------

/**
 * Resolves auth info from a request context.
 *
 * Extracts the Bearer token from the Authorization header and resolves
 * it to a Record. Checks if the record is a superuser.
 */
export async function resolveRecordRequest(
  db: IDatabase,
  authToken: string | undefined,
): Promise<RequestAuthInfo> {
  const info: RequestAuthInfo = {
    record: null,
    isSuperuser: false,
    hasCollectionAuth: false,
  }

  if (!authToken || !authToken.startsWith('Bearer ')) {
    return info
  }

  const token = authToken.slice(7).trim()
  if (!token) return info

  try {
    // Try to find by token — use the auth record
    // In a full implementation this would verify the JWT
    // For now, use a basic lookup approach
    const authz = await findAuthRecordByToken(db, token, '')
    if (authz) {
      info.record = authz
      info.isSuperuser = authz.collection?.name === 'superusers'
      info.hasCollectionAuth = true
    }
  } catch {
    // Token invalid — no auth
  }

  return info
}

/**
 * Checks if a record can be accessed by the current auth info.
 *
 * Evaluates the access rule against the record and auth context.
 */
export async function checkRecordAccess(
  db: IDatabase,
  record: Record,
  rule: string | null,
  authInfo: RequestAuthInfo,
): Promise<boolean> {
  // Superusers bypass all rules
  if (authInfo.isSuperuser) return true

  // null rule = no access
  if (rule === null) return false

  // empty rule = public access
  if (rule === '') return true

  return canAccessRecord(db, record, rule)
}

/**
 * Enriches a record with expand data.
 */
export async function enrichRecord(
  db: IDatabase,
  record: Record,
  expands: string[],
): Promise<void> {
  if (expands.length === 0) return

  const failed = await expandRecord(db, record, expands)
  if (failed.size > 0) {
    // Log failures but don't fail the request
    const failedKeys = [...failed.keys()]
    for (const key of failedKeys) {
      console.warn(`Enrich failed for expand "${key}":`, failed.get(key))
    }
  }
}

/**
 * Resolves pagination parameters from query string.
 */
export function parsePagination(query: Record<string, string | undefined>): PaginationInfo {
  const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1)
  const perPage = Math.min(
    1000,
    Math.max(1, parseInt(query.perPage ?? query.per_page ?? '30', 10) || 30),
  )
  const skipTotal = query.skipTotal === 'true'
  return { page, perPage, skipTotal }
}

/**
 * Resolves expand parameter from query string.
 */
export function parseExpands(query: Record<string, string | undefined>): string[] {
  const expand = query.expand ?? ''
  return expand
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Resolve collection from path params.
 */
export async function resolveCollection(
  db: IDatabase,
  collectionParam: string,
): Promise<Collection | null> {
  return findCollectionByNameOrId(
    db,
    { id: collectionParam, fields: { getByName: () => undefined, [Symbol.iterator]: function* () {} } } as unknown as Collection,
    collectionParam,
  ) as unknown as Promise<Collection | null>
}
