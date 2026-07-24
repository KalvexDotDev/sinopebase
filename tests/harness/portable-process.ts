import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface PortableCommand {
  command: string
  args: readonly string[]
}

/** A shell-free subprocess fixture that behaves the same on Windows and POSIX. */
export function stderrFixtureCommand(message: string, exitCode = 1): PortableCommand {
  if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) {
    throw new Error('exitCode must be an integer from 0 through 255')
  }

  return {
    command: process.execPath,
    args: [
      '-e',
      `process.stderr.write(${JSON.stringify(message)}); process.exit(${exitCode})`,
    ],
  }
}

/** Convert import.meta.url without Windows' leading-slash/percent-encoding bugs. */
export function moduleDirectory(moduleUrl: string): string {
  return dirname(fileURLToPath(moduleUrl))
}
