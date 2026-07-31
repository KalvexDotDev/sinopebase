// Edge Function: POST /api/functions/v1/hello
// Test with: curl -X POST http://localhost:8090/api/functions/v1/hello -H "Content-Type: application/json" -d '{"name":"World"}'

export default {
  async fetch(req: Request): Promise<Response> {
    const body = await req.json().catch(() => ({}))
    const name = (body as any).name || 'World'
    return new Response(JSON.stringify({ message: `Hello, ${name}!` }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
