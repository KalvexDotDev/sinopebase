/**
 * Sendmail mail client implementing the Mailer interface.
 *
 * Sends emails via the local "sendmail" command.
 * Port of PocketBase tools/mailer/sendmail.go
 * Layer 1 -- imports from Layer 0 tools.
 */

import { spawn } from "node:child_process";
import type { Mailer, Message, SendInterceptor } from "./mailer.ts";
import { addressToStrings, SendEvent } from "./mailer.ts";
import { Hook } from "~/tools/hook/hook.ts";

// ---------------------------------------------------------------------------
// Sendmail
// ---------------------------------------------------------------------------

/**
 * A mail client that sends emails via the local "sendmail" command.
 *
 * This client is usually recommended only for development and testing.
 *
 * The sendmail command is invoked as `sendmail -i -t` with the email
 * message piped to its stdin.
 */
export class Sendmail implements Mailer, SendInterceptor {
  private onSendHook: Hook<SendEvent> | null = null;

  /**
   * Optional path to the sendmail executable.
   * If not provided, the following paths are tried in order:
   *   - `/usr/sbin/sendmail`
   *   - `/usr/bin/sendmail`
   *   - `sendmail` (via PATH lookup)
   */
  constructor(private sendmailPath?: string) {}

  // -----------------------------------------------------------------------
  // SendInterceptor
  // -----------------------------------------------------------------------

  onSend(): Hook<SendEvent> {
    if (this.onSendHook === null) {
      this.onSendHook = new Hook<SendEvent>();
    }
    return this.onSendHook;
  }

  // -----------------------------------------------------------------------
  // Mailer
  // -----------------------------------------------------------------------

  async send(message: Message): Promise<void> {
    if (this.onSendHook !== null) {
      await this.onSendHook.trigger(
        new SendEvent(message),
        async (e: SendEvent) => {
          await this.doSend(e.message);
          return e.next();
        },
      );
    } else {
      await this.doSend(message);
    }
  }

  // -----------------------------------------------------------------------
  // Internal send
  // -----------------------------------------------------------------------

  private async doSend(m: Message): Promise<void> {
    const cmdPath = this.sendmailPath ?? (await findSendmailPath());

    // Build email headers
    const headers: string[] = [
      `Subject: ${m.subject}`,
      `From: ${m.from.name !== "" ? `${m.from.name} <${m.from.address}>` : m.from.address}`,
      `Content-Type: text/html; charset=UTF-8`,
      `To: ${addressToStrings(m.to, false).join(",")}`,
    ];

    if (m.cc.length > 0) {
      headers.push(`Cc: ${addressToStrings(m.cc, false).join(",")}`);
    }

    if (m.bcc.length > 0) {
      headers.push(`Bcc: ${addressToStrings(m.bcc, false).join(",")}`);
    }

    // Custom headers
    for (const [key, value] of Object.entries(m.headers)) {
      headers.push(`${key}: ${value}`);
    }

    const body = m.html !== "" ? m.html : m.text;
    const emailContent = `${headers.join("\r\n")}\r\n\r\n${body}`;

    return new Promise<void>((resolve, reject) => {
      const proc = spawn(cmdPath, ["-i", "-t"], {
        stdio: ["pipe", "inherit", "inherit"],
      });

      let hasError = false;

      proc.on("error", (err) => {
        hasError = true;
        reject(new Error(`Failed to run sendmail: ${err.message}`));
      });

      proc.on("exit", (code) => {
        if (!hasError) {
          if (code === 0) {
            resolve();
          } else {
            reject(
              new Error(`sendmail exited with code ${code ?? "null"}`),
            );
          }
        }
      });

      // Write the email content to stdin
      proc.stdin!.write(emailContent, "utf-8");
      proc.stdin!.end();
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find the sendmail executable on the system.
 *
 * Tries the following paths in order:
 *   1. `/usr/sbin/sendmail`
 *   2. `/usr/bin/sendmail`
 *   3. `sendmail` (via PATH)
 *
 * On Windows, returns a reasonable error since sendmail is a Unix tool.
 */
async function findSendmailPath(): Promise<string> {
  const options = [
    "/usr/sbin/sendmail",
    "/usr/bin/sendmail",
    "sendmail",
  ];

  for (const option of options) {
    try {
      const { access } = await import("node:fs/promises");
      // For "sendmail" (no path), check if it's available via PATH
      if (!option.includes("/")) {
        const { execFile } = await import("node:child_process");
        try {
          await new Promise<void>((resolve, reject) => {
            const proc = execFile(
              process.env.ComSpec ? "where" : "which",
              [option],
              { timeout: 1000 },
              (err) => {
                if (err) reject(err);
                else resolve();
              },
            );
          });
          return option;
        } catch {
          continue;
        }
      }
      await access(option);
      return option;
    } catch {
      continue;
    }
  }

  throw new Error("Failed to locate a sendmail executable path");
}
