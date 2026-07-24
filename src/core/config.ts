/**
 * Sinopebase Zod-validated Production Config
 *
 * Central config schema for production deployments.
 * Development mode falls back to current defaults (in-memory db, local file store).
 */
import { z } from 'zod'

export const ProductionConfig = z.object({
  postgresUrl: z.string().url(),
  jwtSecret: z.string().min(32),
  serviceRoleKey: z.string().min(32),
  anonKey: z.string().min(32),
  port: z.number().int().min(1).max(65535).default(8090),
  host: z.string().default('0.0.0.0'),
  tls: z.object({ cert: z.string(), key: z.string() }).optional(),
  s3Endpoint: z.string().optional(),
  s3AccessKey: z.string().optional(),
  s3SecretKey: z.string().optional(),
  oauthProviders: z
    .array(
      z.object({
        providerId: z.string(),
        clientId: z.string(),
        clientSecret: z.string(),
        tenantId: z.string().optional(),
        issuer: z.string().optional(),
      }),
    )
    .default([]),
  extraOrigins: z.array(z.string()).default([]),
  openaiApiKey: z.string().optional(),
  mastraRequireAuth: z.boolean().default(true),
  dataDir: z.string().default('./pb_data'),
  trustedProxies: z.array(z.string()).default([]),
})

export type ValidatedConfig = z.infer<typeof ProductionConfig>

/**
 * Detect the runtime mode.
 *
 * Checks `NODE_ENV` first, then `SINOPEBASE_PRODUCTION`.
 * Returns `'development'` when neither indicates production.
 */
export function detectMode(): 'production' | 'development' {
  if (process.env['NODE_ENV'] === 'production') return 'production'
  if (process.env['SINOPEBASE_PRODUCTION'] === 'true') return 'production'
  return 'development'
}
