import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  GAHKCHA_TRIGGER_POLICY,
  createReplayBypass,
  initialSessionState,
  isExactImageSelection,
  shouldTrigger,
} from "../src/gahkcha/core.js";

const images = [
  { correct: true }, { correct: false }, { correct: true }, { correct: false },
];

test("the first eligible click never triggers", () => {
  const state = initialSessionState();
  assert.equal(shouldTrigger(state, 1_000, () => 0), false);
  assert.equal(state.hasSeenEligibleClick, true);
});

test("cooldown and session maximum prevent appearances", () => {
  const state = { hasSeenEligibleClick: true, appearances: 0, lastShownAt: 0 };
  assert.equal(shouldTrigger(state, 1_000, () => 0), true);
  assert.equal(shouldTrigger(state, 1_000 + GAHKCHA_TRIGGER_POLICY.cooldownMs - 1, () => 0), false);
  state.appearances = GAHKCHA_TRIGGER_POLICY.maxAppearances;
  assert.equal(shouldTrigger(state, 1_000 + GAHKCHA_TRIGGER_POLICY.cooldownMs + 1, () => 0), false);
});

test("the replay bypass is active only while replaying and cannot recurse", () => {
  const bypass = createReplayBypass();
  const element = {};
  let interceptions = 0;
  const delegatedHandler = () => {
    if (bypass.isActive(element)) return;
    interceptions += 1;
    bypass.run(element, delegatedHandler);
  };

  assert.equal(bypass.isActive(element), false);
  delegatedHandler();
  assert.equal(interceptions, 1);
  assert.equal(bypass.isActive(element), false);
});

test("image validation accepts only the complete, exact correct set", () => {
  assert.equal(isExactImageSelection(images, [0, 2]), true);
  assert.equal(isExactImageSelection(images, [0, 1, 2]), false, "extra selections fail");
  assert.equal(isExactImageSelection(images, [0]), false, "missing correct selections fail");
});

test("the shipped demo challenge remains a 16-tile grid with six correct answers", () => {
  const source = readFileSync(new URL("../src/gahkcha/challenges.ts", import.meta.url), "utf8");
  const imagePaths = [...source.matchAll(/src: "([^"]+)"/g)].map((match) => match[1]);
  assert.equal(imagePaths.length, 16);
  assert.equal(new Set(imagePaths).size, 16, "each demo tile has a unique local path");
  assert.equal((source.match(/correct: true/g) ?? []).length, 6);
});
