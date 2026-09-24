/** Closed signup applies to every public identity provider at process startup. */
export function signupsAllowed(): boolean {
  if (process.env.SINOPEBASE_PRODUCTION === 'true') return process.env.ALLOW_SIGNUPS === 'true'
  return process.env.ALLOW_SIGNUPS !== 'false'
}
