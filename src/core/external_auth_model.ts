/**
 * ExternalAuth model for OAuth2 provider links.
 *
 * Port of PocketBase's models/external_auth.go (Go -> TypeScript).
 *
 * ExternalAuth represents a link between an auth record and an
 * external OAuth2 provider (Google, GitHub, etc.).
 */

import { BaseModel } from './db_model'
import { DateTime } from '~/tools/types/datetime'

/**
 * ExternalAuth represents an external OAuth2 provider link.
 */
export class ExternalAuth extends BaseModel {
  /** The linked auth collection id. */
  collectionId = ''

  /** The linked auth record id. */
  recordId = ''

  /** The OAuth2 provider name (google, github, etc.). */
  provider = ''

  /** The external provider user id. */
  providerId = ''

  /** The email address from the external provider. */
  email = ''

  /** The avatar URL from the external provider. */
  avatarUrl = ''

  /** Raw access token data from the provider. */
  rawAccessToken = ''

  /** The timestamp when the token was created. */
  tokenCreatedAt: DateTime = new DateTime(null)

  /** The timestamp when the token was refreshed. */
  tokenUpdatedAt: DateTime = new DateTime(null)

  /** The timestamp when the token expires. */
  tokenExpiresAt: DateTime = new DateTime(null)

  /** The refresh token (if provided by the provider). */
  refreshToken = ''

  override tableName(): string {
    return '_externalAuths'
  }
}
