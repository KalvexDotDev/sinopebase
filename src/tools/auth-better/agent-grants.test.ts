// @new-code-test positive src/tools/auth-better/agent-grants.ts
// @new-code-test negative src/tools/auth-better/agent-grants.ts
// @new-code-test negative src/tools/auth-better/index.ts
import { describe, expect, it } from 'bun:test'
import { agentGrantsFromEnv } from './agent-grants'
import { lookupAgentGrant } from './index'

describe('agentGrantsFromEnv', () => {
  it('enables agent grants only with both an HTTPS resource and consent URL', () => {
    expect(agentGrantsFromEnv({})).toBeUndefined()
    expect(
      agentGrantsFromEnv({
        SINOPEBASE_AGENT_GRANT_RESOURCE: 'https://app.example.com/mcp',
        SINOPEBASE_AGENT_GRANT_CONSENT_URL: 'https://app.example.com/oauth/consent',
      }),
    ).toEqual({
      resource: 'https://app.example.com/mcp',
      consentUrl: 'https://app.example.com/oauth/consent',
    })
    expect(
      agentGrantsFromEnv({
        SINOPEBASE_AGENT_GRANT_RESOURCE: 'http://127.0.0.1:5173/mcp',
        SINOPEBASE_AGENT_GRANT_CONSENT_URL: 'http://localhost:5173/oauth/consent',
      }),
    ).toBeDefined()
  })

  it('refuses half or unsafe configuration instead of running without it', () => {
    const resourceOnly = { SINOPEBASE_AGENT_GRANT_RESOURCE: 'https://app.example.com/mcp' }
    expect(() => agentGrantsFromEnv(resourceOnly)).toThrow('SINOPEBASE_AGENT_GRANT_CONSENT_URL')
    const consentOnly = {
      SINOPEBASE_AGENT_GRANT_CONSENT_URL: 'https://app.example.com/oauth/consent',
    }
    expect(() => agentGrantsFromEnv(consentOnly)).toThrow('resource')
    for (const unsafe of [
      'http://app.example.com/mcp',
      'https://user:pass@app.example.com/mcp',
      'https://app.example.com/mcp#fragment',
      'not a url',
    ]) {
      expect(() =>
        agentGrantsFromEnv({
          SINOPEBASE_AGENT_GRANT_RESOURCE: unsafe,
          SINOPEBASE_AGENT_GRANT_CONSENT_URL: 'https://app.example.com/oauth/consent',
        }),
      ).toThrow('resource')
    }
  })
})

describe('lookupAgentGrant', () => {
  it('resolves nothing when agent grants are not configured', async () => {
    expect(await lookupAgentGrant({}, 'sinope_at_anything')).toBeNull()
    expect(await lookupAgentGrant({ __db: {} }, 'sinope_at_anything')).toBeNull()
  })
})
