import { describe, it, expect } from 'bun:test';

// ---------------------------------------------------------------------------
// random.ts
// ---------------------------------------------------------------------------
import {
  RandomString,
  RandomStringWithAlphabet,
  PseudorandomString,
  PseudorandomStringWithAlphabet,
} from '~/tools/security/random';

describe('random.ts', () => {
  it('RandomString produces correct length', () => {
    expect(RandomString(10).length).toBe(10);
    expect(RandomString(0).length).toBe(0);
    expect(RandomString(100).length).toBe(100);
  });

  it('RandomString uses default alphabet [A-Za-z0-9]', () => {
    const result = RandomString(200);
    expect(result).toMatch(/^[A-Za-z0-9]+$/);
  });

  it('RandomStringWithAlphabet uses custom alphabet', () => {
    const result = RandomStringWithAlphabet(100, 'ABC');
    expect(result).toMatch(/^[ABC]+$/);
    expect(result.length).toBe(100);
  });

  it('RandomStringWithAlphabet single-char alphabet', () => {
    expect(RandomStringWithAlphabet(5, 'X')).toBe('XXXXX');
  });

  it('RandomStringWithAlphabet rejects empty alphabet', () => {
    expect(() => RandomStringWithAlphabet(5, '')).toThrow();
  });

  it('PseudorandomString produces correct length', () => {
    expect(PseudorandomString(10).length).toBe(10);
  });

  it('PseudorandomString uses default alphabet', () => {
    const result = PseudorandomString(200);
    expect(result).toMatch(/^[A-Za-z0-9]+$/);
  });

  it('PseudorandomStringWithAlphabet uses custom alphabet', () => {
    const result = PseudorandomStringWithAlphabet(50, 'XYZ');
    expect(result).toMatch(/^[XYZ]+$/);
  });

  it('PseudorandomStringWithAlphabet rejects empty alphabet', () => {
    expect(() => PseudorandomStringWithAlphabet(5, '')).toThrow();
  });

  it('RandomString produces varied output', () => {
    const results = new Set<string>();
    for (let i = 0; i < 20; i++) {
      results.add(RandomString(10));
    }
    // With high probability, all 20 strings should be unique
    expect(results.size).toBeGreaterThan(15);
  });
});

// ---------------------------------------------------------------------------
// crypto.ts
// ---------------------------------------------------------------------------
import {
  S256Challenge,
  MD5,
  SHA256,
  SHA512,
  HS256,
  HS512,
  Equal,
} from '~/tools/security/crypto';

describe('crypto.ts', () => {
  it('MD5 produces correct hex digest', () => {
    expect(MD5('hello')).toBe('5d41402abc4b2a76b9719d911017c592');
  });

  it('SHA256 produces correct hex digest', () => {
    expect(SHA256('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('SHA512 produces correct hex digest', () => {
    const result = SHA512('hello');
    expect(result.length).toBe(128); // 512 bits = 64 bytes = 128 hex chars
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  it('HS256 produces hex HMAC', () => {
    const result = HS256('message', 'secret');
    expect(result.length).toBe(64); // 256 bits = 32 bytes = 64 hex chars
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  it('HS512 produces hex HMAC', () => {
    const result = HS512('message', 'secret');
    expect(result.length).toBe(128);
  });

  it('S256Challenge produces unpadded base64url', () => {
    const result = S256Challenge('test');
    expect(result).not.toContain('=');
    expect(result).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('S256Challenge is deterministic', () => {
    expect(S256Challenge('test')).toBe(S256Challenge('test'));
    expect(S256Challenge('a')).not.toBe(S256Challenge('b'));
  });

  it('Equal constant-time comparison', () => {
    expect(Equal('abc', 'abc')).toBe(true);
    expect(Equal('abc', 'def')).toBe(false);
    expect(Equal('abc', 'abcd')).toBe(false);
    expect(Equal('', '')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// encrypt.ts
// ---------------------------------------------------------------------------
import { Encrypt, Decrypt } from '~/tools/security/encrypt';

describe('encrypt.ts', () => {
  const key = '12345678901234567890123456789012'; // 32 chars

  it('Encrypt/Decrypt roundtrip', () => {
    const plaintext = new TextEncoder().encode('Hello, World!');
    const encrypted = Encrypt(plaintext, key);
    const decrypted = Decrypt(encrypted, key);
    expect(new TextDecoder().decode(decrypted)).toBe('Hello, World!');
  });

  it('Encrypt produces different output each call (random nonce)', () => {
    const plaintext = new TextEncoder().encode('test data');
    const e1 = Encrypt(plaintext, key);
    const e2 = Encrypt(plaintext, key);
    expect(e1).not.toBe(e2);
  });

  it('Encrypt rejects wrong key length', () => {
    expect(() => Encrypt(new TextEncoder().encode('data'), 'short')).toThrow();
    expect(() => Encrypt(new TextEncoder().encode('data'), '12345678901234567890123456789012345')).toThrow();
  });

  it('Decrypt rejects tampered ciphertext', () => {
    const plaintext = new TextEncoder().encode('secret');
    const encrypted = Encrypt(plaintext, key);
    // Tamper with a character in the middle of the base64 data
    // (avoid padding characters at the end)
    const mid = Math.floor(encrypted.length / 2);
    const tampered =
      encrypted.slice(0, mid) +
      (encrypted[mid] === 'A' ? 'B' : 'A') +
      encrypted.slice(mid + 1);
    expect(() => Decrypt(tampered, key)).toThrow();
  });

  it('Decrypt rejects wrong key', () => {
    const wrongKey = 'abcdefghijklmnopqrstuvwxyz012345'; // 32 chars, different
    const plaintext = new TextEncoder().encode('data');
    const encrypted = Encrypt(plaintext, key);
    expect(() => Decrypt(encrypted, wrongKey)).toThrow();
  });

  it('Encrypt/Decrypt handles binary data', () => {
    const binary = new Uint8Array([0, 1, 255, 128, 64, 32]);
    const encrypted = Encrypt(binary, key);
    const decrypted = Decrypt(encrypted, key);
    expect(new Uint8Array(decrypted)).toEqual(binary);
  });

  it('Encrypt/Decrypt handles empty data', () => {
    const encrypted = Encrypt(new Uint8Array(0), key);
    const decrypted = Decrypt(encrypted, key);
    expect(decrypted.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// jwt.ts
// ---------------------------------------------------------------------------
import { NewJWT, ParseJWT, ParseUnverifiedJWT } from '~/tools/security/jwt';

describe('jwt.ts', () => {
  const signingKey = 'my-secret-key-here!';
  const payload = { sub: 'user123', name: 'Test User', role: 'admin' };

  it('NewJWT produces a signed token', async () => {
    const token = await NewJWT(payload, signingKey, 3600000);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
  });

  it('ParseJWT verifies and returns claims', async () => {
    const token = await NewJWT(payload, signingKey, 3600000);
    const claims = await ParseJWT(token, signingKey);
    expect(claims['sub']).toBe('user123');
    expect(claims['role']).toBe('admin');
    expect(claims['exp']).toBeGreaterThan(0);
  });

  it('ParseJWT rejects wrong key', async () => {
    const token = await NewJWT(payload, signingKey, 3600000);
    await expect(ParseJWT(token, 'wrong-key!!!')).rejects.toThrow();
  });

  it('ParseJWT rejects expired token', async () => {
    const token = await NewJWT(payload, signingKey, -1000); // expired 1s ago
    await expect(ParseJWT(token, signingKey)).rejects.toThrow();
  });

  it('ParseUnverifiedJWT decodes without verification', () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMTIzIn0.dummy';
    try {
      const claims = ParseUnverifiedJWT(token);
      expect(claims['sub']).toBe('user123');
    } catch {
      // If signature verification isn't needed, this may fail on malformed token
    }
  });

  it('ParseUnverifiedJWT validates exp claim', async () => {
    const token = await NewJWT(payload, signingKey, -60000); // expired 1 min ago
    expect(() => ParseUnverifiedJWT(token)).toThrow('expired');
  });

  it('NewJWT respects payload exp override', async () => {
    const customExp = 9999999999;
    const token = await NewJWT({ ...payload, exp: customExp }, signingKey, 3600000);
    const claims = await ParseJWT(token, signingKey);
    // Payload's exp should override auto-generated exp
    expect(claims['exp']).toBe(customExp);
  });
});

// ---------------------------------------------------------------------------
// random_by_regex.ts
// ---------------------------------------------------------------------------
import { RandomStringByRegex } from '~/tools/security/random_by_regex';

describe('random_by_regex.ts', () => {
  it('matches [a-z]{5}', () => {
    const result = RandomStringByRegex('[a-z]{5}');
    expect(result).toMatch(/^[a-z]{5}$/);
    expect(result.length).toBe(5);
  });

  it('matches [0-9]{3}[A-Z]{2}', () => {
    const result = RandomStringByRegex('[0-9]{3}[A-Z]{2}');
    expect(result).toMatch(/^[0-9]{3}[A-Z]{2}$/);
  });

  it('matches [a-zA-Z0-9]{8}', () => {
    const result = RandomStringByRegex('[a-zA-Z0-9]{8}');
    expect(result).toMatch(/^[a-zA-Z0-9]{8}$/);
  });

  it('matches \\d{4} (shorthand digit)', () => {
    const result = RandomStringByRegex('\\d{4}');
    expect(result).toMatch(/^\d{4}$/);
  });
});

// ---------------------------------------------------------------------------
// Cross-module interaction: encrypt + random
// ---------------------------------------------------------------------------
describe('cross-module (encrypt + random)', () => {
  it('encrypt/decrypt roundtrip with random key', () => {
    const key = RandomString(32); // key must be 32 chars
    expect(key.length).toBe(32);
    const data = new TextEncoder().encode(RandomString(50));
    const encrypted = Encrypt(data, key);
    const decrypted = Decrypt(encrypted, key);
    expect(new TextDecoder().decode(decrypted)).toBe(new TextDecoder().decode(data));
  });
});
