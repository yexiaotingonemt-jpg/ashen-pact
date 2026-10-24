import test from "node:test";
import assert from "node:assert/strict";
import {
  newRun,
  act,
  actionFeedback,
  enemyTurnPlayback,
} from "../src/engine.js";
import { chooseAction, chooseProgress } from "./strategy.js";

function quiet() {
  const s = newRun(71);
  s.enemies = [];
  s.contracts = [];
  s.boss.hp = s.boss.maxHp = 100;
  return s;
}

function card(s, key) {
  return { uid: `test-${s.nextId++}`, key, upgraded: false };
}

function prepare(s, key, target) {
  const c = card(s, key);
  s.hand.push(c);
  s.energy = 20;
  return { type: "play", uid: c.uid, target };
}

function use(s, key, target) {
  return act(s, prepare(s, key, target));
}

function feedback(s, action) {
  const original = structuredClone(s);
  const result = actionFeedback(s, action);
  assert.deepEqual(result.state, act(s, action));
  assert.deepEqual(s, original, "Feedback leaves the input untouched");
  assert.equal(result.state.notice, "");
  assert.equal("triggers" in result.state, false);
  for (const t of result.triggers) {
    assert.ok(t.sourceId && t.sourceName && Number.isInteger(t.sourceArt));
    assert.ok(t.targetId && t.targetName && t.ability && t.label);
    assert.equal(t.label.includes(t.sourceName), false);
    assert.equal(t.label.startsWith(t.ability + "："), false);
  }
  return result;
}

test("each weaver draws once for the first manipulation, with the actual new hand ids", () => {
  let s = use(use(quiet(), "weaver"), "weaver");
  s = use(s, "borrowedFlame", "boss");
  const debt = s.contracts[0].uid;
  s.hand = [];
  s.draw = [card(s, "bolt"), card(s, "shield")];
  s.discard = [];
  const expectedIds = s.draw.map((c) => c.uid).reverse();
  const first = feedback(s, prepare(s, "defer", debt));
  assert.deepEqual(
    first.triggers.map((t) => t.sourceId),
    s.allies.map((u) => u.uid),
  );
  assert.deepEqual(
    first.triggers.map((t) => t.ability),
    ["书契", "书契"],
  );
  assert.deepEqual(
    first.triggers.map((t) => t.drawnIds),
    expectedIds.map((id) => [id]),
  );
  for (const t of first.triggers) {
    assert.equal(t.effectType, "draw");
    assert.equal(t.targetId, "hand");
    assert.equal(t.value, 1);
    assert.equal(t.drawn, 1);
    assert.equal(t.discarded, 0);
    assert.ok(first.state.hand.some((c) => c.uid === t.drawnIds[0]));
  }
  const second = feedback(first.state, prepare(first.state, "rewrite", debt));
  assert.deepEqual(second.triggers, []);
});

test("two weavers with one hand slot report one draw and one overflow discard", () => {
  let s = use(use(quiet(), "weaver"), "weaver");
  s = use(s, "borrowedFlame", "boss");
  s.hand = Array.from({ length: 7 }, () => card(s, "shield"));
  const burnt = card(s, "bolt"),
    drawn = card(s, "mend");
  s.draw = [burnt, drawn];
  s.discard = [];
  const result = feedback(s, prepare(s, "rewrite", s.contracts[0].uid));
  assert.equal(result.state.hand.length, 8);
  assert.deepEqual(
    result.triggers.map((t) => t.effectType),
    ["draw", "discard"],
  );
  assert.deepEqual(result.triggers[0].drawnIds, [drawn.uid]);
  assert.deepEqual(result.triggers[1].drawnIds, []);
  assert.equal(result.triggers[1].drawn, 0);
  assert.equal(result.triggers[1].discarded, 1);
  assert.match(result.triggers[1].label, /手牌已满.*余烬飞弹.*弃牌堆/);
  assert.ok(result.state.discard.some((c) => c.uid === burnt.uid));
});

test("weaver fatigue reports actual life loss and armor absorption instead of a draw", () => {
  let s = use(quiet(), "weaver");
  s = use(s, "borrowedFlame", "boss");
  s.hand = [];
  s.draw = [];
  s.discard = [];
  s.fatigue = 1;
  s.hero.shield = 1;
  const result = feedback(s, prepare(s, "rewrite", s.contracts[0].uid));
  const t = result.triggers[0];
  assert.equal(t.ability, "书契");
  assert.equal(t.targetId, "hero");
  assert.equal(t.effectType, "fatigue");
  assert.equal(t.value, 1);
  assert.equal(t.fatigueAmount, 2);
  assert.equal(t.fatigueDamage, 1);
  assert.equal(t.fatigueBlocked, 1);
  assert.equal(t.drawn, 0);
  assert.deepEqual(t.drawnIds, []);
  assert.match(t.label, /牌库耗尽，疲劳损失 1 生命（护甲抵挡 1）/);
  assert.equal(result.state.hero.hp, 39);
  assert.equal(result.state.hero.shield, 0);
});

test("witnesses are distinct sources while their original single armor effect stays aggregated", () => {
  let s = use(use(quiet(), "judge"), "judge");
  s = use(s, "borrowedFlame", "boss");
  s.contracts[0].due = 2;
  const result = feedback(s, { type: "endTurn" });
  assert.deepEqual(
    result.triggers.map((t) => t.sourceId),
    s.allies.map((u) => u.uid),
  );
  assert.deepEqual(
    result.triggers.map((t) => t.value),
    [1, 1],
  );
  assert.ok(
    result.triggers.every(
      (t) => t.ability === "见证" && t.contractId === s.contracts[0].uid,
    ),
  );
  assert.deepEqual(
    result.state.effects.filter((e) => e.type === "armor").map((e) => e.value),
    [2],
  );
  assert.equal(result.state.hero.shield, 2);
  assert.equal(result.state.hero.hp, 34);
  const cancelled = feedback(s, prepare(s, "sever", s.contracts[0].uid));
  assert.deepEqual(
    cancelled.triggers,
    [],
    "Cancelling a debt is not a settlement",
  );
});

test("foreclosure attributes witness then first-manipulation draw to their real sources", () => {
  let s = use(use(quiet(), "judge"), "weaver");
  s = use(s, "borrowedFlame", "boss");
  s = use(s, "transfer", s.contracts[0].uid);
  s.weaverDrawn = false;
  s.hand = [];
  s.draw = [card(s, "shield")];
  const result = feedback(s, prepare(s, "foreclose", s.contracts[0].uid));
  assert.deepEqual(
    result.triggers.map((t) => t.ability),
    ["见证", "书契"],
  );
  assert.deepEqual(
    result.triggers.map((t) => t.sourceId),
    s.allies.map((u) => u.uid),
  );
  assert.equal(result.state.boss.hp, s.boss.hp - 8);
});

test("priest recovery reports partial and zero healing only at the actual new-turn boundary", () => {
  const s = use(quiet(), "priest");
  for (const hp of [39, 40]) {
    s.hero.hp = hp;
    const result = feedback(s, { type: "endTurn" });
    assert.equal(result.triggers.length, 1);
    const t = result.triggers[0];
    assert.equal(t.ability, "复苏");
    assert.equal(t.sourceId, s.allies[0].uid);
    assert.equal(t.targetId, "hero");
    assert.equal(t.value, 40 - hp);
    assert.equal(t.requested, 2);
    assert.equal(t.overheal, 2 - (40 - hp));
    if (hp === 40) assert.equal(t.label, "已满血，恢复 0 生命");
    const playback = enemyTurnPlayback(s);
    assert.deepEqual(playback.state, result.state);
    assert.deepEqual(playback.frames, []);
    assert.deepEqual(playback.tailTriggers, result.triggers);
  }
});

test("resonance reports each surviving knight's real attack gain for spells only", () => {
  const s = use(use(quiet(), "knight"), "knight");
  const result = feedback(s, prepare(s, "shield"));
  assert.deepEqual(
    result.triggers.map((t) => t.ability),
    ["共鸣", "共鸣"],
  );
  for (const [i, t] of result.triggers.entries()) {
    assert.equal(t.sourceId, s.allies[i].uid);
    assert.equal(t.targetId, t.sourceId);
    assert.equal(t.effectType, "buff");
    assert.equal(t.value, 1);
    assert.equal(result.state.allies[i].atk, s.allies[i].atk + 1);
  }
  assert.deepEqual(feedback(s, prepare(s, "sentinel")).triggers, []);
});

test("oracle entry identifies its new unit and the actual card moved into hand", () => {
  const s = quiet();
  s.hand = [];
  s.draw = [card(s, "mend")];
  const drawnId = s.draw[0].uid;
  const result = feedback(s, prepare(s, "oracle"));
  assert.equal(result.triggers.length, 1);
  const t = result.triggers[0];
  assert.equal(t.ability, "启示");
  assert.equal(t.sourceId, result.state.allies[0].uid);
  assert.equal(t.sourceName, "烛光先知");
  assert.equal(t.sourceArt, 2);
  assert.equal(t.targetId, "hand");
  assert.deepEqual(t.drawnIds, [drawnId]);
  assert.equal(result.state.hand[0].uid, drawnId);
});

test("rush reports a real ready unit, while a failed full-board summon returns no triggers", () => {
  const s = quiet();
  const result = feedback(s, prepare(s, "borrowedKnight"));
  assert.equal(result.triggers.length, 1);
  const t = result.triggers[0];
  assert.equal(t.ability, "突袭");
  assert.equal(t.effectType, "ready");
  assert.equal(t.targetId, t.sourceId);
  assert.equal(t.sourceId, result.state.allies[0].uid);
  assert.equal(result.state.allies[0].ready, true);
  const full = use(use(result.state, "sentinel"), "sentinel");
  const action = prepare(full, "lancer");
  const rejected = actionFeedback(full, action);
  assert.ok(rejected.state.notice);
  assert.deepEqual(rejected.state, act(full, action));
  assert.deepEqual(rejected.triggers, []);
});

test("drain heals only for actual damage and reports zero recovery when already full", () => {
  const s = use(quiet(), "phoenix");
  const action = { type: "attack", uid: s.allies[0].uid, target: "boss" };
  for (const hp of [37, 39, 40]) {
    s.hero.hp = hp;
    const result = feedback(s, action);
    const t = result.triggers[0];
    assert.equal(t.ability, "汲取");
    assert.equal(t.sourceId, s.allies[0].uid);
    assert.equal(t.value, Math.min(2, 40 - hp));
    assert.equal(result.state.hero.hp, Math.min(40, hp + 2));
  }
  s.boss.shield = 10;
  assert.deepEqual(feedback(s, action).triggers, []);
  s.boss.shield = 0;
  s.boss.ward = true;
  assert.deepEqual(feedback(s, action).triggers, []);
});

test("drain source metadata survives the source dying from retaliation", () => {
  const s = use(newRun(71), "phoenix");
  s.relics = [];
  const phoenix = s.allies[0];
  phoenix.hp = 1;
  s.hero.hp = 30;
  const result = feedback(s, {
    type: "attack",
    uid: phoenix.uid,
    target: s.enemies[0].uid,
  });
  assert.equal(
    result.state.allies.some((u) => u.uid === phoenix.uid),
    false,
  );
  assert.equal(result.triggers[0].sourceId, phoenix.uid);
  assert.equal(result.triggers[0].sourceName, phoenix.name);
  assert.equal(result.triggers[0].sourceArt, phoenix.art);
  assert.equal(result.triggers[0].value, 2);
  assert.equal(result.state.hero.hp, 32);
});

test("guard intercept and one-use ward stay attached to their exact attack frames", () => {
  const s = use(newRun(71), "bastion");
  s.contracts = [];
  const guard = s.allies[0];
  const expected = feedback(s, { type: "endTurn" });
  const result = enemyTurnPlayback(s);
  const frames = result.frames.filter((f) => f.cue.type === "attack");
  assert.deepEqual(
    frames[0].triggers.map((t) => t.ability),
    ["守卫", "圣盾"],
  );
  assert.equal(frames[0].triggers[0].attackerId, s.enemies[0].uid);
  assert.equal(frames[0].triggers[1].value, s.enemies[0].atk);
  assert.equal(frames[0].after.allies[0].hp, guard.hp);
  assert.ok(frames.every((f) => f.triggers[0].sourceId === guard.uid));
  assert.ok(frames.slice(1).every((f) => f.triggers.length === 1));
  assert.deepEqual(result.tailTriggers, []);
  assert.deepEqual(
    result.frames.flatMap((f) => f.triggers),
    expected.triggers,
  );
  assert.deepEqual(result.state, expected.state);
});

test("ward also reports real retaliation blocked during a player attack, without guard activation", () => {
  const s = use(newRun(71), "bastion");
  const guard = s.allies[0];
  guard.ready = true;
  const result = feedback(s, {
    type: "attack",
    uid: guard.uid,
    target: s.enemies[0].uid,
  });
  assert.equal(result.triggers.length, 1);
  assert.equal(result.triggers[0].ability, "圣盾");
  assert.equal(result.triggers[0].sourceId, guard.uid);
  assert.equal(result.triggers[0].value, s.enemies[0].atk);
  assert.equal(result.state.allies[0].hp, guard.hp);
  assert.equal(result.state.allies[0].ward, false);
});

test("contract witness frames and priest tails partition feedback exactly with independent metadata", () => {
  let s = use(use(use(newRun(71), "bastion"), "judge"), "priest");
  s = use(s, "borrowedFlame", "boss");
  const debt = s.contracts.find((c) => c.owner === "player");
  debt.due = 2;
  s.contracts = [debt];
  const original = structuredClone(s);
  const expected = feedback(s, { type: "endTurn" });
  const result = enemyTurnPlayback(s);
  const flat = [
    ...result.frames.flatMap((f) => f.triggers),
    ...result.tailTriggers,
  ];
  assert.deepEqual(flat, expected.triggers);
  assert.deepEqual(result.state, expected.state);
  assert.deepEqual(s, original);
  assert.deepEqual(
    result.frames.at(-1).triggers.map((t) => t.ability),
    ["见证"],
  );
  assert.deepEqual(
    result.tailTriggers.map((t) => t.ability),
    ["复苏"],
  );
  const saved = structuredClone(result.state);
  const tail = structuredClone(result.tailTriggers);
  result.frames[0].triggers[0].sourceName = "changed";
  assert.deepEqual(result.state, saved);
  assert.deepEqual(result.tailTriggers, tail);
  assert.deepEqual(s, original);
});

test("lethal enemy attacks have no premature priest tail or later witness triggers", () => {
  const s = use(use(newRun(71), "priest"), "judge");
  s.hero.hp = 1;
  const result = enemyTurnPlayback(s);
  assert.equal(result.state.phase, "lost");
  assert.equal(result.frames.length, 1);
  assert.deepEqual(result.frames[0].triggers, []);
  assert.deepEqual(result.tailTriggers, []);
  assert.deepEqual(result.state, feedback(s, { type: "endTurn" }).state);
});

test("feedback across complete seeded expeditions never changes an action result or duplicates a frame trigger", () => {
  for (const difficulty of ["story", "normal", "eclipse"]) {
    let s = newRun(571, difficulty);
    let steps = 0;
    let triggered = 0;
    while (!["won", "lost"].includes(s.phase) && steps++ < 900) {
      const action = s.phase === "battle" ? chooseAction(s) : chooseProgress(s);
      const result = feedback(s, action);
      triggered += result.triggers.length;
      if (action.type === "endTurn") {
        const playback = enemyTurnPlayback(s);
        assert.deepEqual(playback.state, result.state);
        assert.deepEqual(
          [
            ...playback.frames.flatMap((f) => f.triggers),
            ...playback.tailTriggers,
          ],
          result.triggers,
        );
      }
      s = result.state;
    }
    assert.ok(steps < 900);
    assert.equal(s.phase, "won");
    assert.ok(triggered > 10);
  }
});
