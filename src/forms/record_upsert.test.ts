import { describe, expect, it } from 'bun:test'
import type { CollectionStub, FieldStub } from '~/core/record_field_resolver'
import type { RecordStubUpsert } from './record_upsert'
import { AccessLevelDefault, RecordUpsert } from './record_upsert'

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

interface MockRecordOptions {
  isNew?: boolean
  email?: string
  verified?: boolean
  passwordHash?: string
  fields?: Record<string, unknown>
  isAuth?: boolean
}

function createMockRecord(options: MockRecordOptions = {}): RecordStubUpsert {
  const {
    isNew = true,
    email = '',
    verified = false,
    passwordHash = '',
    fields: fieldData = {},
    isAuth = false,
  } = options

  let recordEmail = email
  let recordVerified = verified
  const loadedData: Record<string, unknown> = {}
  const originalData: Record<string, unknown> = { ...fieldData }

  // Add email to original data when it's an auth collection
  if (isAuth) {
    originalData.email = email
    originalData.verified = verified
  }

  // Build fields from fieldData + auth fields
  const fieldsMap = new Map<string, FieldStub>()
  for (const key of Object.keys(fieldData)) {
    const f = makeField(key)
    fieldsMap.set(key, f)
  }
  if (isAuth) {
    if (!fieldsMap.has('email')) {
      fieldsMap.set('email', makeField('email'))
    }
    if (!fieldsMap.has('verified')) {
      fieldsMap.set('verified', makeField('verified', 'bool'))
    }
    if (!fieldsMap.has('password')) {
      fieldsMap.set('password', makeField('password', 'password'))
    }
  }

  const collection: CollectionStub = {
    id: 'c_test',
    name: 'test',
    listRule: null,
    fields: {
      getByName(n: string) {
        return fieldsMap.get(n)
      },
      all() {
        return [...fieldsMap.values()]
      },
      fieldNames() {
        return [...fieldsMap.keys()]
      },
    },
    indexes: [],
    isAuth() {
      return isAuth
    },
  }

  const record: RecordStubUpsert = {
    id: 'rec_1',
    collection() {
      return collection
    },
    isNew() {
      return isNew
    },
    loadData(data: Record<string, unknown>) {
      Object.assign(loadedData, data)
    },
    set(name: string, value: unknown) {
      loadedData[name] = value
    },
    getRaw(name: string) {
      if (name === 'password') {
        return passwordHash ? { plain: '', hash: passwordHash } : null
      }
      if (name === 'email') return recordEmail
      if (name === 'verified') return recordVerified
      return loadedData[name]
    },
    setRaw(name: string, value: unknown) {
      loadedData[name] = value
    },
    clone() {
      return createMockRecord(options)
    },
    original() {
      return {
        fieldsData() {
          return { ...originalData }
        },
        getRaw(name: string) {
          if (name === 'email') return originalData.email
          if (name === 'verified') return originalData.verified
          if (name === 'password') {
            return passwordHash ? { plain: '', hash: passwordHash } : null
          }
          return originalData[name]
        },
        validatePassword(password: string) {
          return password === 'correct-old-password'
        },
      }
    },
    setIfFieldExists(k: string, v: unknown) {
      const field = fieldsMap.get(k) ?? null
      if (field) {
        loadedData[k] = v
        if (k === 'email') recordEmail = String(v)
        if (k === 'verified') recordVerified = Boolean(v)
      }
      return field
    },
    email() {
      return recordEmail
    },
    setEmail(e: string) {
      recordEmail = e
    },
    verified() {
      return recordVerified
    },
    setVerified(v: boolean) {
      recordVerified = v
    },
    validatePassword(password: string) {
      return password === 'correct-old-password'
    },
  }

  return record
}

function makeField(name: string, type = 'text', hidden = false): FieldStub {
  return {
    id: `f_${name}`,
    name,
    type,
    system: false,
    hidden,
    getHidden() {
      return this.hidden
    },
    getName() {
      return this.name
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RecordUpsert', () => {
  describe('constructor and access control', () => {
    it('initializes with default access level', () => {
      const record = createMockRecord({ fields: { title: 'test' } })
      const form = new RecordUpsert(record)
      expect(form.accessLevel).toBe(AccessLevelDefault)
      expect(form.hasManageAccess()).toBe(false)
    })

    it('grants manager access', () => {
      const record = createMockRecord({ fields: { title: 'test' } })
      const form = new RecordUpsert(record)
      form.grantManagerAccess()
      expect(form.hasManageAccess()).toBe(true)
    })

    it('grants superuser access', () => {
      const record = createMockRecord({ fields: { title: 'test' } })
      const form = new RecordUpsert(record)
      form.grantSuperuserAccess()
      expect(form.hasManageAccess()).toBe(true)
    })

    it('resets access to default', () => {
      const record = createMockRecord({ fields: { title: 'test' } })
      const form = new RecordUpsert(record)
      form.grantSuperuserAccess()
      form.resetAccess()
      expect(form.hasManageAccess()).toBe(false)
    })
  })

  describe('load', () => {
    it('loads data into the record', () => {
      const record = createMockRecord({ fields: { title: '', status: '' } })
      const form = new RecordUpsert(record)
      form.load({ title: 'Hello', status: 'active' })
      expect(record.getRaw('title')).toBe('Hello')
      expect(record.getRaw('status')).toBe('active')
    })

    it('extracts auth password fields from data', () => {
      const record = createMockRecord({ fields: { title: 'test' }, isAuth: true })
      const form = new RecordUpsert(record)
      form.load({
        title: 'test',
        password: 'newpassword',
        passwordConfirm: 'newpassword',
        oldPassword: 'oldpassword',
      })
      expect(form.password).toBe('newpassword')
      expect(form.passwordConfirm).toBe('newpassword')
      expect(form.oldPassword).toBe('oldpassword')
    })

    it('skips expand field', () => {
      const record = createMockRecord({ fields: { title: '' } })
      const form = new RecordUpsert(record)
      form.load({ title: 'test', expand: 'relField' })
      expect(record.getRaw('title')).toBe('test')
    })
  })

  describe('validateFormFields (non-auth)', () => {
    it('returns empty errors for non-auth collections', () => {
      const record = createMockRecord({ fields: { title: 'test' }, isAuth: false })
      const form = new RecordUpsert(record)
      const errors = form.validateFormFields()
      expect(errors).toHaveLength(0)
    })
  })

  describe('validateFormFields (auth)', () => {
    it('validates email cannot change without manage access (update)', () => {
      // Record was created with email 'old@test.com', but now email() returns 'new@test.com'
      const record = createMockRecord({
        fields: { email: 'old@test.com' },
        isAuth: true,
        isNew: false,
        email: 'old@test.com',
      })
      // Load new email to trigger the change on the record
      record.setIfFieldExists('email', 'new@test.com')

      const form = new RecordUpsert(record)
      const errors = form.validateFormFields()
      const emailErr = errors.find((e) => e.field === 'email')
      expect(emailErr).toBeDefined()
      expect(emailErr?.code).toBe('validation_email_change_not_allowed')
    })

    it('allows email change with manage access', () => {
      const record = createMockRecord({
        fields: { email: 'old@test.com' },
        isAuth: true,
        isNew: false,
        email: 'new@test.com',
      })
      const form = new RecordUpsert(record)
      form.grantManagerAccess()
      const errors = form.validateFormFields()
      const emailErr = errors.find((e) => e.field === 'email')
      expect(emailErr).toBeUndefined()
    })

    it('validates password required on new record', () => {
      const record = createMockRecord({
        fields: { email: 'test@test.com' },
        isAuth: true,
        isNew: true,
        email: 'test@test.com',
      })
      const form = new RecordUpsert(record)
      const errors = form.validateFormFields()
      const pwErr = errors.find((e) => e.field === 'password')
      expect(pwErr).toBeDefined()
    })

    it('validates password confirmation matches', () => {
      const record = createMockRecord({
        fields: { email: 'test@test.com' },
        isAuth: true,
        isNew: true,
        email: 'test@test.com',
      })
      const form = new RecordUpsert(record)
      form.password = 'mypassword'
      form.passwordConfirm = 'different'
      const errors = form.validateFormFields()
      const confirmErr = errors.find((e) => e.field === 'passwordConfirm')
      expect(confirmErr).toBeDefined()
    })

    it('validates old password required on update without manage access', () => {
      const record = createMockRecord({
        fields: { email: 'test@test.com' },
        isAuth: true,
        isNew: false,
        email: 'test@test.com',
      })
      const form = new RecordUpsert(record)
      form.password = 'newpass'
      form.passwordConfirm = 'newpass'
      const errors = form.validateFormFields()
      const oldPwErr = errors.find((e) => e.field === 'oldPassword')
      expect(oldPwErr).toBeDefined()
    })

    it('validates old password value', () => {
      const record = createMockRecord({
        fields: { email: 'test@test.com' },
        isAuth: true,
        isNew: false,
        email: 'test@test.com',
      })
      const form = new RecordUpsert(record)
      form.password = 'newpass'
      form.passwordConfirm = 'newpass'
      form.oldPassword = 'wrong-old-password'
      const errors = form.validateFormFields()
      const oldPwErr = errors.find((e) => e.field === 'oldPassword')
      expect(oldPwErr).toBeDefined()
    })

    it('passes validation with correct old password', () => {
      const record = createMockRecord({
        fields: { email: 'test@test.com' },
        isAuth: true,
        isNew: false,
        email: 'test@test.com',
      })
      const form = new RecordUpsert(record)
      form.password = 'newpass'
      form.passwordConfirm = 'newpass'
      form.oldPassword = 'correct-old-password'
      const errors = form.validateFormFields()
      const oldPwErr = errors.find((e) => e.field === 'oldPassword')
      expect(oldPwErr).toBeUndefined()
    })
  })

  describe('submit', () => {
    it('returns validation errors on invalid form', async () => {
      const record = createMockRecord({
        fields: { email: 'test@test.com' },
        isAuth: true,
        isNew: true,
        email: 'test@test.com',
      })
      const form = new RecordUpsert(record)
      const errors = await form.submit()
      expect(errors.length).toBeGreaterThan(0)
    })

    it('saves valid record', async () => {
      const record = createMockRecord({
        fields: { title: 'test' },
        isAuth: true,
        isNew: true,
        email: 'test@test.com',
      })
      const form = new RecordUpsert(record)
      form.password = 'mypassword'
      form.passwordConfirm = 'mypassword'
      form.saveRecord = async () => {}
      const errors = await form.submit()
      expect(errors).toHaveLength(0)
    })

    it('returns error when save fails', async () => {
      const record = createMockRecord({
        fields: { title: 'test' },
        isAuth: true,
        isNew: true,
        email: 'test@test.com',
      })
      const form = new RecordUpsert(record)
      form.password = 'mypassword'
      form.passwordConfirm = 'mypassword'
      form.saveRecord = async () => {
        throw new Error('DB constraint violation')
      }
      const errors = await form.submit()
      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0]?.message).toContain('DB constraint')
    })
  })

  describe('checkOldPassword', () => {
    it('returns validation error for wrong password', () => {
      const record = createMockRecord({
        fields: { email: 'test@test.com' },
        isAuth: true,
      })
      const form = new RecordUpsert(record)
      const result = form.checkOldPassword('wrong-password')
      expect(result).not.toBeNull()
      expect(result?.field).toBe('oldPassword')
    })

    it('returns null for correct password', () => {
      const record = createMockRecord({
        fields: { email: 'test@test.com' },
        isAuth: true,
      })
      const form = new RecordUpsert(record)
      const result = form.checkOldPassword('correct-old-password')
      expect(result).toBeNull()
    })
  })

  describe('syncPasswordFields', () => {
    it('does nothing for non-auth collections', () => {
      const record = createMockRecord({ fields: { title: 'test' }, isAuth: false })
      const form = new RecordUpsert(record)
      form.syncPasswordFields()
      expect(form.disablePasswordValidations).toBe(false)
    })

    it('disables password validations when hash is set on new record', () => {
      const record = createMockRecord({
        fields: { email: 'test@test.com' },
        isAuth: true,
        isNew: true,
        passwordHash: '$2a$10$abc',
      })
      const form = new RecordUpsert(record)
      form.syncPasswordFields()
      expect(form.disablePasswordValidations).toBe(true)
    })
  })
})
