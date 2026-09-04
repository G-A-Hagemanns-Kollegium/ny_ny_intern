// This is intentionally UX-only policy. It does not verify identity or protect an action.
export const GAHKCHA_TRIGGER_POLICY = Object.freeze({
  chance: 1,
  cooldownMs: 3 * 60 * 1000,
  maxAppearances: 3,
});

export function initialSessionState() {
  return { hasSeenEligibleClick: false, appearances: 0, lastShownAt: 0 };
}

export function shouldTrigger(state, now, random = Math.random) {
  if (!state.hasSeenEligibleClick) {
    state.hasSeenEligibleClick = true;
    return false;
  }

  if (state.appearances >= GAHKCHA_TRIGGER_POLICY.maxAppearances) return false;
  if (state.lastShownAt && now - state.lastShownAt < GAHKCHA_TRIGGER_POLICY.cooldownMs) return false;
  if (random() >= GAHKCHA_TRIGGER_POLICY.chance) return false;

  state.appearances += 1;
  state.lastShownAt = now;
  return true;
}

export function isExactImageSelection(images, selectedIndexes) {
  const selected = new Set(selectedIndexes);
  const correctIndexes = images.flatMap((image, index) => (image.correct ? [index] : []));

  return selected.size === selectedIndexes.length
    && selected.size === correctIndexes.length
    && correctIndexes.every((index) => selected.has(index));
}

export function createReplayBypass() {
  const replaying = new WeakSet();
  return {
    isActive(element) {
      return replaying.has(element);
    },
    run(element, action) {
      replaying.add(element);
      try {
        action();
      } finally {
        replaying.delete(element);
      }
    },
  };
}
