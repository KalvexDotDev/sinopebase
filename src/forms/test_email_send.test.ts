import { beforeEach, describe, expect, it } from 'bun:test'
import type { EmailTestCollectionStub } from './test_email_send'
import { TestEmailSend, TestTemplateVerification, ValidTestTemplates } from './test_email_send'

describe('TestEmailSend', () => {
  let form: TestEmailSend
  let mockCollection: EmailTestCollectionStub

  beforeEach(() => {
    mockCollection = {
      id: 'c_superusers',
      name: '_superusers',
      isAuth() {
        return true
      },
    }

    const collectionResolver = (nameOrId: string) => {
      if (nameOrId === '_superusers' || nameOrId === 'c_superusers') {
        return mockCollection
      }
      if (nameOrId === 'users' || nameOrId === 'c_users') {
        return {
          id: 'c_users',
          name: 'users',
          isAuth() {
            return true
          },
        }
      }
      return null
    }

    const emailSender = async (_params: {
      email: string
      template: string
      collection: EmailTestCollectionStub
    }) => {
      // no-op in tests
    }

    form = new TestEmailSend(collectionResolver, emailSender)
  })

  it('validates email is required', () => {
    const errors = form.validate()
    expect(errors).not.toBeNull()
    expect(errors?.email).toContain('required')
  })

  it('validates email format', () => {
    form.email = 'not-an-email'
    const errors = form.validate()
    expect(errors).not.toBeNull()
    expect(errors?.email).toContain('email format')
  })

  it('validates email max length', () => {
    form.email = `${'a'.repeat(256)}@test.com`
    const errors = form.validate()
    expect(errors).not.toBeNull()
    expect(errors?.email).toContain('255')
  })

  it('validates template is required', () => {
    form.email = 'test@example.com'
    const errors = form.validate()
    expect(errors).not.toBeNull()
    expect(errors?.template).toContain('required')
  })

  it('validates template is one of valid options', () => {
    form.email = 'test@example.com'
    form.template = 'invalid-template'
    const errors = form.validate()
    expect(errors).not.toBeNull()
    expect(errors?.template).toContain('verification')
  })

  it('validates collection (optional) must be auth collection', () => {
    form.email = 'test@example.com'
    form.template = TestTemplateVerification
    form.collection = 'nonexistent'
    const errors = form.validate()
    expect(errors).not.toBeNull()
    expect(errors?.collection).toContain('auth collection')
  })

  it('passes validation with valid data', () => {
    form.email = 'test@example.com'
    form.template = TestTemplateVerification
    const errors = form.validate()
    expect(errors).toBeNull()
  })

  it('passes validation with valid auth collection', () => {
    form.email = 'test@example.com'
    form.template = TestTemplateVerification
    form.collection = 'users'
    const errors = form.validate()
    expect(errors).toBeNull()
  })

  it('submit succeeds when validation passes and email sent', async () => {
    form.email = 'test@example.com'
    form.template = TestTemplateVerification

    const result = await form.submit()
    expect(result).toBeNull()
  })

  it('submit returns error when validation fails', async () => {
    const result = await form.submit()
    expect(result).toBeTruthy()
    expect(result).toContain('required')
  })

  it('submit returns error when email sender fails', async () => {
    form = new TestEmailSend(
      () => mockCollection,
      async () => {
        throw new Error('SMTP connection failed')
      },
    )
    form.email = 'test@example.com'
    form.template = TestTemplateVerification

    const result = await form.submit()
    expect(result).toContain('SMTP connection failed')
  })

  it('submit returns error when collection not found', async () => {
    form = new TestEmailSend(
      () => null,
      async () => {},
    )
    form.email = 'test@example.com'
    form.template = TestTemplateVerification
    form.collection = 'missing'

    // Validation will pass because we return null for all collections
    // but actually we need the collection to exist...
    form.collectionResolver = () => null

    const errors = form.validate()
    expect(errors).not.toBeNull()
  })

  it('accepts all valid template types', () => {
    form.email = 'test@example.com'

    for (const tpl of ValidTestTemplates) {
      form.template = tpl
      const errors = form.validate()
      expect(errors).toBeNull()
    }
  })

  it('rejects collection longer than 255 chars', () => {
    form.email = 'test@example.com'
    form.template = TestTemplateVerification
    form.collection = `c${'a'.repeat(256)}`
    const errors = form.validate()
    expect(errors).not.toBeNull()
    expect(errors?.collection).toContain('255')
  })
})
