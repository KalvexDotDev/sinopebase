/**
 * Record expand operations — eager-load related records.
 *
 * Port of PocketBase's core/record_query_expand.go (Go -> TypeScript).
 * Layer 2 — imports from ~/core/* and ~/tools/*.
 */

import type { IDatabase } from '~/core/db-interface.ts'
import type { Collection } from '~/core/collection_model.ts'
import { Record } from '~/core/record_model.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum nesting level for expand operations. */
const MaxNestedRels = 6

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Function used to fetch expanded relation records.
 */
export type ExpandFetchFunc = (
  relCollection: Collection,
  relIds: string[],
) => Promise<Record[]>

// ---------------------------------------------------------------------------
// Expand Functions
// ---------------------------------------------------------------------------

/**
 * Expands the relations of a single Record model.
 *
 * If `fetchFunc` is not provided, a default function is used
 * that fetches all relation records by their ids.
 *
 * Returns a map with the failed expand parameters and their errors.
 *
 * Equivalent to PocketBase's `App.ExpandRecord()`.
 */
export async function expandRecord(
  db: IDatabase,
  record: Record,
  expands: string[],
  fetchFunc?: ExpandFetchFunc,
): Promise<Map<string, Error>> {
  return expandRecords(db, [record], expands, fetchFunc)
}

/**
 * Expands the relations of multiple Record models.
 *
 * Returns a map with the failed expand parameters and their errors.
 *
 * Equivalent to PocketBase's `App.ExpandRecords()`.
 */
export async function expandRecords(
  db: IDatabase,
  records: Record[],
  expands: string[],
  fetchFunc?: ExpandFetchFunc,
): Promise<Map<string, Error>> {
  const normalized = normalizeExpands(expands)
  const failed = new Map<string, Error>()

  for (const expand of normalized) {
    try {
      await expandRecordsInternal(db, records, expand, fetchFunc, 1)
    } catch (err) {
      failed.set(expand, err instanceof Error ? err : new Error(String(err)))
    }
  }

  return failed
}

// ---------------------------------------------------------------------------
// Internal expand implementation
// ---------------------------------------------------------------------------

/**
 * Internal recursive expand implementation.
 */
async function expandRecordsInternal(
  db: IDatabase,
  records: Record[],
  expandPath: string,
  fetchFunc?: ExpandFetchFunc,
  recursionLevel: number = 1,
): Promise<void> {
  if (!expandPath || recursionLevel > MaxNestedRels || records.length === 0) {
    return
  }

  const mainCollection = records[0]!.collection
  const parts = expandPath.split('.')
  const currentPart = parts[0]!
  const remainingParts = parts.slice(1).join('.')

  // Check for indirect expand (via _via_ syntax)
  const indirectMatch = currentPart.match(/^(\w+)_via_(\w+)$/)

  if (indirectMatch) {
    await expandIndirectRelation(db, records, currentPart, indirectMatch[1]!, indirectMatch[2]!, mainCollection, remainingParts, fetchFunc, recursionLevel)
  } else {
    await expandDirectRelation(db, records, currentPart, mainCollection, remainingParts, fetchFunc, recursionLevel)
  }
}

/**
 * Expands a direct relation field.
 */
async function expandDirectRelation(
  db: IDatabase,
  records: Record[],
  fieldName: string,
  mainCollection: Collection,
  remainingParts: string,
  fetchFunc?: ExpandFetchFunc,
  recursionLevel: number = 1,
): Promise<void> {
  const field = mainCollection.fields.getByName(fieldName)
  if (!field || field.type !== 'relation') {
    throw new Error(`couldn't find relation field "${fieldName}" in collection "${mainCollection.name}"`)
  }

  const relField = field as Record<string, unknown>
  const relCollectionId = String(relField.collectionId ?? '')

  // We need a function to resolve the collection by id
  // For now, this is a stub — the actual collection resolution needs access to the app or collection cache
  const relCollection = null as Collection | null

  if (!relCollection) {
    throw new Error(`couldn't find related collection for field "${fieldName}"`)
  }

  // Collect unique relation ids
  const relIds = collectRelationIds(records, fieldName)
  if (relIds.length === 0) return

  // Fetch related records
  const defaultFetch: ExpandFetchFunc = async (_relCollection, _relIds) => {
    const { findRecordsByIds } = await import('~/core/record_query.ts')
    return findRecordsByIds(db, _relCollection, _relIds)
  }

  const fetch = fetchFunc ?? defaultFetch
  const rels = await fetch(relCollection, relIds)

  // Recursively expand deeper levels
  if (remainingParts) {
    await expandRecordsInternal(db, rels, remainingParts, fetchFunc, recursionLevel + 1)
  }

  // Index related records by id
  const indexedRels = new Map<string, Record>()
  for (const rel of rels) {
    indexedRels.set(rel.id, rel)
  }

  // Assign expand data to each record
  for (const record of records) {
    const recordRelIds = record.getStringSlice(fieldName)
    const validRels = recordRelIds
      .map((id) => indexedRels.get(id))
      .filter((r): r is Record => r !== undefined)

    if (validRels.length === 0) continue

    const isMultiple = relField.maxSelect !== 1
    const expandData = record.expandData()

    if (isMultiple) {
      expandData[fieldName] = validRels
    } else {
      expandData[fieldName] = validRels[0]!
    }

    record.setExpand(expandData)
  }
}

/**
 * Expands an indirect (back-relation) field using `_via_` syntax.
 *
 * Example: `articles_via_author` loads articles where author = record.id
 */
async function expandIndirectRelation(
  _db: IDatabase,
  _records: Record[],
  _expandName: string,
  _relCollectionName: string,
  _relFieldName: string,
  _mainCollection: Collection,
  _remainingParts: string,
  _fetchFunc?: ExpandFetchFunc,
  _recursionLevel: number = 1,
): Promise<void> {
  // TODO: Implement indirect (back-relation) expand
  // This requires resolving the related collection and performing a reverse lookup
  throw new Error('indirect expand (via) is not yet implemented')
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collects unique relation ids from records for the given field.
 */
function collectRelationIds(records: Record[], fieldName: string): string[] {
  const idSet = new Set<string>()
  for (const record of records) {
    const ids = record.getStringSlice(fieldName)
    for (const id of ids) {
      if (id) idSet.add(id)
    }
  }
  return [...idSet]
}

/**
 * Normalizes expand paths: removes whitespace, deduplicates,
 * and removes paths that are subsumed by more specific ones.
 *
 * For example, if both "author" and "author.name" are requested,
 * "author" covers all sub-paths so "author.name" is redundant.
 *
 * Equivalent to PocketBase's `normalizeExpands()`.
 */
export function normalizeExpands(paths: string[]): string[] {
  // Remove null/undefined, whitespace, and empty entries
  const normalized: string[] = []
  for (const p of paths) {
    if (p == null) continue
    const cleaned = String(p).replace(/\s+/g, '').replace(/^\.+|\.+$/g, '')
    if (cleaned) {
      normalized.push(cleaned)
    }
  }

  // Deduplicate
  const unique = [...new Set(normalized)]

  // Remove subsumed paths: a path is subsumed if another path is a prefix
  // followed by a dot (i.e., "author" subsumes "author.name")
  const result: string[] = []
  for (let i = 0; i < unique.length; i++) {
    let subsumed = false
    for (let j = 0; j < unique.length; j++) {
      if (i === j) continue
      // If unique[j] is a prefix of unique[i], then unique[i] is subsumed
      if (unique[j] !== undefined && unique[i] !== undefined && unique[i]!.startsWith(unique[j]! + '.')) {
        subsumed = true
        break
      }
    }
    if (!subsumed) {
      result.push(unique[i]!)
    }
  }

  return result
}
