import { z } from 'zod';
import type { MemoryProcessIdentity, MemorySessionTarget } from './xcode-memory-session.js';

const resources = ['launcher', 'helper', 'xcode', 'document', 'debugger', 'aut'] as const;
export type MemoryOwnedResource = (typeof resources)[number];
type State = 'not_created' | 'creation_pending' | 'owned' | 'closed' | 'unknown';
type Ticket = Readonly<{ resource: MemoryOwnedResource }>;
export type MemoryClosureProof = Readonly<{ protocolVersion: 3; sessionId: string }>;
const identitySchema = z
  .object({
    deviceId: z.string().min(1).max(256),
    bundleId: z.string().min(1).max(256),
    buildReference: z.string().min(1).max(4096),
    executable: z.string().min(1).max(4096),
    pid: z.number().int().positive(),
    generation: z.string().min(1).max(256),
  })
  .strict();
const same = (a: MemoryProcessIdentity, b: MemoryProcessIdentity) =>
  Object.keys(a).every(
    (key) => a[key as keyof MemoryProcessIdentity] === b[key as keyof MemoryProcessIdentity],
  );

/** Owner-local evidence ledger, never a decoder for caller-submitted cleanup JSON.
 * Observation callbacks must come from the owner of each actual resource. Helpers
 * cannot observe their own exit: that callback belongs to the launcher/parent.
 */
export class MemoryResourceClosure {
  readonly sessionId: string;
  #states = new Map<MemoryOwnedResource, State>(resources.map((r) => [r, 'not_created']));
  #tickets = new Map<Ticket, { instance?: object; closed?: () => boolean }>();
  #target?: MemorySessionTarget;
  #identity?: MemoryProcessIdentity;
  #frozen = false;
  #proof?: MemoryClosureProof;
  #consumed = false;
  constructor(sessionId: string, target?: MemorySessionTarget) {
    this.sessionId = z.string().uuid().parse(sessionId);
    this.#target =
      target && Object.freeze(identitySchema.omit({ pid: true, generation: true }).parse(target));
  }
  get noTargetEligible() {
    return (
      !this.#identity &&
      !this.#frozen &&
      (['xcode', 'document', 'debugger', 'aut'] as const).every(
        (r) => this.#states.get(r) === 'not_created',
      )
    );
  }
  get active() {
    return this.#frozen || this.#tickets.size > 0 || this.#identity !== undefined;
  }
  #open() {
    if (this.#frozen) throw new Error('closure.frozen');
  }
  snapshot() {
    return Object.fromEntries(this.#states);
  }
  begin(resource: MemoryOwnedResource): Ticket {
    this.#open();
    if (this.#states.get(resource) !== 'not_created') throw new Error('closure.transition');
    this.#states.set(resource, 'creation_pending');
    const ticket = Object.freeze({ resource });
    this.#tickets.set(ticket, {});
    return ticket;
  }
  acquired(ticket: Ticket, instance: object, isCurrent: () => boolean, isClosed: () => boolean) {
    this.#open();
    const entry = this.#tickets.get(ticket);
    if (!entry || this.#states.get(ticket.resource) !== 'creation_pending')
      throw new Error('closure.transition');
    try {
      if (!isCurrent()) throw new Error();
    } catch {
      this.#states.set(ticket.resource, 'unknown');
      throw new Error('closure.owner_unknown');
    }
    entry.instance = instance;
    entry.closed = isClosed;
    this.#states.set(ticket.resource, 'owned');
  }
  bindIdentity(identity: MemoryProcessIdentity) {
    this.#open();
    const value = identitySchema.parse(identity);
    if (
      !this.#target ||
      Object.keys(this.#target).some(
        (key) =>
          value[key as keyof MemorySessionTarget] !==
          this.#target?.[key as keyof MemorySessionTarget],
      )
    )
      throw new Error('closure.target_unverified');
    if (this.#identity && !same(this.#identity, value)) throw new Error('closure.identity_changed');
    this.#identity = Object.freeze(value);
  }
  closed(ticket: Ticket, instance: object, identity?: MemoryProcessIdentity) {
    this.#open();
    const entry = this.#tickets.get(ticket);
    if (!entry || entry.instance !== instance || this.#states.get(ticket.resource) !== 'owned')
      throw new Error('closure.transition');
    if (ticket.resource === 'aut' || ticket.resource === 'debugger') {
      if (
        !this.#identity ||
        !identity ||
        !identitySchema.safeParse(identity).success ||
        !same(this.#identity, identity)
      ) {
        this.#states.set(ticket.resource, 'unknown');
        throw new Error('closure.identity_unverified');
      }
    }
    try {
      if (!entry.closed?.()) throw new Error();
    } catch {
      this.#states.set(ticket.resource, 'unknown');
      throw new Error('closure.exit_unverified');
    }
    this.#states.set(ticket.resource, 'closed');
  }
  unknown(ticket: Ticket) {
    this.#open();
    if (!this.#tickets.has(ticket)) throw new Error('closure.owner_unknown');
    this.#states.set(ticket.resource, 'unknown');
  }
  prove(): MemoryClosureProof {
    this.#open();
    if ([...this.#states.values()].some((s) => s !== 'closed' && s !== 'not_created'))
      throw new Error('closure.incomplete');
    // Once a physical identity is bound, do not relax any original capture resource proof.
    if (this.#identity && resources.some((r) => this.#states.get(r) !== 'closed'))
      throw new Error('closure.incomplete');
    this.#frozen = true;
    this.#proof = Object.freeze({ protocolVersion: 3, sessionId: this.sessionId });
    return this.#proof;
  }
  consume(proof: MemoryClosureProof) {
    if (!this.#proof || proof !== this.#proof || this.#consumed)
      throw new Error('closure.proof_invalid');
    this.#consumed = true;
  }
}
