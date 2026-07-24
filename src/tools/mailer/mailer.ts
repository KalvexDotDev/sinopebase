/**
 * Mailer interface and shared types for email sending.
 *
 * Port of PocketBase tools/mailer/mailer.go
 * Layer 1 -- imports from Layer 0 tools.
 */

import { Event } from "~/tools/hook/event.ts";
import type { Hook } from "~/tools/hook/hook.ts";

// ---------------------------------------------------------------------------
// Address
// ---------------------------------------------------------------------------

/**
 * Represents an email address with an optional display name.
 */
export interface Address {
  name: string;
  address: string;
}

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

/**
 * Defines a generic email message struct.
 */
export class Message {
  from: Address = { name: "", address: "" };
  to: Address[] = [];
  bcc: Address[] = [];
  cc: Address[] = [];
  subject = "";
  html = "";
  text = "";
  headers: Record<string, string> = {};
  attachments: Record<string, ReadableStream | Buffer> = {};
  inlineAttachments: Record<string, ReadableStream | Buffer> = {};
}

// ---------------------------------------------------------------------------
// Mailer interface
// ---------------------------------------------------------------------------

/**
 * Base mail client interface.
 */
export interface Mailer {
  /** Sends an email with the provided Message. */
  send(message: Message): Promise<void>;
}

// ---------------------------------------------------------------------------
// SendInterceptor
// ---------------------------------------------------------------------------

/**
 * Optional interface for registering mail send hooks.
 */
export interface SendInterceptor {
  onSend(): Hook<SendEvent>;
}

// ---------------------------------------------------------------------------
// SendEvent
// ---------------------------------------------------------------------------

/**
 * Event payload triggered before an email is sent.
 *
 * Interceptors can modify the message or abort sending by
 * not calling `next()`.
 */
export class SendEvent extends Event {
  message: Message

  constructor(message: Message) {
    super();
    this.message = message
  }
}

// ---------------------------------------------------------------------------
// addressToStrings
// ---------------------------------------------------------------------------

/**
 * Converts an array of addresses to serialized RFC 5322 strings.
 *
 * When `withName` is true and the address has a display name,
 * the full `"Name <email>"` format is used. Otherwise only
 * the bare email part is returned.
 */
export function addressToStrings(
  addresses: Address[],
  withName: boolean,
): string[] {
  return addresses.map((addr) => {
    if (withName && addr.name !== "") {
      // RFC 5322: "Display Name" <email>
      const encodedName = addr.name.includes('"') || addr.name.includes("\\")
        ? addr.name
        : addr.name.includes(",") || addr.name.includes(".")
          ? `"${addr.name}"`
          : addr.name;
      return `${encodedName} <${addr.address}>`;
    }
    return addr.address;
  });
}
