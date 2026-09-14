// Payment/order lifecycle state machine.
// Guards against out-of-order or contradictory events (e.g. a late
// payment.authorized webhook arriving after payment.captured already
// moved the order to 'paid') overwriting a more advanced state.

export const STATES = Object.freeze({
  CREATED: 'created',
  AUTHORIZED: 'authorized',
  PAID: 'paid',
  FAILED: 'failed',
  REFUNDED: 'refunded',
});

const ALLOWED_TRANSITIONS = {
  [STATES.CREATED]: [STATES.AUTHORIZED, STATES.PAID, STATES.FAILED],
  [STATES.AUTHORIZED]: [STATES.PAID, STATES.FAILED],
  [STATES.PAID]: [STATES.REFUNDED],
  [STATES.FAILED]: [],
  [STATES.REFUNDED]: [],
};

/**
 * Returns true if moving from `current` to `next` is a legal transition.
 * Same-state transitions are always allowed (idempotent no-op).
 */
export function canTransition(current, next) {
  if (current === next) return true;
  if (!current) return true; // no existing state yet
  return (ALLOWED_TRANSITIONS[current] || []).includes(next);
}

export default { STATES, canTransition };
