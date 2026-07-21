export const meta = {
  name: 'phase0-better-auth',
  description: 'Phase 0: Replace jose JWT + in-memory auth with better-auth',
  phases: [
    { title: 'Scaffold', detail: 'Create better-auth adapter, factory, bridge, types' },
    { title: 'Migrate', detail: 'Update auth routes, middleware, app.ts' },
    { title: 'Test', detail: 'Write and run tests' },
  ],
}

phase('Scaffold')

const typesResult = await agent(
  'Write D:\\Projects\\sinopebase\\src\\tools\\auth-better\\types.ts — type mappings between better-auth and Sinopebase auth types.\n' +
  'Import User and Session from ~/sdk/auth. Define BetterAuthUser interface: id, email, emailVerified, name, image, role, createdAt, updatedAt.\n' +
  'Export toSinopebaseUser(betterAuthUser): User — maps id, email, role="authenticated", aud="authenticated", app_metadata={}, user_metadata={}, created_at/updated_at as ISO strings.\n' +
  'Export toSinopebaseSession(user, accessToken, refreshToken, expiresIn): Session — access_token, token_type:"bearer", expires_in, expires_at=now+expiresIn, refresh_token, user.\n' +
  'Export toAuthResponse(user, session, error?, status?): AuthResponse. Export ACCESS_TOKEN_EXPIRES_IN=3600. Use Bun crypto.randomUUID(). Strict TypeScript.',
  { label: 'types.ts' }
)

const adapterResult = await agent(
  'Write D:\\Projects\\sinopebase\\src\\tools\\auth-better\\adapter.ts — Kysely database adapter for better-auth.\n' +
  'Import pg from "pg", Kysely and PostgresDialect from "kysely".\n' +
  'Define BetterAuthDatabase with tables: user(id,email,emailVerified,name,image,role,createdAt,updatedAt), session(id,userId,token,expiresAt,ipAddress,userAgent,createdAt,updatedAt), account(id,userId,providerId,accountId,providerUserId,accessToken,refreshToken,expiresAt,password,createdAt,updatedAt), verification(id,identifier,value,expiresAt,createdAt,updatedAt).\n' +
  'Export createBetterAuthDB(pool: pg.Pool): Kysely<BetterAuthDatabase> using new Kysely({ dialect: new PostgresDialect({ pool }) }).\n' +
  'Export createAuthTables(db) using sql`` to CREATE TABLE IF NOT EXISTS all 4 tables with PG types (varchar, boolean, timestamptz, text).\n' +
  'Strict TypeScript.',
  { label: 'adapter.ts' }
)

const factoryResult = await agent(
  'Write D:\\Projects\\sinopebase\\src\\tools\\auth-better\\index.ts — main better-auth factory for Sinopebase.\n' +
  'Import { betterAuth } from "better-auth". Import createBetterAuthDB, createAuthTables from "./adapter". Import pg from "pg".\n' +
  'Export async function createAuth(pool: pg.Pool, options?: { jwtSecret?: string }):\n' +
  '  1. const db = createBetterAuthDB(pool)\n' +
  '  2. await createAuthTables(db)\n' +
  '  3. return betterAuth({ database: db, emailAndPassword: { enabled: true }, secret: options?.jwtSecret || process.env.JWT_SECRET || "sinopebase-dev-secret-min-32-chars!", trustedOrigins: ["http://localhost:8090","http://127.0.0.1:8090"] })\n' +
  'Export type SinopebaseAuth = Awaited<ReturnType<typeof createAuth>>.\n' +
  'Export helper functions: async function signUpUser(auth, email, password) calls auth.api.signUpEmail then auth.api.signInEmail. async function signInUser(auth, email, password) calls auth.api.signInEmail. async function getSessionUser(auth, token) calls auth.api.getSession with Bearer header. async function signOutSession(auth, token) calls auth.api.signOut.\n' +
  'All helpers return raw better-auth response or null on error. Strict TypeScript.',
  { label: 'factory index.ts' }
)

const bridgeResult = await agent(
  'Write D:\\Projects\\sinopebase\\src\\tools\\auth-better\\supabase-bridge.ts — translates better-auth responses to supabase-js shapes.\n' +
  'Import User, Session, AuthResponse from ~/sdk/auth. Import toSinopebaseUser, toSinopebaseSession, toAuthResponse, ACCESS_TOKEN_EXPIRES_IN from ./types.\n' +
  'Export bridgeSignInResponse(result): AuthResponse — result has {token,user} from better-auth. If null/no-token return error. Else: convert user via toSinopebaseUser, generate refreshToken=crypto.randomUUID(), create session via toSinopebaseSession(user, result.token, refreshToken, ACCESS_TOKEN_EXPIRES_IN), return toAuthResponse(user,session).\n' +
  'Export bridgeGetUserResponse(result): {data:{user},error} — result from getSession. If null/no-user return 401 error. Else return {data:{user:toSinopebaseUser(result.user)},error:null}.\n' +
  'Export bridgeRefreshResponse(signInResult): AuthResponse — delegates to bridgeSignInResponse.\n' +
  'Export bridgeSignOutResponse(): {error:null}.\n' +
  'Export bridgeErrorResponse(message, status=400): AuthResponse. Strict TypeScript.',
  { label: 'supabase-bridge.ts' }
)

phase('Migrate')

const migrateAuthResult = await agent(
  'Read D:\\Projects\\sinopebase\\src\\apis\\auth.ts then UPDATE it.\n' +
  'CRITICAL: Keep ALL existing code (authPlugin export for in-memory mode) UNCHANGED.\n' +
  'ADD a new exported function createAuthPlugin(auth: any) after the existing authPlugin.\n' +
  'The createAuthPlugin returns a new Elysia() with the SAME routes (/auth/v1/signup, /auth/v1/token, /auth/v1/logout, /auth/v1/user) but backed by better-auth.\n' +
  'Import bridgeSignInResponse, bridgeGetUserResponse from ~/tools/auth-better/supabase-bridge.\n' +
  'For signup: await auth.api.signUpEmail({body:{email,password,name:""}}) then await auth.api.signInEmail({body:{email,password}}) then return bridgeSignInResponse(signInResult). Catch errors, return errorResponse.\n' +
  'For token?grant_type=password: await auth.api.signInEmail({body:{email,password}}) then bridgeSignInResponse.\n' +
  'For token?grant_type=refresh_token: extract refresh_token from body, use it as Bearer token to call auth.api.getSession, then return bridgeSignInResponse with the session token.\n' +
  'For logout: extract token from Authorization header, await auth.api.signOut({headers}), return {error:null}.\n' +
  'For user: extract token, await auth.api.getSession({headers:new Headers({Authorization:"Bearer "+token})}), return bridgeGetUserResponse.\n' +
  'Reuse existing sessionResponse, userResponse, errorResponse helpers from the file.',
  { label: 'auth.ts update' }
)

const migrateMiddlewareResult = await agent(
  'Read D:\\Projects\\sinopebase\\src\\apis\\middlewares.ts then ADD a new function after loadAuthToken (around line 260).\n' +
  'DO NOT modify any existing functions.\n' +
  'ADD: export function loadAuthTokenWithBetterAuth(auth: any) which returns an onRequest handler.\n' +
  'Handler: if ctx.store.auth != null return; extract Bearer token from Authorization header; if no token return;\n' +
  'try { const result = await auth.api.getSession({headers: new Headers({authorization:"Bearer "+token})});\n' +
  'if (result?.user) ctx.store.auth = { id: result.user.id, email: result.user.email, collection:"authenticated", collectionId:"authenticated", role:"authenticated" }; } catch { /* silent */ }.\n' +
  'The stored shape must match what requireAuth expects: { id, email, collection, collectionId }.',
  { label: 'middleware.ts update' }
)

const migrateAppResult = await agent(
  'Read D:\\Projects\\sinopebase\\src\\core\\app.ts and D:\\Projects\\sinopebase\\src\\core\\db-postgres.ts.\n' +
  'STEP 1: If PostgresDatabase has no getPool() method, ADD one that returns the internal pool.\n' +
  'STEP 2: Update app.ts:\n' +
  '  - Import { createAuthPlugin } from "../apis/auth" and { createAuth } from "../tools/auth-better"\n' +
  '  - Add "private auth: any = null" to Sinopebase class\n' +
  '  - In start(), after PG connect succeeds: try { const pool = pgDb.getPool(); this.auth = await createAuth(pool, {jwtSecret:this.config.jwtSecret}); console.log("Auth: better-auth initialized") } catch(e) { console.warn("Auth: fallback to in-memory", e) }\n' +
  '  - Change .use(authPlugin) to .use(this.auth ? createAuthPlugin(this.auth) : authPlugin)\n' +
  '  - Add getAuth(): any { return this.auth } method\n' +
  'Keep all existing functionality. Defensive: server must work even if better-auth init fails.',
  { label: 'app.ts update' }
)

phase('Test')

const testResult = await agent(
  'Write D:\\Projects\\sinopebase\\tests\\integration\\auth-better.test.ts — ATDD tests for better-auth backed auth endpoints.\n' +
  'Pattern: import { describe,it,expect,beforeAll,afterAll } from "bun:test"; import { Sinopebase } from "~/core/app".\n' +
  'beforeAll: create Sinopebase on port 8091, start(), baseUrl="http://127.0.0.1:8091". afterAll: stop().\n' +
  '10 test cases using fetch() and unique emails (Date.now()):\n' +
  '1. signup returns user+session (200, user.email, session.access_token, session.refresh_token, token_type="bearer", error=null)\n' +
  '2. signin with password grants session (200, valid access_token)\n' +
  '3. get user from valid token (200, data.user.email matches)\n' +
  '4. reject invalid token for /user (401)\n' +
  '5. reject duplicate email signup (400, error message)\n' +
  '6. reject wrong password (400, error message)\n' +
  '7. refresh session returns new tokens (200, new access_token)\n' +
  '8. reject missing email on signup (400)\n' +
  '9. logout succeeds (200, error=null)\n' +
  '10. reject unknown grant_type (400)\n' +
  'Assert on full response shape matching supabase-js GoTrue format.',
  { label: 'auth-better.test.ts' }
)

return { types: typesResult, adapter: adapterResult, factory: factoryResult, bridge: bridgeResult, authRoutes: migrateAuthResult, middleware: migrateMiddlewareResult, app: migrateAppResult, tests: testResult }
