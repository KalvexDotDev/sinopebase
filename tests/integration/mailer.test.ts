/**
 * SMTP mailer ATDD — sends a real email through the app's SMTP client into
 * a Mailpit container and verifies it arrives (send + receive).
 *
 * Requires the `mail` service from docker-compose.yml:
 *   SMTP: localhost:1025, API: http://localhost:8025/api/v1
 * Skips when Mailpit is not reachable.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { Sinopebase, smtpMailerConfig } from '~/core/app'
import { Message } from '~/tools/mailer/mailer'
import { SMTPClient } from '~/tools/mailer/smtp'
import { reserveLoopbackPort } from '../harness'

// @new-code-test positive src/tools/mailer/smtp.ts
// @new-code-test negative src/tools/mailer/smtp.ts
// @new-code-test positive src/core/app.ts
// @new-code-test negative src/core/app.ts

const MAILPIT_API = process.env.TEST_MAILPIT_API_URL ?? 'http://localhost:8025/api/v1'

interface MailpitMessage {
  ID: string
  From: { Name: string; Address: string }
  To: { Name: string; Address: string }[]
  Subject: string
  Text: string
}

interface MailpitDetail {
  Text: string
  Attachments: { FileName: string; Size: number }[]
}

async function mailpitAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${MAILPIT_API}/messages`, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

const available = await mailpitAvailable()

let app: Sinopebase
const subject = `mailer-integration-${randomUUID()}`

beforeAll(async () => {
  const portReservation = await reserveLoopbackPort()
  app = new Sinopebase({
    port: portReservation.port,
    smtp: {
      enabled: true,
      host: process.env.TEST_SMTP_HOST ?? 'localhost',
      port: Number(process.env.TEST_SMTP_PORT ?? 1025),
      fromAddress: 'noreply@sinopebase.test',
    },
  })
  await portReservation.release()
  await app.start()
})

afterAll(async () => {
  await app.stop()
})

describe.skipIf(!available)('SMTP mailer (Mailpit)', () => {
  it('sends an email that arrives in the mail server', async () => {
    expect(app.mailer).not.toBeNull()

    const message = new Message()
    message.from = { name: 'Sinopebase Test', address: 'sender@sinopebase.test' }
    message.to = [{ name: 'Recipient', address: 'recipient@example.com' }]
    message.subject = subject
    message.text = 'Mailpit integration test body'
    message.html = '<p>Mailpit integration test body</p>'
    message.attachments['buffer.txt'] = Buffer.from('buffer attachment')
    message.attachments['stream.txt'] = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('stream attachment'))
        controller.close()
      },
    })

    await app.mailer?.send(message)

    // Poll Mailpit until the message arrives.
    let found: MailpitMessage | null = null
    for (let attempt = 0; attempt < 20 && !found; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      const res = await fetch(`${MAILPIT_API}/messages`)
      const json = (await res.json()) as { messages: MailpitMessage[] }
      found = json.messages.find((m) => m.Subject === subject) ?? null
    }

    expect(found).not.toBeNull()
    expect(found?.From.Address).toBe('sender@sinopebase.test')
    expect(found?.To[0]?.Address).toBe('recipient@example.com')

    // The body lives on the per-message detail endpoint.
    const detail = (await (
      await fetch(`${MAILPIT_API}/message/${found?.ID}`)
    ).json()) as MailpitDetail
    expect(detail.Text).toContain('Mailpit integration test body')
    expect(detail.Attachments).toEqual([
      expect.objectContaining({ FileName: 'buffer.txt', Size: 17 }),
      expect.objectContaining({ FileName: 'stream.txt', Size: 17 }),
    ])

    // Mutation workers share Mailpit, so remove only this test's message.
    const cleanup = await fetch(`${MAILPIT_API}/messages`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ IDs: [found?.ID] }),
    })
    expect(cleanup.ok).toBe(true)
  })
})

it('reports an unavailable SMTP server', async () => {
  const mailer = new SMTPClient({ host: '127.0.0.1', port: 1 })
  const message = new Message()
  message.from = { name: 'Sender', address: 'sender@sinopebase.test' }
  message.to = [{ name: 'Recipient', address: 'recipient@example.com' }]
  message.subject = 'unavailable SMTP server'
  message.text = 'Delivery should fail'
  message.attachments['stream.txt'] = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('cannot deliver'))
      controller.close()
    },
  })
  await expect(mailer.send(message)).rejects.toThrow()
})

it('derives TLS from the SMTP port and requires a sender address', () => {
  const base = {
    enabled: true,
    host: 'smtp.example.test',
    fromAddress: 'noreply@mail.example.test',
  }
  expect(smtpMailerConfig({ ...base, port: 465 })?.transport).toMatchObject({
    port: 465,
    tls: true,
    requireTLS: false,
  })
  expect(smtpMailerConfig({ ...base, port: 587 })?.transport).toMatchObject({
    port: 587,
    tls: false,
    requireTLS: true,
  })
  // No port: GoTrue's default submission port, with mandatory STARTTLS.
  expect(smtpMailerConfig(base)?.transport).toMatchObject({ port: 587, requireTLS: true })
  expect(smtpMailerConfig({ ...base, port: 1025 })?.transport).toMatchObject({
    tls: false,
    requireTLS: false,
  })
  expect(smtpMailerConfig({ ...base, fromName: 'Sinope' })?.from).toEqual({
    name: 'Sinope',
    address: 'noreply@mail.example.test',
  })
  expect(smtpMailerConfig({ ...base, port: 1025 })?.from).toEqual({
    name: '',
    address: 'noreply@mail.example.test',
  })
  expect(smtpMailerConfig(undefined)).toBeNull()
  expect(smtpMailerConfig({ enabled: true })).toBeNull()
  expect(() => smtpMailerConfig({ enabled: true, host: 'smtp.example.test' })).toThrow(
    'SMTP_ADMIN_EMAIL',
  )
})

it('refuses to start with an SMTP host but no sender address', async () => {
  const portReservation = await reserveLoopbackPort()
  const unsent = new Sinopebase({
    port: portReservation.port,
    smtp: { enabled: true, host: 'localhost', port: 1025 },
  })
  await portReservation.release()
  await expect(unsent.start()).rejects.toThrow('SMTP_ADMIN_EMAIL')
  expect(unsent.mailer).toBeNull()
})

it.skipIf(!available)('refuses to send without STARTTLS when TLS is required', async () => {
  // Mailpit offers no STARTTLS by default, so a required upgrade must fail before any mail is sent.
  const mailer = new SMTPClient({
    host: process.env.TEST_SMTP_HOST ?? 'localhost',
    port: Number(process.env.TEST_SMTP_PORT ?? 1025),
    requireTLS: true,
  })
  const message = new Message()
  message.from = { name: 'Sender', address: 'sender@sinopebase.test' }
  message.to = [{ name: 'Recipient', address: 'recipient@example.com' }]
  message.subject = `requires-tls-${randomUUID()}`
  message.text = 'Must not be delivered in clear text'
  await expect(mailer.send(message)).rejects.toThrow()
})
