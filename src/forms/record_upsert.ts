/**
 * RecordUpsert — validate and persist record create/update operations.
 *
 * Port of PocketBase forms/record_upsert.go (MIT license).
 * Layer 3 — imports from ~/tools/* and ~/core/*.
 *
 * Handles:
 *   - Loading form data into a record
 *   - Auth field validation (email, password, verified)
 *   - Access level management (default, manager, superuser)
 *   - Hidden field protection
 */

import type { FieldStub, CollectionStub, FieldsListStub } from '~/core/record_field_resolver';
import { FieldNamePassword, FieldNameExpand } from '~/core/record_field_resolver';
import { Columnify } from '~/tools/inflector/inflector';

// ---------------------------------------------------------------------------
// Access level constants
// ---------------------------------------------------------------------------

/** Default access — standard user permissions. */
export const AccessLevelDefault = 0;

/** Manager access — can modify some system fields. */
export const AccessLevelManager = 1;

/** Superuser access — can modify all fields including hidden ones. */
export const AccessLevelSuperuser = 2;

// ---------------------------------------------------------------------------
// Record stub interfaces
// ---------------------------------------------------------------------------

/**
 * Minimal Record interface for upsert operations.
 */
export interface RecordStubUpsert {
  id: string;
  collection(): CollectionStub;
  isNew(): boolean;
  /** Load data into the record from a map. */
  loadData(data: Record<string, unknown>): void;
  /** Set a loaded field value by name. */
  set(name: string, value: unknown): void;
  /** Get a raw field value by name. */
  getRaw(name: string): unknown;
  /** Set a raw field value by name (bypasses normalization). */
  setRaw(name: string, value: unknown): void;
  /** Clone the record. */
  clone(): RecordStubUpsert;
  /** Get original record data (pre-modification state). */
  original(): { fieldsData(): Record<string, unknown>; getRaw(name: string): unknown };
  /** Set a field if it exists in the schema, returning the field or null. */
  setIfFieldExists(k: string, v: unknown): FieldStub | null;
  /** Auth record methods. */
  email(): string;
  setEmail(email: string): void;
  verified(): boolean;
  setVerified(v: boolean): void;
  validatePassword(password: string): boolean;
}

// ---------------------------------------------------------------------------
// Validator helper
// ---------------------------------------------------------------------------

/**
 * Simple validation error representation.
 */
export interface ValidationError {
  field: string;
  message: string;
  code?: string;
}

/**
 * Checks whether two values match (for equality validation).
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b;
  return false;
}

// ---------------------------------------------------------------------------
// RecordUpsert form
// ---------------------------------------------------------------------------

/**
 * RecordUpsert handles record creation and update validation.
 *
 * @example
 * ```ts
 * const form = new RecordUpsert(record);
 * form.load({ title: "Hello", status: "active" });
 * form.grantSuperuserAccess();
 * const errors = await form.submit();
 * ```
 */
export class RecordUpsert {
  /** The record being created/updated. */
  protected record: RecordStubUpsert;

  /** Access level for this operation. */
  protected accessLevel = AccessLevelDefault;

  /** Disables password validation (e.g., when a hash was set directly). */
  protected disablePasswordValidations = false;

  /** Extra password field: plaintext password. */
  protected password = '';

  /** Extra password field: confirmation. */
  protected passwordConfirm = '';

  /** Extra password field: old password (for auth record updates). */
  protected oldPassword = '';

  /**
   * @param record - The record to upsert (use `new Record(collection)` for creates).
   */
  constructor(record: RecordStubUpsert) {
    this.record = record;
  }

  // -----------------------------------------------------------------------
  // Access control
  // -----------------------------------------------------------------------

  /** Resets access level to default. */
  resetAccess(): void {
    this.accessLevel = AccessLevelDefault;
  }

 /** Grants manager-level access (can modify some system fields). */
  grantManagerAccess(): void {
    this.accessLevel = AccessLevelManager;
  }

  /** Grants superuser access (can modify all fields including hidden). */
  grantSuperuserAccess(): void {
    this.accessLevel = AccessLevelSuperuser;
  }

  /** Whether the form has manager or superuser access. */
  hasManageAccess(): boolean {
    return (
      this.accessLevel === AccessLevelManager ||
      this.accessLevel === AccessLevelSuperuser
    );
  }

  // -----------------------------------------------------------------------
  // Data loading
  // -----------------------------------------------------------------------

  /**
   * Loads data into the form and the related record.
   *
   * Handles:
   *   - Auth-specific password fields (password, passwordConfirm, oldPassword)
   *   - Hidden field protection for non-superuser access
   *   - Schema field validation
   *
   * @param data - The key-value data to load.
   */
  load(data: Record<string, unknown>): void {
    const excludedFields = new Set<string>([FieldNameExpand]);
    const isAuth = this.record.collection().isAuth();

    // Extract auth-specific fields
    if (isAuth) {
      if ('password' in data) {
        this.password = String(data['password'] ?? '');
      }
      if ('passwordConfirm' in data) {
        this.passwordConfirm = String(data['passwordConfirm'] ?? '');
      }
      if ('oldPassword' in data) {
        this.oldPassword = String(data['oldPassword'] ?? '');
      }

      // Skip non-schema password fields
      excludedFields.add('passwordConfirm');
      excludedFields.add('oldPassword');
    }

    for (const [k, v] of Object.entries(data)) {
      if (excludedFields.has(k)) continue;

      const field = this.record.setIfFieldExists(k, v);

      // Restore original value if hidden field (except "password" for auth)
      if (
        this.accessLevel !== AccessLevelSuperuser &&
        field &&
        field.getHidden?.() &&
        (!isAuth || field.getName() !== FieldNamePassword)
      ) {
        this.record.setRaw(
          field.getName(),
          this.record.original().getRaw(field.getName()),
        );
      }
    }
  }

  // -----------------------------------------------------------------------
  // Auth field validation
  // -----------------------------------------------------------------------

  /**
   * Validates the form-specific auth fields.
   *
   * Returns an array of validation errors (empty array = valid).
   */
  validateFormFields(): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!this.record.collection().isAuth()) {
      return errors; // Not an auth collection — no special auth field validation
    }

    this.syncPasswordFields();

    const isNew = this.record.isNew();
    const original = this.record.original();

    if (!isNew && !this.hasManageAccess()) {
      // Email must match original (can't be changed without manage access)
      const origEmail = original.getRaw('email');
      if (!valuesEqual(this.record.email(), origEmail)) {
        errors.push({
          field: 'email',
          message: 'Email can only be changed by authorized users or the current auth record.',
          code: 'validation_email_change_not_allowed',
        });
      }

      // Verified must match original
      const origVerified = original.getRaw('verified');
      if (!valuesEqual(this.record.verified(), origVerified)) {
        errors.push({
          field: 'verified',
          message: 'Verified can only be changed by authorized users.',
          code: 'validation_verified_change_not_allowed',
        });
      }
    }

    // Password validation
    if (!this.disablePasswordValidations) {
      const needsPassword =
        isNew || this.passwordConfirm !== '' || this.oldPassword !== '';
      const needsPasswordConfirm =
        isNew || this.password !== '' || this.oldPassword !== '';

      if (needsPassword && !this.password) {
        errors.push({
          field: 'password',
          message: 'Password is required.',
          code: 'validation_required',
        });
      }

      if (needsPasswordConfirm && !this.passwordConfirm) {
        errors.push({
          field: 'passwordConfirm',
          message: 'Password confirmation is required.',
          code: 'validation_required',
        });
      }

      if (this.password && this.passwordConfirm && this.password !== this.passwordConfirm) {
        errors.push({
          field: 'passwordConfirm',
          message: 'Passwords do not match.',
          code: 'validation_values_mismatch',
        });
      }

      // Old password required on update when form has no manage access
      // and password is being changed
      if (
        !isNew &&
        !this.hasManageAccess() &&
        (this.password !== '' || this.passwordConfirm !== '') &&
        !this.oldPassword
      ) {
        errors.push({
          field: 'oldPassword',
          message: 'Missing or invalid old password.',
          code: 'validation_required',
        });
      }

      // Validate old password
      if (this.oldPassword) {
        const oldPwErr = this.checkOldPassword(this.oldPassword);
        if (oldPwErr) {
          errors.push(oldPwErr);
        }
      }
    }

    return errors;
  }

  /**
   * Validates the old password against the record's original hash.
   */
  protected checkOldPassword(value: string): ValidationError | null {
    if (!value) return null;

    if (!this.record.original().validatePassword?.(value)) {
      return {
        field: 'oldPassword',
        message: 'Missing or invalid old password.',
        code: 'validation_invalid_old_password',
      };
    }

    return null;
  }

  /**
   * Synchronizes programmatically-set password fields and conditionally
   * disables password validations.
   */
  protected syncPasswordFields(): void {
    if (!this.record.collection().isAuth()) return;

    this.disablePasswordValidations = false;

    const rawPassword = this.record.getRaw(FieldNamePassword);
    if (rawPassword && typeof rawPassword === 'object') {
      const pwValue = rawPassword as { plain?: string; hash?: string };
      if (
        (pwValue.plain && pwValue.plain !== this.password) ||
        (!pwValue.plain && pwValue.hash && this.record.isNew())
      ) {
        this.disablePasswordValidations = true;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Submit
  // -----------------------------------------------------------------------

  /**
   * Validates the form and attempts to persist the record.
   *
   * Returns an array of validation errors, or an empty array on success.
   */
  async submit(): Promise<ValidationError[]> {
    const errors = this.validateFormFields();
    if (errors.length > 0) return errors;

    // Persist the record
    try {
      await this.saveRecord();
      return [];
    } catch (err) {
      return [
        {
          field: '_record',
          message: `Failed to save record: ${(err as Error).message}`,
          code: 'validation_save_failed',
        },
      ];
    }
  }

  /**
   * Persists the record to the database.
   *
   * Override this method to implement actual persistence.
   */
  protected async saveRecord(): Promise<void> {
    // Default implementation is a stub.
    // Production code should call the app's Save method.
    throw new Error(
      'saveRecord() must be overridden — call your app DAO to persist the record',
    );
  }
}
