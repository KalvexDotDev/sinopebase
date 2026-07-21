import { describe, it, expect } from "bun:test";
import { DefaultClient } from "./client";
import { Message } from "./message";

describe("DefaultClient", () => {
  it("creates a client with an auto-generated id", () => {
    const client = new DefaultClient();
    expect(client.id()).toBeTruthy();
    expect(client.id().length).toBe(40);
  });

  it("creates a client with a custom id", () => {
    const client = new DefaultClient("custom-id");
    expect(client.id()).toBe("custom-id");
  });

  it("starts as not discarded", () => {
    const client = new DefaultClient();
    expect(client.isDiscarded()).toBe(false);
  });

  it("discard marks client as discarded", () => {
    const client = new DefaultClient();
    client.discard();
    expect(client.isDiscarded()).toBe(true);
  });

  it("discard is idempotent", () => {
    const client = new DefaultClient();
    client.discard();
    client.discard(); // should not throw
    expect(client.isDiscarded()).toBe(true);
  });

  it("subscribe adds subscriptions", () => {
    const client = new DefaultClient();
    client.subscribe("topic1", "topic2");

    const subs = client.subscriptions();
    expect(Object.keys(subs)).toEqual(["topic1", "topic2"]);
  });

  it("subscribe ignores empty strings", () => {
    const client = new DefaultClient();
    client.subscribe("topic1", "", "topic2");

    const subs = client.subscriptions();
    expect(Object.keys(subs)).toEqual(["topic1", "topic2"]);
  });

  it("hasSubscription returns correct state", () => {
    const client = new DefaultClient();
    expect(client.hasSubscription("topic1")).toBe(false);

    client.subscribe("topic1");
    expect(client.hasSubscription("topic1")).toBe(true);
    expect(client.hasSubscription("topic2")).toBe(false);
  });

  it("unsubscribe removes specific subscriptions", () => {
    const client = new DefaultClient();
    client.subscribe("topic1", "topic2", "topic3");
    client.unsubscribe("topic2");

    const subs = client.subscriptions();
    expect(Object.keys(subs)).toEqual(["topic1", "topic3"]);
  });

  it("unsubscribe with no args removes all subscriptions", () => {
    const client = new DefaultClient();
    client.subscribe("topic1", "topic2");
    client.unsubscribe();

    expect(Object.keys(client.subscriptions())).toEqual([]);
  });

  it("subscriptions with prefix filters correctly", () => {
    const client = new DefaultClient();
    client.subscribe("users/create", "users/update", "posts/create");

    const subs = client.subscriptions("users/");
    expect(Object.keys(subs).sort()).toEqual(["users/create", "users/update"]);
  });

  it("subscribe can parse options from query string", () => {
    const client = new DefaultClient();
    client.subscribe(`topic1?options={"query":{"a":"1"},"headers":{"X-Token":"abc"}}`);

    const subs = client.subscriptions();
    const opts = subs[`topic1?options={"query":{"a":"1"},"headers":{"X-Token":"abc"}}`];
    expect(opts).toBeDefined();
    expect(opts.query).toEqual({ a: "1" });
    expect(opts.headers).toEqual({ x_token: "abc" }); // snakecased
  });

  it("context store works", () => {
    const client = new DefaultClient();
    expect(client.get("key")).toBeUndefined();

    client.set("key", "value");
    expect(client.get("key")).toBe("value");

    client.unset("key");
    expect(client.get("key")).toBeUndefined();
  });

  it("send invokes onMessage callback", () => {
    const client = new DefaultClient();
    const messages: Message[] = [];

    client.onMessage = (m) => {
      messages.push(m);
    };

    const msg = new Message("test", new TextEncoder().encode("data"));
    client.send(msg);

    expect(messages).toHaveLength(1);
    expect(messages[0]!.name).toBe("test");
  });

  it("send does nothing when discarded", () => {
    const client = new DefaultClient();
    const messages: Message[] = [];

    client.onMessage = (m) => {
      messages.push(m);
    };

    client.discard();
    client.send(new Message("test", new TextEncoder().encode("data")));

    expect(messages).toHaveLength(0);
  });
});
