/** Shared registration policy for compatibility, native, and OAuth signup. */
export function signupsAllowed(): boolean {
  if (process.env.SINOPEBASE_PRODUCTION === 'true') return process.env.ALLOW_SIGNUPS === 'true'
  return process.env.ALLOW_SIGNUPS !== 'false'
}
