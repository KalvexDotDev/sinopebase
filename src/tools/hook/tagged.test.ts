import { describe, expect, it } from 'bun:test'
import { Event, Hook } from './hook.ts'
import { TaggedHook } from './tagged.ts'

class TaggedEvent extends Event {
  readonly message: string
  private readonly _tags: string[]

  constructor(message: string, _tags: string[]) {
    super()
    this.message = message
    this._tags = _tags
  }

  tags(): string[] {
    return this._tags
  }
}

describe('TaggedHook', () => {
  it('creates a tagged hook with tags', () => {
    const base = new Hook<TaggedEvent>()
    const th = new TaggedHook(base, 'users')
    expect(th.length).toBe(0)
  })

  it('accepts all events when no tags configured', async () => {
    const base = new Hook<TaggedEvent>()
    const th = new TaggedHook(base) // no tags
    const results: string[] = []

    th.bindFunc(async (e) => {
      results.push(e.message)
      return e.next()
    })

    await th.trigger(new TaggedEvent('hello', ['anything']))
    expect(results).toEqual(['hello'])
  })

  it('triggers handler when event tags match', async () => {
    const base = new Hook<TaggedEvent>()
    const th = new TaggedHook(base, 'users', 'admins')
    const results: string[] = []

    th.bindFunc(async (e) => {
      results.push(e.message)
      return e.next()
    })

    await th.trigger(new TaggedEvent('user event', ['users']))
    expect(results).toEqual(['user event'])
  })

  it('skips handler when event tags do not match', async () => {
    const base = new Hook<TaggedEvent>()
    const th = new TaggedHook(base, 'users')
    const results: string[] = []

    th.bindFunc(async (e) => {
      results.push(e.message)
      return e.next()
    })

    await th.trigger(new TaggedEvent('post event', ['posts']))
    expect(results).toEqual([])
  })

  it('triggers when event has multiple tags and one matches', async () => {
    const base = new Hook<TaggedEvent>()
    const th = new TaggedHook(base, 'users')
    const results: string[] = []

    th.bindFunc(async (e) => {
      results.push(e.message)
      return e.next()
    })

    await th.trigger(new TaggedEvent('multi-tag', ['posts', 'users']))
    expect(results).toEqual(['multi-tag'])
  })

  it('canTriggerOn returns true when tags match', () => {
    const base = new Hook<TaggedEvent>()
    const th = new TaggedHook(base, 'users', 'admins')

    expect(th.canTriggerOn(['users'])).toBe(true)
    expect(th.canTriggerOn(['admins'])).toBe(true)
    expect(th.canTriggerOn(['users', 'posts'])).toBe(true)
  })

  it('canTriggerOn returns false when no match', () => {
    const base = new Hook<TaggedEvent>()
    const th = new TaggedHook(base, 'users')

    expect(th.canTriggerOn(['posts'])).toBe(false)
    expect(th.canTriggerOn(['pages', 'comments'])).toBe(false)
  })

  it('canTriggerOn returns true when hook has no tags', () => {
    const base = new Hook<TaggedEvent>()
    const th = new TaggedHook(base)

    expect(th.canTriggerOn([])).toBe(true)
    expect(th.canTriggerOn(['anything'])).toBe(true)
  })

  it('unbind removes handler from underlying hook', () => {
    const base = new Hook<TaggedEvent>()
    const th = new TaggedHook(base, 'users')

    const id = th.bindFunc(async (e) => e.next())
    expect(th.length).toBe(1)
    th.unbind(id)
    expect(th.length).toBe(0)
  })

  it('unbindAll removes all handlers', () => {
    const base = new Hook<TaggedEvent>()
    const th = new TaggedHook(base, 'users')

    th.bindFunc(async (e) => e.next())
    th.bindFunc(async (e) => e.next())
    th.unbindAll()
    expect(th.length).toBe(0)
  })

  it('bind stores handler with custom id', () => {
    const base = new Hook<TaggedEvent>()
    const th = new TaggedHook(base, 'users')

    const id = th.bind({ func: async (e) => e.next(), id: 'my-handler', priority: 0 })
    expect(id).toBe('my-handler')
    expect(th.length).toBe(1)
  })
})
