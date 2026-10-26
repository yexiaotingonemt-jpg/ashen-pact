import test from "node:test";
import assert from "node:assert/strict";
import { CARDS } from "../src/data.js";
import { newRun, act, actionFeedback } from "../src/engine.js";
import { playerFrames, damageTargets } from "../src/playback.js";

function add(s, key, upgraded = false) {
  const c = { key, upgraded, uid: `motion-${s.nextId++}` };
  s.hand.push(c);
  s.energy = 30;
  return c;
}
function ready() {
  let s = newRun(139);
  s.boss.hp = s.boss.maxHp = 100;
  const guard = add(s, "sentinel");
  s = act(s, { type: "play", uid: guard.uid });
  for (const owner of ["player", "enemy"])
    s.contracts.push({
      uid: `clause-${owner}`,
      owner,
      kind: "blood",
      amount: 5,
      due: 3,
      order: s.nextId++,
      source: "测试契约",
      edits: 0,
      interest: 0,
    });
  return s;
}

test("every basic and upgraded spell has a source-card frame without changing the computed action", () => {
  for (const [key, definition] of Object.entries(CARDS).filter(
    ([, c]) => c.type === "spell",
  )) {
    for (const upgraded of [false, true]) {
      const before = ready(),
        card = add(before, key, upgraded);
      const target =
        definition.target === "enemy"
          ? "boss"
          : definition.target === "ally"
            ? before.allies[0].uid
            : definition.target === "contract"
              ? `clause-${definition.contractEffect === "foreclose" ? "enemy" : "player"}`
              : undefined;
      const action = { type: "play", uid: card.uid, target };
      const copy = structuredClone(before),
        feedback = actionFeedback(before, action);
      assert.equal(feedback.state.notice, "", key);
      const [frame] = playerFrames(
        before,
        action,
        feedback.state,
        feedback.triggers,
      );
      assert.equal(frame.cue.type, "spell");
      assert.equal(frame.cue.sourceCard.uid, card.uid);
      assert.equal(frame.cue.sourceCard.upgraded, upgraded);
      assert.equal(frame.cue.sourceId, card.uid);
      assert.equal(frame.cue.targetId, target || "hero");
      assert.equal(frame.after, feedback.state);
      assert.equal(frame.triggers, feedback.triggers);
      assert.deepEqual(frame.after, act(before, action));
      assert.deepEqual(before, copy, `${key} presentation mutated its input`);
      if (definition.aoe)
        assert.deepEqual(
          frame.cue.targetIds,
          before.enemies.map((u) => u.uid),
        );
    }
  }
});

test("attack frames preserve both targets in a lethal trade while summons remain arrivals", () => {
  let before = newRun(139);
  const card = add(before, "lancer");
  const summon = { type: "play", uid: card.uid },
    arrival = actionFeedback(before, summon);
  const [entry] = playerFrames(before, summon, arrival.state, arrival.triggers);
  assert.equal(entry.cue.type, "summon");
  assert.equal(entry.cue.targetId, arrival.state.allies[0].uid);
  before = arrival.state;
  const action = {
      type: "attack",
      uid: before.allies[0].uid,
      target: before.enemies[0].uid,
    },
    result = actionFeedback(before, action);
  const [frame] = playerFrames(before, action, result.state, result.triggers);
  assert.equal(frame.cue.type, "attack");
  assert.equal(frame.cue.sourceId, action.uid);
  assert.deepEqual(
    new Set(frame.cue.hitIds),
    new Set([action.uid, action.target]),
  );
  assert.equal(frame.after.allies.length, 0);
  assert.equal(
    frame.after.enemies.some((u) => u.uid === action.target),
    false,
  );
});

test("invalid or nonbattle actions do not create a false cast or attack", () => {
  const s = newRun(139),
    c = add(s, "bolt");
  const action = { type: "play", uid: c.uid, target: "missing" },
    result = actionFeedback(s, action);
  assert(result.state.notice);
  assert.deepEqual(playerFrames(s, action, result.state, result.triggers), []);
  assert.deepEqual(
    playerFrames({ ...s, phase: "camp" }, action, { ...s, notice: "" }),
    [],
  );
});

test("hero skills use their own source instead of borrowing a hand-card identity", () => {
  const before = newRun(139),
    action = { type: "skill", target: "boss" },
    result = actionFeedback(before, action);
  const [frame] = playerFrames(before, action, result.state, result.triggers);
  assert.equal(frame.cue.sourceId, "skill");
  assert.equal(frame.cue.sourceCard, undefined);
  assert.deepEqual(frame.cue.hitIds, ["boss"]);
});

test("red impact targets exclude full blocks and deduplicate multi-hit effects", () => {
  assert.deepEqual(
    damageTargets([
      { type: "hit", target: "hero", value: "格挡" },
      { type: "ward", target: "hero", value: "圣盾" },
      { type: "hit", target: "boss", value: 3 },
      { type: "hit", target: "boss", value: 2 },
      { type: "heal", target: "hero", value: 4 },
    ]),
    ["boss"],
  );
});
