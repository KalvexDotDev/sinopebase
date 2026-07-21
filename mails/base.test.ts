import { describe, it, expect, mock } from 'bun:test'
import { send, sendWithMessage } from './base.ts'
import { Message } from '~/tools/mailer/mailer.ts'

describe('base mail helper', () => {
  it('send creates a Message and sends it via the mailer', async () => {
    const sentMessages: Message[] = []
    const mockMailer = {
      send: mock(async (msg: Message) => {
        sentMessages.push(msg)
      }),
    }

    await send(mockMailer, 'user@example.com', 'Subject', '<p>Body</p>')

    expect(sentMessages.length).toBe(1)
    expect(sentMessages[0]!.to).toEqual([
      { name: '', address: 'user@example.com' },
    ])
    expect(sentMessages[0]!.subject).toBe('Subject')
    expect(sentMessages[0]!.html).toBe('<p>Body</p>')
    expect(sentMessages[0]!.from.address).toBe('noreply@sinopebase.dev')
  })

  it('send accepts custom from address and name', async () => {
    const sentMessages: Message[] = []
    const mockMailer = {
      send: mock(async (msg: Message) => {
        sentMessages.push(msg)
      }),
    }

    await send(
      mockMailer,
      'user@example.com',
      'Test',
      '<p>Test</p>',
      'custom@example.com',
      'Custom Sender',
    )

    expect(sentMessages[0]!.from).toEqual({
      name: 'Custom Sender',
      address: 'custom@example.com',
    })
  })

  it('sendWithMessage sends the exact message', async () => {
    let received: Message | null = null
    const mockMailer = {
      send: mock(async (msg: Message) => {
        received = msg
      }),
    }

    const message = new Message()
    message.from = { name: 'Test', address: 'test@example.com' }
    message.to = [{ name: 'User', address: 'user@example.com' }]
    message.subject = 'Custom'
    message.html = '<b>Custom</b>'

    await sendWithMessage(mockMailer, message)

    expect(received).toBe(message)
  })
})
