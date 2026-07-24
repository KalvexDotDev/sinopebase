/**
 * AppleClientSecretCreate — generate Apple OAuth2 client secret JWT.
 *
 * Port of PocketBase forms/apple_client_secret_create.go (MIT license).
 * Layer 3 — imports from ~/tools/* and ~/core/* (validation via TypeBox).
 *
 * Generates an ES256-signed JWT for "Sign in with Apple".
 * Reference: https://developer.apple.com/documentation/sign_in_with_apple/generate_and_validate_tokens
 */

import { Type } from '@sinclair/typebox';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Private key regex pattern — matches PEM-encoded private keys. */
const privateKeyRegex =
  /-----BEGIN PRIVATE KEY-----\s[\s\S]+?-----END PRIVATE KEY-----/;

/** Maximum allowed duration in seconds (~6 months). */
const maxDuration = 15777000;

type AppleClientSecretCreateErrors = {
  clientId?: string;
  teamId?: string;
  keyId?: string;
  privateKey?: string;
  duration?: string;
};

// ---------------------------------------------------------------------------
// AppleClientSecretCreate form
// ---------------------------------------------------------------------------

/**
 * AppleClientSecretCreate form data and validation.
 */
export class AppleClientSecretCreate {
  /** The identifier of your app (Service ID). */
  clientId = '';

  /** 10-character Team ID from your Apple Developer account. */
  teamId = '';

  /** 10-character Key ID for the "Sign in with Apple" private key. */
  keyId = '';

  /** Private key (PEM format: -----BEGIN PRIVATE KEY----- ...). */
  privateKey = '';

  /** How long the JWT should be valid (seconds, max 15777000). */
  duration = 0;

  /**
   * TypeBox schema for validation.
   */
  static schema = Type.Object({
    clientId: Type.String({ minLength: 1 }),
    teamId: Type.String({ minLength: 10, maxLength: 10 }),
    keyId: Type.String({ minLength: 10, maxLength: 10 }),
    privateKey: Type.String({ minLength: 1, pattern: privateKeyRegex.source }),
    duration: Type.Integer({ minimum: 1, maximum: maxDuration }),
  });

  /**
   * Validates the form data.
   *
   * Returns null if valid, or a map of field → error message.
   */
  validate(): AppleClientSecretCreateErrors | null {
    const errors: AppleClientSecretCreateErrors = {};

    if (!this.clientId) {
      errors.clientId = 'Client ID is required';
    }

    if (!this.teamId) {
      errors.teamId = 'Team ID is required';
    } else if (this.teamId.length !== 10) {
      errors.teamId = 'Team ID must be exactly 10 characters';
    }

    if (!this.keyId) {
      errors.keyId = 'Key ID is required';
    } else if (this.keyId.length !== 10) {
      errors.keyId = 'Key ID must be exactly 10 characters';
    }

    if (!this.privateKey) {
      errors.privateKey = 'Private key is required';
    } else if (!privateKeyRegex.test(this.privateKey.trim())) {
      errors.privateKey =
        'Private key must be a valid PEM-encoded EC private key';
    }

    if (this.duration === null || this.duration === undefined || this.duration < 1) {
      errors.duration = 'Duration must be at least 1 second';
    } else if (this.duration > maxDuration) {
      errors.duration = `Duration must not exceed ${maxDuration} seconds (~6 months)`;
    }

    return Object.keys(errors).length > 0 ? errors : null;
  }

  /**
   * Submits the form: validates data and generates the Apple client secret JWT.
   *
   * @returns The signed JWT string, or a ValidationError list.
   */
  async submit(): Promise<{ token: string } | AppleClientSecretCreateErrors> {
    const errors = this.validate();
    if (errors) return errors;

    try {
      const token = await this.generateClientSecret();
      return { token };
    } catch (err) {
      return {
        privateKey: `Failed to generate client secret: ${(err as Error).message}`,
      };
    }
  }

  /**
   * Generates the Apple Client Secret JWT using ES256 and the Web Crypto API.
   *
   * The JWT claims:
   *   - aud: https://appleid.apple.com
   *   - sub: clientId (Service ID)
   *   - iss: teamId
   *   - iat: now
   *   - exp: now + duration
   *   - header.kid: keyId
   */
  protected async generateClientSecret(): Promise<string> {
    // Import the EC private key
    const pemData = this.privateKey.trim();
    const pemBody = pemData
      .replace(/-----BEGIN PRIVATE KEY-----/g, '')
      .replace(/-----END PRIVATE KEY-----/g, '')
      .replace(/\s/g, '');

    const rawKey = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8',
      rawKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );

    // Build JWT header and payload
    const header = {
      alg: 'ES256',
      kid: this.keyId,
      typ: 'JWT',
    };

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: this.teamId,
      sub: this.clientId,
      aud: 'https://appleid.apple.com',
      iat: now,
      exp: now + this.duration,
    };

    // Encode header and payload
    const encoder = new TextEncoder();
    const headerB64 = this.base64urlEncode(
      encoder.encode(JSON.stringify(header)),
    );
    const payloadB64 = this.base64urlEncode(
      encoder.encode(JSON.stringify(payload)),
    );

    // Sign
    const signingInput = `${headerB64}.${payloadB64}`;
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: { name: 'SHA-256' } },
      cryptoKey,
      encoder.encode(signingInput),
    );

    // ECDSA signature from Web Crypto is in IEEE P1363 format (r||s).
    // Apple expects it as raw r||s (which is the same format as P1363
    // for P-256 where r and s are each 32 bytes).
    const sigB64 = this.base64urlEncode(new Uint8Array(signature));

    return `${signingInput}.${sigB64}`;
  }

  /**
   * Base64url-encode a Uint8Array (no padding).
   */
  protected base64urlEncode(data: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < data.length; i++) {
      binary += String.fromCharCode(data[i]!);
    }
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
}
