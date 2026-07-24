/**
 * Subscription message format.
 *
 * Port of PocketBase tools/subscriptions/message.go (MIT license).
 * Layer 1 -- imports Layer 0 (~/tools/...).
 */

/**
 * Message defines a subscription message with a name and payload data.
 *
 * @example
 * ```ts
 * const msg = new Message("users/create", new TextEncoder().encode(JSON.stringify({ id: "abc" })));
 * ```
 */
export class Message {
  /**
   * @param name - The event name (e.g. "users/create").
   * @param data - The raw payload bytes.
   */
  readonly name: string
  readonly data: Uint8Array

  constructor(
    name: string,
    data: Uint8Array,
  ) {
    this.name = name
    this.data = data
  }

  /**
   * Returns a JSON representation of the message.
   */
  toJSON(): { name: string; data: string } {
    return {
      name: this.name,
      data: new TextDecoder().decode(this.data),
    };
  }

  /**
   * Deserializes a plain object into a Message.
   */
  static fromJSON(json: { name: string; data: string }): Message {
    return new Message(json.name, new TextEncoder().encode(json.data));
  }

  /**
   * Serializes this message to a Server-Sent Events (SSE) format string.
   *
   * Format:
   *   id:<eventId>\n
   *   event:<name>\n
   *   data:<payload>\n
   *   \n
   */
  writeSSE(eventId: string): string {
    const decoder = new TextDecoder();
    const dataStr = decoder.decode(this.data);
    return [
      `id:${eventId}`,
      `event:${this.name}`,
      `data:${dataStr}`,
      "",
      "",
    ].join("\n");
  }
}
