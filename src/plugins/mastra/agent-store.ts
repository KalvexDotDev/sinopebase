import type { Pool } from 'pg'

export interface AgentConfig {
  id: string
  name: string
  description: string
  instructions: string
  model: string
  createdAt: string
  updatedAt: string
}

interface MastraAgentRow {
  id: string
  name: string
  description: string | null
  instructions: string | null
  model: string | null
  created_at: Date | null
  updated_at: Date | null
}

export async function ensureMastraTables(pool: Pool): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS _mastra_agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', instructions TEXT DEFAULT 'You are a helpful assistant.', model TEXT DEFAULT 'deepseek-chat', created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now())`,
  )
  await pool.query(
    `CREATE TABLE IF NOT EXISTS _mastra_tools (id TEXT PRIMARY KEY, agent_id TEXT REFERENCES _mastra_agents(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT DEFAULT '', schema JSONB DEFAULT '{}')`,
  )
}

export async function loadAgents(pool: Pool): Promise<AgentConfig[]> {
  const { rows } = await pool.query<MastraAgentRow>('SELECT * FROM _mastra_agents ORDER BY name')
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? '',
    instructions: r.instructions ?? '',
    model: r.model ?? 'deepseek-chat',
    createdAt: r.created_at?.toISOString() ?? '',
    updatedAt: r.updated_at?.toISOString() ?? '',
  }))
}

export async function createAgent(
  pool: Pool,
  a: Omit<AgentConfig, 'createdAt' | 'updatedAt'>,
): Promise<AgentConfig> {
  await pool.query(
    'INSERT INTO _mastra_agents (id, name, description, instructions, model) VALUES ($1,$2,$3,$4,$5)',
    [a.id, a.name, a.description, a.instructions, a.model],
  )
  const { rows } = await pool.query<MastraAgentRow>('SELECT * FROM _mastra_agents WHERE id = $1', [a.id])
  const r = rows[0] as MastraAgentRow
  return {
    id: r.id,
    name: r.name,
    description: r.description || '',
    instructions: r.instructions || '',
    model: r.model || 'deepseek-chat',
    createdAt: r.created_at?.toISOString?.() ?? '',
    updatedAt: r.updated_at?.toISOString?.() ?? '',
  }
}

export async function updateAgent(pool: Pool, id: string, a: Partial<AgentConfig>): Promise<void> {
  const sets: string[] = []
  const vals: unknown[] = []
  let i = 1
  for (const [k, v] of Object.entries(a)) {
    if (v !== undefined && k !== 'createdAt' && k !== 'updatedAt') {
      sets.push(`${k} = $${i++}`)
      vals.push(v)
    }
  }
  if (sets.length === 0) return
  sets.push('updated_at = now()')
  await pool.query(`UPDATE _mastra_agents SET ${sets.join(', ')} WHERE id = $${i}`, [...vals, id])
}

export async function deleteAgent(pool: Pool, id: string): Promise<void> {
  await pool.query('DELETE FROM _mastra_agents WHERE id = $1', [id])
}
