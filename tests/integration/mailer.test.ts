/**
 * SMTP mailer ATDD — sends a real email through the app's SMTP client into
 * a Mailpit container and verifies it arrives (send + receive).
 *
 * Requires the `mail` service from docker-compose.yml:
 *   SMTP: localhost:1025, API: http://localhost:8025/api/v1
 * Skips when Mailpit is not reachable.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Sinopebase } from '~/core/app'
import { Message } from '~/tools/mailer/mailer'
import { reserveLoopbackPort } from '../harness'

const MAILPIT_API = 'http://localhost:8025/api/v1'

interface MailpitMessage {
  ID: string
  From: { Name: string; Address: string }
  To: { Name: string; Address: string }[]
  Subject: string
  Text: string
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
const subject = `mailer-integration-${Date.now()}`

beforeAll(async () => {
  const portReservation = await reserveLoopbackPort()
  app = new Sinopebase({
    port: portReservation.port,
    smtp: {
      enabled: true,
      host: 'localhost',
      port: 1025,
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
    const detail = (await (await fetch(`${MAILPIT_API}/message/${found?.ID}`)).json()) as {
      Text: string
    }
    expect(detail.Text).toContain('Mailpit integration test body')

    // Clean up the mailbox for the next run.
    await fetch(`${MAILPIT_API}/messages`, { method: 'DELETE' })
  })
})
