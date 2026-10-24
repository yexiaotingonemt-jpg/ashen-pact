import test from "node:test";
import assert from "node:assert/strict";
import {
  newRun,
  act,
  validTargets,
  validateSave,
  intent,
  rage,
} from "../src/engine.js";
import { ARCHETYPES, cardInfo, STARTER } from "../src/data.js";
const initialDeckSize = STARTER.length + ARCHETYPES.contract.keys.length;
const card = (s, key, upgraded = false) => ({
  key,
  uid: "test-" + s.nextId++,
  upgraded,
});
const play = (s, key, target) => {
  s.hand.push(card(s, key));
  s.energy = 20;
  return act(s, { type: "play", uid: s.hand.at(-1).uid, target });
};

test("seeded opening, immutable transitions and save roundtrip", () => {
  const a = newRun(123),
    b = newRun(123);
  assert.deepEqual(a, b);
  assert.equal(a.hand.length, 5);
  assert.equal(a.draw.length, initialDeckSize - 5);
  assert.ok(validateSave(JSON.parse(JSON.stringify(a))));
  const borrowed = card(a, "borrowedKnight");
  a.hand.push(borrowed);
  const next = act(a, { type: "play", uid: borrowed.uid });
  assert.equal(a.allies.length, 0);
  assert.equal(next.allies.length, 1);
  assert.equal(next.energy, 3);
});
test("summoning sickness, charge and one attack each turn", () => {
  let s = newRun(2);
  s = play(s, "lancer");
  assert.equal(s.allies[0].ready, true);
  s = act(s, { type: "attack", uid: s.allies[0].uid, target: "boss" });
  assert.equal(s.boss.hp, 23);
  assert.equal(s.allies[0].ready, false);
  const blocked = act(s, {
    type: "attack",
    uid: s.allies[0].uid,
    target: "boss",
  });
  assert.ok(blocked.notice);
  assert.equal(blocked.boss.hp, 23);
  s = play(s, "sentinel");
  assert.equal(s.allies.at(-1).ready, false);
});
test("unit trades resolve damage simultaneously", () => {
  let s = play(newRun(1), "lancer");
  const uid = s.allies[0].uid;
  const enemy = s.enemies[0].uid;
  s = act(s, { type: "attack", uid, target: enemy });
  assert.equal(s.enemies.length, 2);
  assert.equal(s.allies.length, 0);
});
test("guard protects boss from units, spells bypass guard", () => {
  let s = play(newRun(1), "lancer");
  s.enemies[0].tags = ["守卫"];
  assert.deepEqual(validTargets(s, { type: "unit", uid: s.allies[0].uid }), [
    s.enemies[0].uid,
  ]);
  let rejected = act(s, {
    type: "attack",
    uid: s.allies[0].uid,
    target: "boss",
  });
  assert.ok(rejected.notice);
  assert.equal(rejected.boss.hp, s.boss.hp);
  s = play(s, "bolt", "boss");
  assert.equal(s.boss.hp, 23);
});
test("ward negates exactly one incoming hit", () => {
  let s = play(newRun(1), "bastion");
  s.enemies = [s.enemies[0]];
  s = act(s, { type: "endTurn" });
  assert.equal(s.allies[0].ward, false);
  assert.equal(s.allies[0].hp, 9);
});
test("failed targeted spell does not consume a card or energy", () => {
  const s = newRun(1);
  s.hand = [card(s, "bolt")];
  const uid = s.hand[0].uid;
  const next = act(s, { type: "play", uid, target: "missing" });
  assert.ok(next.notice);
  assert.equal(next.energy, s.energy);
  assert.deepEqual(next.hand, s.hand);
});
test("board limit rejects fourth summon without charging", () => {
  let s = newRun(1);
  for (let i = 0; i < 3; i++) s = play(s, "sentinel");
  const before = s.deck.length;
  s = play(s, "knight");
  assert.ok(s.notice);
  assert.equal(s.allies.length, 3);
  assert.equal(s.energy, 20);
  assert.equal(s.deck.length, before);
});
test("killing with bolt draws a card and triggers ember once", () => {
  let s = newRun(1);
  s.hero.hp = 30;
  let old = s.hand.length;
  s = play(s, "bolt", s.enemies[0].uid);
  assert.equal(s.hand.length, old + 1);
  assert.equal(s.hero.hp, 33);
  s = play(s, "bolt", s.enemies[0].uid);
  assert.equal(s.hero.hp, 33);
});
test("armor absorbs damage and survives round change", () => {
  let s = play(newRun(1), "shield");
  s.enemies = [];
  s.boss.shield = 0;
  s = act(s, { type: "endTurn" });
  assert.equal(s.hero.hp, 40);
  assert.equal(s.hero.shield, 4);
});
test("burn kills before enemy attacks", () => {
  let s = newRun(1);
  s.enemies = [s.enemies[0]];
  s.enemies[0].hp = 3;
  s.enemies[0].burn = 3;
  s = act(s, { type: "endTurn" });
  assert.equal(s.enemies.length, 0);
  assert.equal(s.hero.hp, 37);
});
test("hero skill cost, damage and once per turn gate", () => {
  let s = newRun(1);
  s = act(s, { type: "skill", target: "boss" });
  assert.equal(s.energy, 1);
  assert.equal(s.boss.hp, 24);
  s.energy = 5;
  let fail = act(s, { type: "skill", target: "boss" });
  assert.ok(fail.notice);
  s.enemies = [];
  s = act(s, { type: "endTurn" });
  assert.equal(s.skillUsed, false);
});
test("priest heals, energy grows, hand retained and two drawn", () => {
  let s = play(newRun(1), "priest");
  s.hero.hp = 30;
  s.enemies = [];
  const hand = s.hand.length;
  s = act(s, { type: "endTurn" });
  assert.equal(s.hero.hp, 29);
  assert.equal(s.energy, 4);
  assert.equal(s.maxEnergy, 4);
  assert.equal(s.hand.length, hand + 2);
  assert.equal(s.allies[0].ready, true);
});
test("knight grows when a spell is played; upgrades alter actual rules", () => {
  let s = play(newRun(1), "knight");
  s = play(s, "shield");
  assert.equal(s.allies[0].atk, 4);
  const upgraded = { key: "bolt", upgraded: true };
  assert.equal(cardInfo(upgraded).damage, 6);
  assert.equal(cardInfo({ key: "sentinel", upgraded: true }).hp, 7);
});
test("draw cap, discard reshuffle and exhausted-card isolation", () => {
  let s = newRun(1);
  s.hand = Array.from({ length: 8 }, () => card(s, "shield"));
  s = play(s, "insight");
  assert.equal(s.hand.length, 8);
  assert.ok(s.discard.length >= 2);
  s = play(s, "spark");
  assert.equal(s.exhaust.length, 1);
  s.hand = [];
  s.draw = [];
  s.discard = [card(s, "insight")];
  s.enemies = [];
  s = act(s, { type: "endTurn" });
  assert.equal(s.hand.length, 1);
  assert.equal(s.exhaust.length, 1);
  assert.equal(s.fatigue, 1);
});
test("enemy target selection respects friendly guard and retaliation", () => {
  let s = play(newRun(1), "sentinel");
  s = act(s, { type: "endTurn" });
  assert.equal(s.hero.hp, 37);
  assert.equal(s.allies.length, 0);
  assert.equal(s.enemies[0].hp, 1);
  assert.equal(s.enemies[1].hp, 1);
  assert.equal(s.enemies[2].hp, 2);
});
test("victory-reward-relic-camp-next battle is complete and persistent", () => {
  let s = newRun(3);
  s.boss.hp = 1;
  s.hero.hp = 22;
  s = play(s, "bolt", "boss");
  assert.equal(s.phase, "reward");
  assert.equal(s.hero.hp, 28);
  s = act(s, { type: "reward", key: s.rewardOffer[0] });
  assert.equal(s.phase, "reward");
  assert.equal(s.rewardRound, 2);
  assert.equal(s.deck.length, initialDeckSize + 1);
  s = act(s, { type: "reward", key: s.rewardOffer[0] });
  assert.equal(s.phase, "relic");
  assert.equal(s.deck.length, initialDeckSize + 2);
  s = act(s, { type: "relic", key: s.relicOffer[0] });
  assert.equal(s.phase, "camp");
  const uid = s.deck[0].uid;
  s = act(s, { type: "camp", choice: "upgrade", uid });
  assert.equal(s.phase, "battle");
  assert.equal(s.stage, 1);
  assert.equal(s.deck[0].upgraded, true);
  assert.equal(s.hand.length, 5);
  assert.equal(s.relics.length, 2);
  assert.ok(validateSave(s));
});
test("skip reward heals and camp rest clamps maximum health", () => {
  let s = newRun(2);
  s.boss.hp = 1;
  s = play(s, "bolt", "boss");
  s.hero.hp = 22;
  s = act(s, { type: "reward", key: "heal" });
  assert.equal(s.hero.hp, 26);
  assert.equal(s.phase, "reward");
  assert.equal(s.deck.length, initialDeckSize);
  s = act(s, { type: "reward", key: "heal" });
  assert.equal(s.hero.hp, 30);
  assert.equal(s.phase, "relic");
  assert.equal(s.deck.length, initialDeckSize);
  s = act(s, { type: "relic", key: s.relicOffer[0] });
  s = act(s, { type: "camp", choice: "rest" });
  assert.equal(s.hero.hp, 40);
});
test("final boss victory ends campaign, death has precedence", () => {
  let s = newRun(1);
  s.stage = 4;
  s.boss.hp = 1;
  s = play(s, "bolt", "boss");
  assert.equal(s.phase, "won");
  let t = newRun(1);
  t.hero.hp = 1;
  t = act(t, { type: "endTurn" });
  assert.equal(t.phase, "lost");
  const after = act(t, { type: "endTurn" });
  assert.ok(after.notice);
  assert.equal(after.turn, t.turn);
});
test("invalid reward and duplicate relic cannot alter progression", () => {
  let s = newRun(2);
  s.boss.hp = 1;
  s = play(s, "bolt", "boss");
  let next = act(s, { type: "reward", key: "fake" });
  assert.equal(next.phase, "reward");
  assert.equal(next.deck.length, initialDeckSize);
  s = act(s, { type: "reward", key: s.rewardOffer[0] });
  assert.equal(s.phase, "reward");
  s = act(s, { type: "reward", key: s.rewardOffer[0] });
  next = act(s, { type: "relic", key: "ember" });
  assert.equal(next.phase, "relic");
  assert.equal(next.relics.length, 1);
});
test("seeded enemy intentions cycle and difficulty changes enemies", () => {
  let s = newRun(3);
  assert.equal(intent(s).type, "strike");
  s.turn = 2;
  assert.equal(intent(s).type, "ward");
  s.turn = 3;
  assert.equal(intent(s).type, "summon");
  assert.equal(newRun(3, "story").enemies[0].atk, 1);
  assert.ok(newRun(3, "eclipse").boss.hp > s.boss.maxHp);
});
test("all three difficulty modes are valid; corrupt saves are rejected", () => {
  for (const d of ["story", "normal", "eclipse"])
    assert.ok(validateSave(newRun(8, d)));
  assert.equal(validateSave(null), false);
  assert.equal(validateSave({ version: 1 }), false);
  let s = newRun(1);
  s.deck[0].key = "invalid";
  assert.equal(validateSave(s), false);
});
test("rage starts on advertised round and ramps every two rounds", () => {
  let s = newRun(1);
  s.enemies = [];
  s.turn = 6;
  assert.equal(rage(s), 0);
  s.turn = 7;
  assert.equal(rage(s), 1);
  s.turn = 9;
  assert.equal(rage(s), 2);
  let e = newRun(1, "eclipse");
  e.turn = 6;
  assert.equal(rage(e), 2);
  e.turn = 8;
  assert.equal(rage(e), 4);
});
test("corrupt hand, missing boss, and nonfinite entity stats fail safe", () => {
  let s = newRun(1);
  s.hand[0].key = "bogus";
  assert.equal(validateSave(s), false);
  s = newRun(1);
  s.boss = null;
  assert.equal(validateSave(s), false);
  s = newRun(1);
  s.hero.hp = NaN;
  assert.equal(validateSave(s), false);
});

test("camp removal persists and minimum deck size is enforced", () => {
  let s = newRun(13);
  s.phase = "camp";
  const removed = s.deck[0].uid;
  s = act(s, { type: "camp", choice: "remove", uid: removed });
  assert.equal(s.phase, "battle");
  assert.equal(s.deck.length, initialDeckSize - 1);
  assert.equal(
    s.deck.some((c) => c.uid === removed),
    false,
  );
  s.phase = "camp";
  s.deck = s.deck.slice(0, 10);
  const blocked = act(s, {
    type: "camp",
    choice: "remove",
    uid: s.deck[0].uid,
  });
  assert.equal(blocked.phase, "camp");
  assert.equal(blocked.deck.length, 10);
  assert.ok(blocked.notice);
});

test("quill draws once each turn, then resets, and ring supplies armor", () => {
  let s = newRun(42);
  s.relics.push("quill", "ring");
  s = play(s, "shield");
  assert.equal(s.firstSpell, true);
  const afterFirst = s.draw.length;
  s = play(s, "shield");
  assert.equal(s.draw.length, afterFirst);
  s.enemies = [];
  s = act(s, { type: "endTurn" });
  assert.equal(s.firstSpell, false);
  assert.equal(s.hero.shield, 13);
});

test("healing cannot exceed maximum and ally buff restores full health", () => {
  let s = play(newRun(42), "knight");
  s.allies[0].hp = 1;
  s = play(s, "oath", s.allies[0].uid);
  assert.equal(s.allies[0].maxHp, 6);
  assert.equal(s.allies[0].hp, 6);
  assert.equal(s.allies[0].atk, 6);
  s = play(s, "renewal");
  assert.equal(s.hero.hp, 40);
});
