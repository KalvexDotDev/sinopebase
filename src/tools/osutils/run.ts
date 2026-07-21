/**
 * RunCommand executes an external command and captures its output.
 *
 * Port of Go's os/exec.Command pattern (Go -> TypeScript).
 * Layer 0: zero internal dependencies.
 *
 * Uses Bun.spawn() for process execution.
 *
 * @example
 *   const result = await RunCommand("echo", ["hello", "world"])
 *   console.log(result.stdout) // "hello world\n"
 *   console.log(result.exitCode) // 0
 *
 *   const result = await RunCommand("cat", ["nonexistent"])
 *   console.log(result.stderr) // "cat: nonexistent: No such file or directory\n"
 *   console.log(result.exitCode) // 1
 */

// --------------------------------------------------
// Types
// --------------------------------------------------

/**
 * The result of running an external command.
 */
export interface RunResult {
  /** Standard output content. */
  stdout: string;
  /** Standard error content. */
  stderr: string;
  /** Process exit code (0 for success). */
  exitCode: number;
}

// --------------------------------------------------
// Public API
// --------------------------------------------------

/**
 * Runs an external command and captures its stdout, stderr, and exit code.
 *
 * @param cmd  - The command to execute (e.g. "ls", "git", "node").
 * @param args - Optional list of command-line arguments.
 * @returns A RunResult with captured stdout, stderr, and exit code.
 * @throws If the command cannot be spawned (e.g. not found).
 */
export async function RunCommand(
  cmd: string,
  args: string[] = [],
): Promise<RunResult> {
  const proc = Bun.spawn([cmd, ...args], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  const [stdoutBuffer, stderrBuffer] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exited = await proc.exited;

  return {
    stdout: stdoutBuffer,
    stderr: stderrBuffer,
    exitCode: exited,
  };
}
