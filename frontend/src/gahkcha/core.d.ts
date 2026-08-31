export type GahkchaSessionState = {
  hasSeenEligibleClick: boolean;
  appearances: number;
  lastShownAt: number;
};

export declare const GAHKCHA_TRIGGER_POLICY: Readonly<{
  chance: number;
  cooldownMs: number;
  maxAppearances: number;
}>;

export declare function initialSessionState(): GahkchaSessionState;
export declare function shouldTrigger(
  state: GahkchaSessionState,
  now: number,
  random?: () => number,
): boolean;
export declare function isExactImageSelection(
  images: readonly { correct: boolean }[],
  selectedIndexes: readonly number[],
): boolean;
export declare function createReplayBypass(): {
  isActive(element: object): boolean;
  run(element: object, action: () => void): void;
};
