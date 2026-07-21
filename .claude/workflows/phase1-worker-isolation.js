export const meta = {
  name: 'phase1-worker-isolation',
  description: 'Phase 1: Worker isolation for edge functions via Bun Worker',
  phases: [
    { title: 'Write', detail: 'Create worker bootstrap + rewrite sandbox' },
    { title: 'Test', detail: 'Run tests, verify isolation' },
  ],
}

phase('Write')

const workerBootstrap = await agent(
  'Write D:\\Projects\\sinopebase\\src\\plugins\\drop-functions\\sandbox-worker.ts\n' +
  'This is the Bun Worker entry point for executing edge functions in isolation.\n' +
  'Runs inside a separate Worker thread with restricted globals.\n' +
  '\n' +
  'Requirements:\n' +
  '1. Reads Worker data: { filePath, serializedReq, ctx }\n' +
  '2. Dynamic imports the user function from filePath\n' +
  '3. Reconstructs a Request object from serializedReq\n' +
  '4. Calls handler(request, ctx) and posts result back via self.postMessage\n' +
  '5. Sends { type: "result", data } on success\n' +
  '6. Sends { type: "error", error, stack } on failure\n' +
  '7. Uses self.onmessage for the message event\n' +
  '8. Follows existing SandboxMessage types from ../types.ts\n' +
  '9. The handler is accessed as mod.default from the dynamic import\n' +
  '10. Add a comment noting this runs in a Worker isolate with restricted globals',
  { label: 'sandbox-worker.ts' }
)

const sandboxRewrite = await agent(
  'Read D:\\Projects\\sinopebase\\src\\plugins\\drop-functions\\sandbox.ts, then REWRITE it.\n' +
  'Replace the Promise.race implementation with real Bun Worker isolation.\n' +
  '\n' +
  'The new executeInSandbox should:\n' +
  '1. Build the worker bootstrap code (use Bun.file to read sandbox-worker.ts)\n' +
  '2. Create a Blob URL: const blob = new Blob([workerCode], { type: "application/javascript" })\n' +
  '3. Spawn: const worker = new Worker(URL.createObjectURL(blob))\n' +
  '4. Pass serialized data via worker.postMessage({ filePath, serializedReq, ctx })\n' +
  '5. Enforce timeout via setTimeout(() => { worker.terminate(); reject(TimeoutError) }, timeout)\n' +
  '6. Listen for worker.onmessage — clear timeout, resolve with event.data\n' +
  '7. Listen for worker.onerror — clear timeout, reject with error\n' +
  '8. Use try/finally to URL.revokeObjectURL(workerURL)\n' +
  '9. If blob URL approach fails (Bun limitation), fall back to temp file:\n' +
  '   - Write worker bootstrap + user code to os.tmpdir() using Bun.write()\n' +
  '   - Reference as new Worker(pathToTempFile)\n' +
  '10. Import types from ./types.ts (SandboxMessage, SandboxResult, SandboxError)\n' +
  '11. Keep the same function signature: executeInSandbox(filePath, req, ctx, options)\n' +
  '\n' +
  'IMPORTANT:\n' +
  '- The worker code is static (sandbox-worker.ts), but it needs the user function path\n' +
  '- Use Bun.file() to read sandbox-worker.ts content, embed as worker script\n' +
  '- The worker receives { filePath, serializedReq, ctx } via postMessage\n' +
  '- Use smol: true in WorkerOptions for lower memory\n' +
  '- Set env: {} to prevent env inheritance\n' +
  '- Handle both result and error message types from SandboxMessage',
  { label: 'sandbox.ts rewrite' }
)

const executeUpdate = await agent(
  'Read D:\\Projects\\sinopebase\\src\\plugins\\drop-functions\\routes\\execute.ts, then UPDATE the function execution block (around lines 116-148).\n' +
  'Replace the inline Promise.race with a call to the new executeInSandbox from ../sandbox.\n' +
  '\n' +
  'Current code uses:\n' +
  '  const result = await Promise.race([handler(fnRequest, ctx), timeoutPromise])\n' +
  '\n' +
  'Replace with:\n' +
  '  const result = await executeInSandbox(filePath, serializedReq, ctx, { timeout: resolvedConfig.timeout })\n' +
  '\n' +
  'Keep the serializedReq construction (it is needed for the Worker boundary).\n' +
  'Keep the instanceof Response check after execution.\n' +
  'Keep the error handling (catch, timeout detection).\n' +
  'Import executeInSandbox from ../sandbox.\n' +
  'DO NOT change any other part of the file — only the execution call.',
  { label: 'execute.ts update' }
)

phase('Test')

await agent(
  'Write D:\\Projects\\sinopebase\\tests\\plugins\\drop-functions\\sandbox.test.ts\n' +
  'ATDD tests for Worker-isolated function execution.\n' +
  '\n' +
  'Test pattern: import { describe, it, expect, beforeAll, afterAll } from "bun:test"\n' +
  'Import { Sinopebase } from "~/core/app"\n' +
  'Import { DropFunctionsPlugin } from "~/plugins/drop-functions/plugin"\n' +
  'Create temp dir with test functions, start server on port 8093, register plugin.\n' +
  '\n' +
  'Test 1: "executes a function in the sandbox" — POST /api/functions/v1/test-fn\n' +
  '  Write a function that returns { hello: "world" }, assert 200 and correct response\n' +
  '\n' +
  'Test 2: "timeout kills the worker" — POST /api/functions/v1/slow-fn\n' +
  '  Write a function with config.timeout = 500 that sleeps 2000ms\n' +
  '  Assert 504 status (gateway timeout)\n' +
  '\n' +
  'Test 3: "worker errors propagate correctly" — POST /api/functions/v1/error-fn\n' +
  '  Write a function that throws new Error("boom")\n' +
  '  Assert 500 status and error message contains "boom"\n' +
  '\n' +
  'Test 4: "worker cannot access process.env" — POST /api/functions/v1/env-fn\n' +
  '  Write a function that tries to read process.env.JWT_SECRET\n' +
  '  Assert it returns undefined or empty\n' +
  '\n' +
  'Test 5: "Response objects pass through" — POST /api/functions/v1/resp-fn\n' +
  '  Write a function that returns new Response("custom", { status: 201 })\n' +
  '  Assert 201 status and "custom" body\n' +
  '\n' +
  'Use the same patterns as tests/plugins/drop-functions/execute.test.ts',
  { label: 'sandbox.test.ts' }
)

return { workerBootstrap, sandboxRewrite, executeUpdate }
