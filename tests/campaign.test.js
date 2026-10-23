import test from "node:test";
import assert from "node:assert/strict";
import { newRun, act, validateSave } from "../src/engine.js";
import { chooseAction, chooseProgress } from "./strategy.js";

for (const difficulty of ["story", "normal", "eclipse"]) {
  test(`${difficulty}: seeded expeditions finish with valid saves across every phase`, () => {
    let wins = 0;
    const visited = new Set();
    for (let seed = 1; seed <= 8; seed++) {
      let state = newRun(seed * 571, difficulty),
        steps = 0;
      while (!["won", "lost"].includes(state.phase) && steps++ < 900) {
        visited.add(state.phase);
        const action =
          state.phase === "battle"
            ? chooseAction(state)
            : chooseProgress(state);
        state = act(state, action);
        assert.equal(state.notice, "", JSON.stringify(action));
        assert.ok(
          validateSave(JSON.parse(JSON.stringify(state))),
          `Invalid save after ${action.type}, phase ${state.phase}, turn ${state.turn}`,
        );
      }
      assert.ok(steps < 900, "An expedition must never get stuck");
      if (state.phase === "won") wins++;
    }
    assert.ok(wins > 0, "At least one tested expedition can be completed");
    for (const phase of ["battle", "reward", "relic", "camp"])
      assert.ok(visited.has(phase), phase);
  });
}
