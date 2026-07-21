export const meta = {
  name: 'phase2-mastra-integration',
  description: 'Phase 2: Real Mastra agent/tool/MCP integration',
  phases: [
    { title: 'Build', detail: 'Agent system, MCP tools, auth bridge' },
    { title: 'Wire', detail: 'Update plugin, routes' },
    { title: 'Test', detail: 'Agent tests' },
  ],
}

phase('Build')

const agentSystem = await agent(
  'Write D:\\Projects\\sinopebase\\src\\tools\\ai\\mastra\\agent.ts\n' +
  'Agent class compatible with Mastra API conventions.\n' +
  'Since @mastra/core may not be Bun-compatible, build a compatible Agent abstraction.\n' +
  'class Agent {\n' +
  '  constructor(config: { id: string, name: string, instructions: string, model?: string, tools?: Tool[] })\n' +
  '  async generate(messages: Array<{role:string,content:string}>, options?: { maxSteps?: number }): Promise<{ text: string, toolCalls?: Array<{name,args,result}>, usage?: { promptTokens, completionTokens, totalTokens } }>\n' +
  '  async stream(messages): AsyncIterable<ChatChunk>\n' +
  '}\n' +
  'Uses OpenAIProvider from ~/tools/ai/openai internally.\n' +
  'Tool calling: if tools provided, parse JSON function_call from OpenAI response, execute tool, loop up to maxSteps.\n' +
  'Define Tool interface: { id, name, description, parameters: Record<string,unknown>, execute(input): Promise<unknown> }\n' +
  'Export Agent class, Tool interface, AgentConfig type.\n' +
  'Use ~/ path aliases. Strict TypeScript.',
  { label: 'agent.ts' }
)

const mcpTools = await agent(
  'Write D:\\Projects\\sinopebase\\src\\tools\\ai\\mastra\\mcp-tools.ts\n' +
  'MCP-style tools exposing Sinopebase resources to agents.\n' +
  'Each tool: { id, name, description, parameters, execute(input): Promise<unknown> }\n' +
  'Tools:\n' +
  '1. db_query — { table, filters?, limit? } → queries DB (read-only, max 100 rows, block user/session tables)\n' +
  '2. db_schema — { table } → returns column names + types\n' +
  '3. storage_list — { bucket?, prefix? } → lists files via IFileStore\n' +
  '4. auth_user — {} → returns current user from request context\n' +
  '5. function_invoke — { name, input? } → calls edge function\n' +
  'Export: createMCPTools(db: any, fileStore: any): Tool[]\n' +
  'Each tool wraps calls in try/catch, returns structured results.\n' +
  'Use ~/ path aliases. Strict TypeScript.',
  { label: 'mcp-tools.ts' }
)

const authBridge = await agent(
  'Write D:\\Projects\\sinopebase\\src\\tools\\ai\\mastra\\auth-bridge.ts\n' +
  'Auth bridge: validates better-auth tokens for Mastra API calls.\n' +
  'Export createMastraAuth(auth: SinopebaseAuth) returning { authorize: (req) => Promise<{user}|null> }\n' +
  'Extract Bearer token, call lookupSessionByToken, return user or null.\n' +
  'Import lookupSessionByToken, SinopebaseAuth from ~/tools/auth-better.\n' +
  'Strict TypeScript.',
  { label: 'auth-bridge.ts' }
)

phase('Wire')

await agent(
  'Read D:\\Projects\\sinopebase\\src\\plugins\\mastra\\plugin.ts, UPDATE to add agent routes.\n' +
  '1. Import Agent from ~/tools/ai/mastra/agent\n' +
  '2. Import createMCPTools from ~/tools/ai/mastra/mcp-tools\n' +
  '3. Add agentRoutes Elysia group with:\n' +
  '   POST /api/mastra/agents/:id/chat → agent.generate()\n' +
  '   POST /api/mastra/agents/:id/stream → agent.stream()\n' +
  '   GET /api/mastra/agents → list configured agent IDs\n' +
  '4. Create a default agent from the existing mock/OpenAI provider\n' +
  '5. Keep backward compat: /api/mastra/chat + /api/mastra/embeddings still work\n' +
  '6. Reuse existing validateAIRequest middleware for auth\n' +
  'Keep plugin.ts under 120 lines total.',
  { label: 'plugin.ts upgrade' }
)

phase('Test')

await agent(
  'Write D:\\Projects\\sinopebase\\tests\\plugins\\mastra\\agent.test.ts\n' +
  'Tests for Mastra agent execution.\n' +
  'Import { describe, it, expect, beforeAll, afterAll } from "bun:test", Sinopebase, MastraPlugin.\n' +
  '5 tests: list agents, agent chat, agent stream, 404 for unknown agent, backward compat chat.\n' +
  'Use mock provider, requireAuth: false. Follow existing patterns.',
  { label: 'agent.test.ts' }
)

return { agentSystem, mcpTools, authBridge }
