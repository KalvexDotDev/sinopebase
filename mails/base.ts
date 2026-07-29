/**
 * Base mail helper — send(to, subject, html).
 *
 * Wraps the mailer from ~/tools/mailer to provide a simple
 * send function for common email scenarios.
 *
 * Port of PocketBase's mails/base.go (Go -> TypeScript).
 * Layer 5 -- imports from ~/tools/mailer.
 */

import { Message } from '~/tools/mailer/mailer.ts'
import type { Mailer } from '~/tools/mailer/mailer.ts'

/**
 * Send an email using the provided mailer.
 *
 * This is the base helper that all other mail functions build upon.
 *
 * @param mailer - The Mailer instance to send with.
 * @param to - Recipient email address.
 * @param subject - Email subject line.
 * @param html - Email body HTML.
 * @param fromAddress - Optional sender address (default: "noreply@sinopebase.dev").
 * @param fromName - Optional sender name (default: "Sinopebase").
 */
export async function send(
  mailer: Mailer,
  to: string,
  subject: string,
  html: string,
  fromAddress: string = 'noreply@sinopebase.dev',
  fromName: string = 'Sinopebase',
): Promise<void> {
  const message = new Message()
  message.from = { name: fromName, address: fromAddress }
  message.to = [{ name: '', address: to }]
  message.subject = subject
  message.html = html

  await mailer.send(message)
}

/**
 * Send an email with a custom Message object.
 *
 * Allows full control over the email (BCC, CC, attachments, etc.).
 *
 * @param mailer - The Mailer instance to send with.
 * @param message - The fully configured Message object.
 */
export async function sendWithMessage(mailer: Mailer, message: Message): Promise<void> {
  await mailer.send(message)
}
