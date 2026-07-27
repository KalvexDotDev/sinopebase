/**
 * Sinopebase — PocketBase-shaped backend with Supabase SDK compatibility
 *
 * @packageDocumentation
 */

// Backend — exported for programmatic use (when used as a library)
export { Sinopebase } from './core/app'
export type {
  AuthChangeEvent,
  AuthClient,
  AuthError,
  AuthResponse,
  Session,
  User,
} from './sdk/auth'
export type {
  PostgrestError,
  PostgrestResponse,
  PostgrestSingleResponse,
  SinopebaseClient,
} from './sdk/client'
// SDK — the primary public API (thin supabase-js compatible wrapper)
export { createClient } from './sdk/client'
export type { FilterOperator, PostgrestClient, PostgrestFilterBuilder } from './sdk/database'
export type { FunctionInvokeOptions, FunctionResponse, FunctionsClient } from './sdk/functions'
export type { RealtimeChannel, RealtimeClient } from './sdk/realtime'
export type { Bucket, FileObject, StorageBucket, StorageClient, UploadOptions } from './sdk/storage'
