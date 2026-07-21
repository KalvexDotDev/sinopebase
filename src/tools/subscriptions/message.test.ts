import { describe, it, expect } from "bun:test";
import { Message } from "./message";

describe("Message", () => {
  it("creates a message with name and data", () => {
    const encoder = new TextEncoder();
    const msg = new Message("users/create", encoder.encode(JSON.stringify({ id: "123" })));

    expect(msg.name).toBe("users/create");
    expect(new TextDecoder().decode(msg.data)).toBe('{"id":"123"}');
  });

  it("toJSON serializes correctly", () => {
    const msg = new Message("test", new TextEncoder().encode("hello"));
    const json = msg.toJSON();

    expect(json.name).toBe("test");
    expect(json.data).toBe("hello");
  });

  it("fromJSON deserializes correctly", () => {
    const msg = Message.fromJSON({ name: "events/ping", data: "pong" });

    expect(msg.name).toBe("events/ping");
    expect(new TextDecoder().decode(msg.data)).toBe("pong");
  });

  it("round-trips through JSON", () => {
    const original = new Message("roundtrip", new TextEncoder().encode("data"));
    const json = original.toJSON();
    const restored = Message.fromJSON(json);

    expect(restored.name).toBe(original.name);
    expect(new TextDecoder().decode(restored.data)).toBe(new TextDecoder().decode(original.data));
  });

  it("writeSSE produces correct SSE format", () => {
    const msg = new Message("users/create", new TextEncoder().encode('{"id":"abc"}'));
    const sse = msg.writeSSE("evt_123");

    expect(sse).toBe([
      "id:evt_123",
      "event:users/create",
      'data:{"id":"abc"}',
      "",
      "",
    ].join("\n"));
  });
});
