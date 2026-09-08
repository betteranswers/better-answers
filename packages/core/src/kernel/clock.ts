/**
 * The platform's one reading of the wall clock (ADR 0040): a value, not a door — the four
 * stores are the doors (ADR 0029), and a clock reads nothing any of them holds. The api
 * constructs one `systemClock()` at boot and hands the reading on explicitly to every act
 * in `core` that needs the platform's current instant, so a test pins the instant by
 * constructing its own `Clock` or by writing down its own literal `Date`, never by racing
 * the real one.
 *
 * **Scope.** The Clock decides only what the app tier decides in code: `open`'s trust
 * reading, a written concept's `published_at` on first publish, an invitation's expiry,
 * and the git door's commit instant. A row's own timestamp is never the Clock's — the
 * ledger's instant, the queue's claim/heartbeat/finish and every other store default stay
 * the database's transaction time, `now()`, because a row is when the store committed it
 * and not when the api asked. The worker reads no wall clock and is handed no Clock; its
 * one clock-shaped read is the ULID minter's (`packages/schema/src/ulid.ts`), which reads
 * time to order an id and decides nothing.
 *
 * **Not a defaulted parameter.** A `Date` argument defaulted at its own function still
 * reads the clock, from inside the function it defaults on — a caller who forgets the
 * argument gets the ambient read anyway, which is the thing this ADR refuses. Every site
 * that used to default one now takes its `Date` with no default, or a `Clock` where it
 * hands the reading on to more than one call of its own (ADR 0040's shape rule).
 */
export type Clock = {
  readonly now: () => Date;
};

/** The real Clock, and the one construction of the platform's own instant either tier's `src` may make. */
export const systemClock = (): Clock => ({ now: () => new Date() });
