/**
 * Updates default auth alert templates in _params or _collections.
 *
 * Port of PocketBase's migrations/1763020353_update_default_auth_alert_templates.go
 * (Go -> TypeScript).
 * Layer 5 -- depends on ~/migrations/types.
 */

import type { MigrationDB } from './types.ts'

/**
 * Updates default auth alert templates to the newer format.
 *
 * In PocketBase v0.23+, the auth alert email template was updated
 * to include richer context about the login attempt.
 */
export async function up(db: MigrationDB): Promise<void> {
  // Update the default auth alert template in _params where key matches
  await db.raw(`
    UPDATE _params
    SET value = '{
      "subject": "Login from a new location",
      "body": "<p>Hello,</p><p>We detected a login to your {APP_NAME} account from a new device or location:</p><p><em>{ALERT_INFO}</em></p><p><strong>If this wasn''t you, please change your password immediately.</strong></p><p>Thanks,<br>{APP_NAME} team</p>"
    }',
    updated = datetime('now')
    WHERE key = 'auth_alert_template'
  `)

  // Also update any collection auth options that have the old default template
  await db.raw(`
    UPDATE _collections
    SET options = json_set(
      options,
      '$.authAlert.template.body',
      '<p>Hello,</p><p>We detected a login to your {APP_NAME} account from a new device or location:</p><p><em>{ALERT_INFO}</em></p><p><strong>If this wasn''t you, please change your password immediately.</strong></p><p>Thanks,<br>{APP_NAME} team</p>'
    ),
    updated = datetime('now')
    WHERE type = 'auth'
  `)
}

/**
 * Rolls back the auth alert template update.
 */
export async function down(db: MigrationDB): Promise<void> {
  // Restore older template format
  await db.raw(`
    UPDATE _params
    SET value = '{
      "subject": "New login from {ALERT_INFO}",
      "body": "<p>Hello,</p><p>Someone (hopefully you) has logged in from: {ALERT_INFO}</p><p>If this wasn''t you, please change your password.</p><p>Thanks,<br>{APP_NAME} team</p>"
    }',
    updated = datetime('now')
    WHERE key = 'auth_alert_template'
  `)
}
