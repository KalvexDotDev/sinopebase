// Edge Function: POST /api/functions/v1/ping-realtime
// Broadcasts by inserting into todos, which triggers a postgres_changes realtime event.
// Test: curl -X POST http://localhost:8090/api/functions/v1/ping-realtime -d '{"text":"hello"}'

export default async function(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({}))
  const text = (body as any).text || 'ping'

  try {
    await fetch('http://127.0.0.1:8090/rest/v1/todos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer q9hNw0mVgHJiSD6b8GX4oPOFuMcCpsKBeU2zyYEQr7Wx5nAa',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({ task: text, user_id: 'realtime-demo' }),
    })

    return new Response(JSON.stringify({
      message: `Inserted todo "${text}" — a postgres_changes event was published to realtime:public:todos.`,
      next: 'Open the Realtime Inspector tab to see the event.',
    }), { headers: { 'Content-Type': 'application/json' } })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 })
  }
}
