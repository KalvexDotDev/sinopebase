/**
 * SMTP mail client implementing the Mailer interface.
 *
 * Port of PocketBase tools/mailer/smtp.go
 * Layer 1 -- imports from Layer 0 tools and nodemailer.
 */

import * as nodemailer from "nodemailer";
import type { Mailer, Message, SendInterceptor } from "./mailer.ts";
import { addressToStrings, SendEvent } from "./mailer.ts";
import { Hook } from "~/tools/hook/hook.ts";
import { html2Text } from "./html2text.ts";
import { PseudorandomString } from "~/tools/security/random.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SMTPAuthPlain = "PLAIN";
export const SMTPAuthLogin = "LOGIN";

// ---------------------------------------------------------------------------
// SMTPConfig
// ---------------------------------------------------------------------------

/**
 * Configuration for the SMTP mail client.
 */
export interface SMTPConfig {
  /** Hostname of the SMTP server. */
  host: string;
  /** Port of the SMTP server. */
  port: number;
  /** SMTP username (optional). */
  username?: string;
  /** SMTP password (optional). */
  password?: string;
  /** Whether to use TLS (default: false). */
  tls?: boolean;
  /** SMTP auth method: "PLAIN" or "LOGIN" (default: "PLAIN"). */
  authMethod?: string;
  /**
   * Optional domain name used for the EHLO/HELO exchange
   * (default: "localhost").
   */
  localName?: string;
}

// ---------------------------------------------------------------------------
// SMTPClient
// ---------------------------------------------------------------------------

/**
 * An SMTP mail client that implements the Mailer interface.
 *
 * Supports both PLAIN and LOGIN authentication methods.
 * The LOGIN method is required by some providers (e.g. Outlook.com).
 */
export class SMTPClient implements Mailer, SendInterceptor {
  private onSendHook: Hook<SendEvent> | null = null;

  private config: SMTPConfig

  constructor(config: SMTPConfig) {
    this.config = config
  }

  // -----------------------------------------------------------------------
  // SendInterceptor
  // -----------------------------------------------------------------------

  /**
   * Returns the send hook for registering interceptors.
   *
   * Interceptors are called in priority order before the email is sent.
   * Each interceptor **must** call `event.next()` to proceed.
   */
  onSend(): Hook<SendEvent> {
    if (this.onSendHook === null) {
      this.onSendHook = new Hook<SendEvent>();
    }
    return this.onSendHook;
  }

  // -----------------------------------------------------------------------
  // Mailer
  // -----------------------------------------------------------------------

  /**
   * Sends an email via SMTP.
   *
   * If interceptors are registered via {@link onSend}, they are triggered
   * first (in priority order) and may modify the message or abort the
   * send by not calling `next()`.
   */
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
    // Build auth
    let auth: { user: string; pass: string } | undefined;
    if (this.config.username || this.config.password) {
      auth = {
        user: this.config.username ?? "",
        pass: this.config.password ?? "",
      };
    }

    // Create transporter
    // nodemailer types don't natively support authMethod, so we use `as any`
    const transporterOptions: Record<string, unknown> = {
      host: this.config.host,
      port: this.config.port,
      secure: this.config.tls ?? false,
      name: this.config.localName ?? "localhost",
    };

    if (auth) {
      transporterOptions['auth'] = {
        user: auth.user,
        pass: auth.pass,
      };
      // For LOGIN auth, nodemailer uses a custom auth mechanism
      if (this.config.authMethod === SMTPAuthLogin) {
        transporterOptions['authMethod'] = "LOGIN";
      }
    }

    const transporter = nodemailer.createTransport(
      transporterOptions as nodemailer.TransportOptions,
    );

    // Build the mail options
    const mailOptions: nodemailer.SendMailOptions = {
      from:
        m.from.name !== ""
          ? `"${m.from.name.replace(/["\\]/g, "\\$&")}" <${m.from.address}>`
          : m.from.address,
      to: addressToStrings(m.to, true).join(", "),
      subject: m.subject,
      html: m.html,
    };

    // Plain text body
    if (m.text !== "") {
      mailOptions.text = m.text;
    } else if (m.html !== "") {
      // Try to generate a plain text version from HTML
      try {
        mailOptions.text = html2Text(m.html);
      } catch {
        // Fall back to no text version
      }
    }

    // BCC
    if (m.bcc.length > 0) {
      mailOptions.bcc = addressToStrings(m.bcc, true).join(", ");
    }

    // CC
    if (m.cc.length > 0) {
      mailOptions.cc = addressToStrings(m.cc, true).join(", ");
    }

    // Custom headers
    const resolvedHeaders: Record<string, string> = { ...m.headers };

    const hasMessageIdHeader = Object.keys(resolvedHeaders).some(
      (k) => k.toLowerCase() === "message-id",
    );

    if (!hasMessageIdHeader && m.from.address.includes("@")) {
      const domain = m.from.address.split("@")[1];
      if (domain) {
        resolvedHeaders["Message-ID"] = `<${PseudorandomString(15)}@${domain}>`;
      }
    }

    if (Object.keys(resolvedHeaders).length > 0) {
      mailOptions.headers = resolvedHeaders;
    }

    // Attachments
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const attachments: { filename?: string; content?: any; cid?: string }[] = [];

    for (const [filename, stream] of Object.entries(m.attachments)) {
      attachments.push({
        filename,
        content: stream,
      });
    }

    // Inline attachments
    for (const [filename, stream] of Object.entries(m.inlineAttachments)) {
      attachments.push({
        filename,
        content: stream,
        cid: filename,
      });
    }

    if (attachments.length > 0) {
      mailOptions.attachments = attachments;
    }

    await transporter.sendMail(mailOptions);
  }
}
