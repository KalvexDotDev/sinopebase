import { describe, it, expect } from 'bun:test';
import { AppleClientSecretCreate } from './apple_client_secret_create';

describe('AppleClientSecretCreate', () => {
  it('validates required fields', () => {
    const form = new AppleClientSecretCreate();
    const errors = form.validate();

    expect(errors).not.toBeNull();
    expect(errors!.clientId).toBeDefined();
    expect(errors!.teamId).toBeDefined();
    expect(errors!.keyId).toBeDefined();
    expect(errors!.privateKey).toBeDefined();
    expect(errors!.duration).toBeDefined();
  });

  it('validates teamId length', () => {
    const form = new AppleClientSecretCreate();
    form.teamId = 'short';
    const errors = form.validate();

    expect(errors).not.toBeNull();
    expect(errors!.teamId).toContain('10 characters');
  });

  it('validates keyId length', () => {
    const form = new AppleClientSecretCreate();
    form.keyId = 'short';
    const errors = form.validate();

    expect(errors).not.toBeNull();
    expect(errors!.keyId).toContain('10 characters');
  });

  it('validates privateKey format', () => {
    const form = new AppleClientSecretCreate();
    form.clientId = 'com.example.service';
    form.teamId = 'ABCDEF1234';
    form.keyId = 'ABCDEF1234';
    form.privateKey = 'not-a-pem-key';
    form.duration = 3600;

    const errors = form.validate();
    expect(errors).not.toBeNull();
    expect(errors!.privateKey).toContain('PEM');
  });

  it('validates duration range', () => {
    const form = new AppleClientSecretCreate();
    form.clientId = 'com.example.service';
    form.teamId = 'ABCDEF1234';
    form.keyId = 'ABCDEF1234';
    form.privateKey = '-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg\n-----END PRIVATE KEY-----';
    form.duration = 0;

    const errors = form.validate();
    expect(errors).not.toBeNull();
    expect(errors!.duration).toContain('at least');
  });

  it('validates max duration', () => {
    const form = new AppleClientSecretCreate();
    form.duration = 99999999;
    const errors = form.validate();
    expect(errors).not.toBeNull();
    expect(errors!.duration).toContain('15777000');
  });

  it('passes validation with valid data', () => {
    const form = new AppleClientSecretCreate();
    form.clientId = 'com.example.service';
    form.teamId = 'ABCDEF1234';
    form.keyId = 'ABCDEF1234';
    form.privateKey = '-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg\n-----END PRIVATE KEY-----';
    form.duration = 3600;

    const errors = form.validate();
    expect(errors).toBeNull();
  });

  it('submit fails validation when required fields missing', async () => {
    const form = new AppleClientSecretCreate();
    const result = await form.submit();

    // Should return errors map when validation fails
    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();
    if (typeof result === 'object' && !('token' in result)) {
      expect((result as Record<string, string>).clientId).toBeDefined();
    }
  });

  it('base64urlEncode produces valid base64url', () => {
    const form = new AppleClientSecretCreate();
    const encoded = form['base64urlEncode'](new TextEncoder().encode('test'));
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
  });
});
