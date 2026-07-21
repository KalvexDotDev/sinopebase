/**
 * Sinopebase — PocketBase-shaped backend with Supabase SDK compatibility
 *
 * @packageDocumentation
 */

// SDK — the primary public API (thin supabase-js compatible wrapper)
export { createClient } from './sdk/client'
export type { SinopebaseClient, PostgrestResponse, PostgrestError, PostgrestSingleResponse } from './sdk/client'
export type { PostgrestClient, PostgrestFilterBuilder, FilterOperator } from './sdk/database'
export type { AuthClient, User, Session, AuthResponse, AuthError, AuthChangeEvent } from './sdk/auth'
export type { StorageClient, StorageBucket, Bucket, FileObject, UploadOptions } from './sdk/storage'
export type { RealtimeClient, RealtimeChannel } from './sdk/realtime'

// Backend — exported for programmatic use (when used as a library)
export { Sinopebase } from './core/app'
