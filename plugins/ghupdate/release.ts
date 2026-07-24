/**
 * Release version parser — compares semantic versions for GitHub releases.
 *
 * Port of PocketBase's plugins/ghupdate/release.go (Go -> TypeScript).
 * Layer 5 -- zero internal dependencies.
 *
 * Handles semver comparison with optional "v" prefix support.
 */

// ---------------------------------------------------------------------------
// Semver parsing and comparison
// ---------------------------------------------------------------------------

/**
 * A parsed semantic version (major.minor.patch).
 */
export interface Semver {
  major: number
  minor: number
  patch: number
  /** Optional pre-release suffix (e.g., "alpha", "beta.1"). */
  preRelease: string
}

/**
 * Parses a version string into a Semver struct.
 *
 * Accepts formats:
 *   - "1.2.3"
 *   - "v1.2.3"
 *   - "1.2.3-beta"
 *   - "1.2.3-beta.1"
 *
 * @param version - The version string to parse.
 * @returns The parsed Semver, or null if parsing failed.
 */
export function parseSemver(version: string): Semver | null {
  let v = version.trim()

  // Strip leading 'v' or 'V'
  if (v.startsWith('v') || v.startsWith('V')) {
    v = v.slice(1)
  }

  // Split pre-release suffix
  let preRelease = ''
  const dashIdx = v.indexOf('-')
  if (dashIdx !== -1) {
    preRelease = v.slice(dashIdx + 1)
    v = v.slice(0, dashIdx)
  }

  const parts = v.split('.')
  if (parts.length < 2 || parts.length > 3) {
    return null
  }

  const major = parseInt(parts[0]!, 10)
  const minor = parseInt(parts[1]!, 10)
  const patch = parts[2] !== undefined ? parseInt(parts[2], 10) : 0

  if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
    return null
  }

  return { major, minor, patch, preRelease }
}

/**
 * Compares two semantic versions.
 *
 * @returns Negative if a < b, 0 if equal, positive if a > b.
 */
export function compareSemver(a: Semver, b: Semver): number {
  // Compare major
  if (a.major !== b.major) return a.major - b.major

  // Compare minor
  if (a.minor !== b.minor) return a.minor - b.minor

  // Compare patch
  if (a.patch !== b.patch) return a.patch - b.patch

  // Compare pre-release: no pre-release > has pre-release
  if (a.preRelease === '' && b.preRelease !== '') return 1
  if (a.preRelease !== '' && b.preRelease === '') return -1

  return a.preRelease.localeCompare(b.preRelease)
}

/**
 * Returns true if version a is greater than version b.
 */
export function isGreaterThan(a: string, b: string): boolean {
  const sa = parseSemver(a)
  const sb = parseSemver(b)
  if (!sa || !sb) return false
  return compareSemver(sa, sb) > 0
}

/**
 * Returns true if version a is less than version b.
 */
export function isLessThan(a: string, b: string): boolean {
  const sa = parseSemver(a)
  const sb = parseSemver(b)
  if (!sa || !sb) return false
  return compareSemver(sa, sb) < 0
}

/**
 * Returns true if version a is equal to version b.
 */
export function isEqual(a: string, b: string): boolean {
  const sa = parseSemver(a)
  const sb = parseSemver(b)
  if (!sa || !sb) return false
  return compareSemver(sa, sb) === 0
}

// ---------------------------------------------------------------------------
// GitHub Release info
// ---------------------------------------------------------------------------

/**
 * Represents a GitHub release fetched from the API.
 */
export interface GitHubRelease {
  /** The tag name (e.g., "v0.23.0"). */
  tagName: string

  /** Parsed semver from the tag name. */
  semver: Semver | null

  /** The release title. */
  name: string

  /** Whether this is a pre-release. */
  prerelease: boolean

  /** The HTML URL of the release. */
  htmlUrl: string

  /** Release body / changelog. */
  body: string

  /** When the release was published. */
  publishedAt: string
}

/**
 * Fetches the latest GitHub release for a repository.
 *
 * @param owner - Repository owner (e.g., "sinopebase").
 * @param repo - Repository name (e.g., "sinopebase").
 * @returns The latest release, or null if not found.
 */
export async function fetchLatestRelease(
  owner: string,
  repo: string,
): Promise<GitHubRelease | null> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/latest`

  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Sinopebase',
    },
  })

  if (!response.ok) {
    console.warn(`[ghupdate] GitHub API returned ${response.status}: ${response.statusText}`)
    return null
  }

  const data = (await response.json()) as Record<string, unknown>

  const tagName = String(data['tag_name'] ?? '')
  const parsed = parseSemver(tagName)

  return {
    tagName,
    semver: parsed,
    name: String(data['name'] ?? ''),
    prerelease: data['prerelease'] === true,
    htmlUrl: String(data['html_url'] ?? ''),
    body: String(data['body'] ?? ''),
    publishedAt: String(data['published_at'] ?? ''),
  }
}
