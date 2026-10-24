import test from "node:test";
import assert from "node:assert/strict";
import { newRun, act, enemyTurnPlayback } from "../src/engine.js";
import { chooseAction, chooseProgress } from "./strategy.js";

function play(s, key, target) {
  const c = { uid: `test-${s.nextId++}`, key, upgraded: false };
  s.hand.push(c);
  s.energy = 20;
  return act(s, { type: "play", uid: c.uid, target });
}

function quiet() {
  const s = newRun(71);
  s.enemies = [];
  s.contracts = [];
  s.boss.hp = s.boss.maxHp = 100;
  return s;
}

function assertPlayback(s) {
  const input = structuredClone(s);
  const expected = act(s, { type: "endTurn" });
  const playback = enemyTurnPlayback(s);
  assert.deepEqual(playback.state, expected);
  assert.deepEqual(s, input, "Playback must leave its input unchanged");
  for (const frame of playback.frames) {
    assert.ok(frame.before && frame.after && frame.cue);
    assert.deepEqual(
      frame.effects,
      frame.after.effects.slice(frame.before.effects.length),
      "Only effects created during this frame are presented",
    );
    assert.ok(frame.cue.sourceId && frame.cue.targetId && frame.cue.label);
  }
  return playback;
}

test("each opening enemy attack has its own exact target, damage and effects", () => {
  const s = newRun(123);
  const { frames } = assertPlayback(s);
  const attacks = frames.filter((f) => f.cue.type === "attack");
  assert.equal(attacks.length, 3);
  assert.deepEqual(
    attacks.map((f) => f.cue.sourceId),
    s.enemies.map((u) => u.uid),
  );
  assert.deepEqual(
    attacks.map((f) => f.cue.targetId),
    ["hero", "hero", "hero"],
  );
  assert.deepEqual(
    attacks.map((f) => f.before.hero.hp),
    [40, 38, 36],
  );
  assert.deepEqual(
    attacks.map((f) => f.after.hero.hp),
    [38, 36, 35],
  );
  assert.deepEqual(
    attacks.map((f) => f.effects.length),
    [1, 1, 1],
  );
  assert.equal(frames.at(-1).cue.type, "contract");
  assert.equal(frames.at(-1).cue.effect, "strike");
  assert.equal(frames.at(-1).after.hero.hp, 32);
});

test("a guard killed in combat stays in before and later attackers choose a new target", () => {
  let s = play(newRun(123), "sentinel");
  const guard = s.allies[0];
  guard.hp = 2;
  s.enemies[0].hp = 2;
  const { frames } = assertPlayback(s);
  const attacks = frames.filter((f) => f.cue.type === "attack");
  assert.equal(attacks[0].cue.targetId, guard.uid);
  assert.equal(attacks[0].cue.targetName, guard.name);
  assert.ok(attacks[0].before.allies.some((u) => u.uid === guard.uid));
  assert.equal(
    attacks[0].after.allies.some((u) => u.uid === guard.uid),
    false,
  );
  assert.equal(
    attacks[0].after.enemies.some((u) => u.uid === s.enemies[0].uid),
    false,
  );
  assert.equal(attacks[1].cue.targetId, "hero");
  assert.equal(attacks[2].cue.targetId, "hero");
  assert.ok(attacks[0].effects.some((e) => e.target === guard.uid));
  assert.ok(attacks[0].effects.some((e) => e.target === s.enemies[0].uid));
});

test("a summoned enemy appears in its own frame and cannot attack before the following enemy turn", () => {
  const s = quiet();
  const summon = newRun(71).contracts.find((c) => c.effect === "summon");
  s.contracts = [{ ...summon, due: 2 }];
  const { state, frames } = assertPlayback(s);
  assert.equal(frames.length, 1);
  const frame = frames[0];
  assert.equal(frame.cue.type, "summon");
  assert.equal(frame.before.enemies.length, 0);
  assert.equal(frame.after.enemies.length, 1);
  const arrival = frame.after.enemies[0];
  assert.equal(frame.cue.targetId, arrival.uid);
  assert.equal(frame.cue.targetName, arrival.name);
  assert.equal(state.hero.hp, 40);
  assert.equal(
    frames.some((f) => f.cue.type === "attack"),
    false,
  );
  assert.ok(
    assertPlayback(state).frames.some(
      (f) => f.cue.type === "attack" && f.cue.sourceId === arrival.uid,
    ),
  );
});

test("betrayal is a summon cue for the existing knight id without an immediate attack", () => {
  let s = play(quiet(), "borrowedKnight");
  const knight = s.allies[0];
  s.contracts[0].due = 2;
  const { state, frames } = assertPlayback(s);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].cue.type, "summon");
  assert.equal(frames[0].cue.targetId, knight.uid);
  assert.equal(frames[0].cue.effect, "betrayal");
  assert.ok(frames[0].before.allies.some((u) => u.uid === knight.uid));
  assert.ok(frames[0].after.enemies.some((u) => u.uid === knight.uid));
  assert.equal(state.hero.hp, 40);
});

test("an enemy lethal stops playback before later attacks, time advancement and contracts", () => {
  const s = newRun(12);
  s.hero.hp = 1;
  const { state, frames } = assertPlayback(s);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].cue.type, "attack");
  assert.equal(frames[0].after.phase, "lost");
  assert.equal(state.turn, 1);
  assert.deepEqual(frames[0].after, state);
});

test("burn ticks are separate frames and burned enemies never attack", () => {
  const s = newRun(4);
  s.boss.burn = 1;
  s.enemies[0].burn = 3;
  const burned = s.enemies[0].uid;
  const { frames } = assertPlayback(s);
  assert.deepEqual(
    frames.slice(0, 2).map((f) => f.cue.type),
    ["burn", "burn"],
  );
  assert.equal(frames[0].cue.targetId, "boss");
  assert.equal(frames[1].cue.targetId, burned);
  assert.equal(
    frames[1].after.enemies.some((u) => u.uid === burned),
    false,
  );
  assert.equal(
    frames.some((f) => f.cue.type === "attack" && f.cue.sourceId === burned),
    false,
  );
});

test("all existing burn ticks occur before victory cleanup and unpaid victory debt can still cause loss", () => {
  let s = play(newRun(4), "borrowedFlame", "boss");
  s.hero.hp = 5;
  s.boss.hp = 1;
  s.boss.burn = 1;
  s.enemies[0].burn = 1;
  const { state, frames } = assertPlayback(s);
  assert.deepEqual(
    frames.map((f) => f.cue.type),
    ["burn", "burn"],
  );
  assert.equal(frames[0].after.boss.hp, 0);
  assert.equal(
    frames[0].after.phase,
    "battle",
    "Original batch burn cleanup is preserved",
  );
  assert.equal(state.phase, "lost");
  assert.equal(state.stats.victoryBill, 6);
  assert.equal(state.hero.hp, 0);
  assert.deepEqual(frames.at(-1).after, state);
});

test("collection and writ produce one frame per dynamically ordered payment", () => {
  let s = newRun(7);
  s.phase = "camp";
  s.stage = 1;
  s = act(s, { type: "camp", choice: "rest" });
  s.enemies = [];
  s = play(s, "borrowedFlame", "boss");
  s = play(s, "borrowedFlame", "boss");
  const collect = s.contracts.find((c) => c.effect === "collect");
  s.contracts.push({
    uid: `test-writ-${s.nextId++}`,
    kind: "omen",
    owner: "enemy",
    effect: "writ",
    due: 2,
    order: collect.order + 0.5,
    edits: 0,
    interest: 0,
    amount: 0,
    value: 1,
    rage: 0,
    source: s.boss.name,
    label: "追加罚息",
    text: "追加罚息",
  });
  const { state, frames } = assertPlayback(s);
  assert.deepEqual(
    frames.map((f) => f.cue.effect),
    ["collect", "writ", "blood", "blood"],
  );
  assert.deepEqual(
    frames.slice(2).map((f) => f.cue.value),
    [7, 7],
  );
  assert.deepEqual(
    frames.slice(2).map((f) => f.after.hero.hp),
    [33, 26],
  );
  assert.equal(state.stats.paidLife, 14);
  assert.equal(
    frames[0].after.contracts
      .filter((c) => c.owner === "player")
      .every((c) => c.due === 2),
    true,
  );
});

test("contract lethal includes victory payment, recovery, seeded rewards and insolvency in the final frame", () => {
  for (const hp of [10, 5]) {
    let s = play(quiet(), "borrowedFlame", "boss");
    s = play(s, "transfer", s.contracts[0].uid);
    s.contracts[0].due = 2;
    s = play(s, "borrowedFlame", "boss");
    s.boss.hp = 6;
    s.hero.hp = hp;
    const { state, frames } = assertPlayback(s);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].cue.type, "contract");
    assert.equal(frames[0].cue.targetId, "boss");
    assert.equal(state.stats.victoryBill, 6);
    assert.equal(state.phase, hp === 10 ? "reward" : "lost");
    assert.equal(state.hero.hp, hp === 10 ? 10 : 0);
    assert.deepEqual(frames[0].after, state);
  }
});

test("frames, their effects, final state and input share no mutable snapshots", () => {
  const s = newRun(6);
  const input = structuredClone(s);
  const { state, frames } = assertPlayback(s);
  const expected = structuredClone(state);
  const next = structuredClone(frames[1]);
  frames[0].before.hero.hp = -500;
  frames[0].after.enemies[0].tags.push("changed");
  frames[0].effects[0].value = 999;
  assert.deepEqual(s, input);
  assert.deepEqual(state, expected);
  assert.deepEqual(frames[1], next);
  assert.notEqual(frames[0].after.effects[0].value, 999);
});

test("invalid enemy-turn requests preserve act's rollback and return no frames", () => {
  const s = newRun(6);
  s.phase = "lost";
  const { state, frames } = assertPlayback(s);
  assert.ok(state.notice);
  assert.deepEqual(frames, []);
});

test("seeded full expeditions preserve exact end-turn results including shuffled draws and rewards", () => {
  for (const difficulty of ["story", "normal", "eclipse"]) {
    let s = newRun(571, difficulty);
    let steps = 0;
    let playbackTurns = 0;
    while (!["won", "lost"].includes(s.phase) && steps++ < 900) {
      const action = s.phase === "battle" ? chooseAction(s) : chooseProgress(s);
      if (action.type === "endTurn") {
        s = assertPlayback(s).state;
        playbackTurns++;
      } else s = act(s, action);
      assert.equal(s.notice, "");
    }
    assert.ok(steps < 900);
    assert.ok(playbackTurns > 10);
    assert.equal(s.phase, "won");
  }
});
