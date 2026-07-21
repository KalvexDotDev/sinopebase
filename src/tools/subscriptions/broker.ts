/**
 * WebSocket pub/sub broker — manages client registrations and message broadcasting.
 *
 * Port of PocketBase tools/subscriptions/broker.go (MIT license).
 * Layer 1 -- imports Layer 0 (~/tools/...).
 */

import { Store } from "~/tools/store/store";
import { ToChunks } from "~/tools/list/list";
import type { Client } from "./client";
import type { Message } from "./message";

/**
 * Broker manages subscription clients.
 *
 * Clients are identified by their unique connection ID and stored in a
 * thread-safe Store.  The broker complements the realtime handler —
 * the realtime handler manages Phoenix Channels subscriptions at the
 * WebSocket level, while the broker manages client registrations and
 * message broadcasting for the application layer.
 */
export class Broker {
  readonly #store = new Store<string, Client>();

  /**
   * Returns a shallow copy of all registered clients indexed by their
   * connection id.
   */
  clients(): Map<string, Client> {
    return this.#store.getAll();
  }

  /**
   * Splits all registered clients into chunks of the specified size.
   *
   * Useful for processing large numbers of clients in batches to avoid
   * blocking the event loop.
   */
  chunkedClients(chunkSize: number): Client[][] {
    return ToChunks([...this.#store.values()], chunkSize);
  }

  /**
   * Returns the total number of registered clients.
   */
  totalClients(): number {
    return this.#store.length;
  }

  /**
   * Returns the client associated with the given id.
   *
   * Throws if no client is found for that id.
   */
  clientById(clientId: string): Client {
    const client = this.#store.get(clientId);
    if (!client) {
      throw new Error(`no client associated with connection id "${clientId}"`);
    }
    return client;
  }

  /**
   * Registers a new client.
   *
   * If a client with the same id already exists it will be replaced.
   */
  register(client: Client): void {
    this.#store.set(client.id(), client);
  }

  /**
   * Unregisters an existing client by id.
   *
   * Calls `client.discard()` before removing it. If the client does not
   * exist this method is a no-op.
   */
  unregister(clientId: string): void {
    const client = this.#store.get(clientId);
    if (!client) return;
    client.discard();
    this.#store.remove(clientId);
  }

  /**
   * Broadcasts a message to all clients subscribed to the given topic.
   *
   * If `topic` is empty, broadcasts to **all** registered clients.
   */
  broadcast(topic: string, message: Message): void {
    for (const client of this.#store.values()) {
      if (client.isDiscarded()) continue;
      if (topic === "" || client.hasSubscription(topic)) {
        client.send(message);
      }
    }
  }

  /**
   * Broadcasts a message to a specific set of clients by their ids.
   *
   * Silently skips unknown or discarded ids.
   */
  broadcastTo(clientIds: string[], message: Message): void {
    for (const id of clientIds) {
      const client = this.#store.get(id);
      if (!client || client.isDiscarded()) continue;
      client.send(message);
    }
  }
}
