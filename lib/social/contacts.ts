export type ContactState = "pending" | "accepted" | "blocked" | "removed";

export interface PlayerContact {
  id: string;
  requesterId: string;
  recipientId: string;
  state: ContactState;
  createdAt: string;
  updatedAt: string;
}

function pair(left: string, right: string): string {
  return [left, right].sort().join(":");
}

export class ContactBook {
  readonly #contacts = new Map<string, PlayerContact>();
  readonly #pairs = new Map<string, string>();

  request(id: string, requesterId: string, recipientId: string, at: string | Date): PlayerContact {
    if (!id.trim() || !requesterId.trim() || !recipientId.trim()) throw new RangeError("contact fields cannot be blank");
    if (requesterId === recipientId) throw new RangeError("player cannot add themselves as a contact");
    const key = pair(requesterId, recipientId);
    const existingId = this.#pairs.get(key);
    if (existingId) {
      const existing = this.#contacts.get(existingId)!;
      if (existing.state !== "removed") return existing;
    }
    const timestamp = new Date(at).toISOString();
    const contact = { id: id.trim(), requesterId, recipientId, state: "pending" as const, createdAt: timestamp, updatedAt: timestamp };
    if (this.#contacts.has(contact.id)) throw new Error("contact id already exists");
    this.#contacts.set(contact.id, contact);
    this.#pairs.set(key, contact.id);
    return contact;
  }

  respond(id: string, playerId: string, accept: boolean, at: string | Date): PlayerContact {
    const contact = this.get(id);
    if (contact.recipientId !== playerId || contact.state !== "pending") throw new Error("contact request cannot be answered");
    const changed = { ...contact, state: (accept ? "accepted" : "removed") as ContactState, updatedAt: new Date(at).toISOString() };
    this.#contacts.set(id, changed);
    return changed;
  }

  block(id: string, playerId: string, at: string | Date): PlayerContact {
    const contact = this.get(id);
    if (![contact.requesterId, contact.recipientId].includes(playerId)) throw new Error("player is not part of this contact")
    const changed = { ...contact, state: "blocked" as const, updatedAt: new Date(at).toISOString() };
    this.#contacts.set(id, changed);
    return changed;
  }

  contacts(playerId: string): readonly PlayerContact[] {
    return [...this.#contacts.values()]
      .filter((contact) => [contact.requesterId, contact.recipientId].includes(playerId) && contact.state === "accepted")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  canInteract(left: string, right: string): boolean {
    const id = this.#pairs.get(pair(left, right));
    return Boolean(id && this.#contacts.get(id)?.state === "accepted");
  }

  get(id: string): PlayerContact {
    const contact = this.#contacts.get(id);
    if (!contact) throw new Error("contact was not found");
    return contact;
  }
}
