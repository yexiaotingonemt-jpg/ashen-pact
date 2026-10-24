import test from "node:test";
import assert from "node:assert/strict";
import {
  newRun,
  act,
  actionFeedback,
  enemyTurnPlayback,
  validateSave,
} from "../src/engine.js";
import { ARCHETYPES, CARDS, STARTER, cardInfo } from "../src/data.js";
import { chooseAction, chooseProgress } from "./strategy.js";

function instance(s, key, upgraded = false) {
  return { uid: `archetype-test-${s.nextId++}`, key, upgraded };
}

function quiet(route = "contract") {
  const s = newRun(719, "normal", route);
  s.enemies = [];
  s.contracts = [];
  s.relics = [];
  s.hand = [];
  s.draw = Array.from({ length: 20 }, () => instance(s, "bolt"));
  s.discard = [];
  s.boss.hp = s.boss.maxHp = 100;
  return s;
}

function prepare(s, key, target, upgraded = false) {
  const c = instance(s, key, upgraded);
  s.hand.push(c);
  s.energy = 20;
  return { type: "play", uid: c.uid, target };
}

function use(s, key, target, upgraded = false) {
  return act(s, prepare(s, key, target, upgraded));
}

function feedback(s, action) {
  const original = structuredClone(s);
  const result = actionFeedback(s, action);
  assert.equal(result.state.notice, "", JSON.stringify(action));
  assert.deepEqual(result.state, act(s, action));
  assert.deepEqual(s, original, "Feedback must not mutate its input");
  for (const trigger of result.triggers) {
    assert.ok(trigger.sourceId && trigger.sourceName && trigger.targetId);
    assert.ok(trigger.ability && trigger.label);
    assert.ok(Number.isFinite(trigger.value));
  }
  return result;
}

const ability = (result, name) =>
  result.triggers.filter((t) => t.ability === name);

function victory(route = "contract", seed = 719) {
  const s = newRun(seed, "normal", route);
  s.boss.hp = 1;
  return use(s, "bolt", "boss");
}

test("39 distinct cards and all nine new cards have meaningful upgrades", () => {
  assert.equal(Object.keys(CARDS).length, 39);
  assert.equal(new Set(Object.values(CARDS).map((c) => c.name)).size, 39);
  for (const key of [
    "firekeeper",
    "kindling",
    "detonate",
    "shieldSmith",
    "shieldSlam",
    "brace",
    "lifeweaver",
    "mercy",
    "bloom",
  ]) {
    const base = cardInfo({ key, upgraded: false });
    const upgraded = cardInfo({ key, upgraded: true });
    const withoutName = ({ name, ...c }) => c;
    assert.notDeepEqual(withoutName(base), withoutName(upgraded), key);
    if (base.type === "unit") {
      assert.equal(upgraded.atk, base.atk + 1, key);
      assert.equal(upgraded.hp, base.hp + 2, key);
    }
  }
});

test("four deterministic twelve-card starts share eight cards and guarantee their own core", () => {
  assert.deepEqual(Object.keys(ARCHETYPES), [
    "contract",
    "burn",
    "armor",
    "healing",
  ]);
  assert.equal(STARTER.length, 8);
  for (const [route, config] of Object.entries(ARCHETYPES)) {
    const hands = new Set();
    for (let seed = 1; seed <= 8; seed++) {
      const s = newRun(seed * 571, "normal", route);
      assert.deepEqual(s, newRun(seed * 571, "normal", route));
      assert.equal(s.archetype, route);
      assert.equal(s.deck.length, 12);
      assert.deepEqual(
        s.deck.map((c) => c.key).sort(),
        [...STARTER, ...config.keys].sort(),
      );
      assert.equal(s.hand.length, 5);
      assert.ok(
        s.hand.some((c) => c.key === config.core),
        route,
      );
      assert.ok(validateSave(JSON.parse(JSON.stringify(s))), route);
      hands.add(
        s.hand
          .map((c) => c.key)
          .sort()
          .join(","),
      );
    }
    assert.ok(hands.size > 1, `${route}: opening support cards must vary`);
  }
});

test("first reward round guarantees two route options and the second is a separate real choice", () => {
  for (const [route, config] of Object.entries(ARCHETYPES)) {
    let s = victory(route);
    assert.equal(s.phase, "reward");
    assert.equal(s.rewardRound, 1);
    assert.equal(s.rewardOffer.length, 3);
    assert.equal(new Set(s.rewardOffer).size, 3);
    assert.ok(
      s.rewardOffer.filter((key) => config.pool.includes(key)).length >= 2,
    );
    const firstOffer = [...s.rewardOffer];
    const firstKey = firstOffer[0];
    const initialDeck = s.deck.length;
    s = act(s, { type: "reward", key: firstKey });
    assert.equal(s.notice, "");
    assert.equal(s.phase, "reward");
    assert.equal(s.rewardRound, 2);
    assert.equal(s.deck.length, initialDeck + 1);
    assert.equal(s.rewardOffer.length, 3);
    assert.equal(new Set(s.rewardOffer).size, 3);
    assert.ok(s.rewardOffer.some((key) => config.pool.includes(key)));
    assert.ok(s.rewardOffer.some((key) => !config.pool.includes(key)));
    assert.ok(
      s.rewardOffer.every((key) => !firstOffer.includes(key)),
      "Both rounds offer different cards",
    );
    assert.ok(validateSave(JSON.parse(JSON.stringify(s))));
    const secondKey = s.rewardOffer[0];
    s = act(s, { type: "reward", key: secondKey });
    assert.equal(s.phase, "relic");
    assert.equal(s.deck.length, initialDeck + 2);
    assert.ok(s.deck.some((c) => c.key === secondKey));
  }
});

test("each skipped reward restores four life rather than doubling the former eight-life reward", () => {
  let s = victory("burn");
  s.hero.hp = 20;
  const deckSize = s.deck.length;
  s = act(s, { type: "reward", key: "heal" });
  assert.equal(s.hero.hp, 24);
  assert.equal(s.phase, "reward");
  assert.equal(s.rewardRound, 2);
  s = act(s, { type: "reward", key: "heal" });
  assert.equal(s.hero.hp, 28);
  assert.equal(s.deck.length, deckSize);
  assert.equal(s.phase, "relic");
});

test("reward rejection is atomic in either round and a saved second round cannot award three cards", () => {
  let s = victory("armor");
  for (const round of [1, 2]) {
    const rejected = act(s, { type: "reward", key: "missing" });
    assert.ok(rejected.notice);
    assert.equal(rejected.rewardRound, round);
    assert.deepEqual(rejected.deck, s.deck);
    assert.deepEqual(rejected.rewardOffer, s.rewardOffer);
    if (round === 1) s = act(s, { type: "reward", key: s.rewardOffer[0] });
  }
  s = JSON.parse(JSON.stringify(s));
  assert.ok(validateSave(s));
  const chosen = s.rewardOffer[0];
  s = act(s, { type: "reward", key: chosen });
  const deck = structuredClone(s.deck);
  const rejected = act(s, { type: "reward", key: chosen });
  assert.ok(rejected.notice);
  assert.deepEqual(rejected.deck, deck);
});

test("legacy version-two battle saves without route metadata remain valid", () => {
  const s = newRun(719);
  delete s.archetype;
  delete s.rewardRound;
  assert.ok(validateSave(JSON.parse(JSON.stringify(s))));
});

test("foreclosure upgrade adds five blood damage and preserves zero cost and exhaustion", () => {
  assert.equal(cardInfo({ key: "foreclose" }).foreclosureBonus, 2);
  assert.equal(
    cardInfo({ key: "foreclose", upgraded: true }).foreclosureBonus,
    5,
  );
  for (const upgraded of [false, true]) {
    let s = use(quiet(), "borrowedFlame", "boss");
    const contractId = s.contracts.find((c) => c.owner === "player").uid;
    s = use(s, "transfer", contractId);
    s.boss.shield = 100;
    const hp = s.boss.hp;
    const result = feedback(s, prepare(s, "foreclose", contractId, upgraded));
    assert.equal(hp - result.state.boss.hp, 6 + (upgraded ? 5 : 2));
    assert.equal(result.state.boss.shield, 100, "Blood still bypasses armor");
    assert.equal(result.state.energy, 20);
    assert.equal(result.state.exhaust.at(-1).key, "foreclose");
    assert.equal(
      result.state.contracts.some((c) => c.uid === contractId),
      false,
    );
  }
});

test("firekeeper adds one layer only to the first application each turn and identifies its source", () => {
  let s = use(quiet("burn"), "firekeeper");
  const source = s.allies[0];
  const result = feedback(s, prepare(s, "kindling", "boss"));
  assert.equal(result.state.boss.burn, 3);
  const trigger = ability(result, "引燃")[0];
  assert.equal(trigger.sourceId, source.uid);
  assert.equal(trigger.targetId, "boss");
  assert.equal(trigger.value, 1);
  s = result.state;
  const repeat = feedback(s, prepare(s, "kindling", "boss"));
  assert.equal(repeat.state.boss.burn, 5);
  assert.deepEqual(ability(repeat, "引燃"), []);
  s = act(repeat.state, { type: "endTurn" });
  const before = s.boss.burn;
  const next = feedback(s, prepare(s, "kindling", "boss"));
  assert.equal(next.state.boss.burn, before + 3);
  assert.equal(ability(next, "引燃").length, 1);
});

test("multiple firekeepers each contribute once and dead targets receive no burn or trigger", () => {
  let s = use(use(quiet("burn"), "firekeeper"), "firekeeper");
  const result = feedback(s, prepare(s, "kindling", "boss"));
  assert.equal(result.state.boss.burn, 4);
  assert.deepEqual(
    ability(result, "引燃").map((t) => t.sourceId),
    s.allies.map((u) => u.uid),
  );
  s = act(result.state, { type: "endTurn" });
  s.enemies = [{ ...newRun(719).enemies[0], uid: "burn-victim", hp: 1 }];
  const killed = feedback(s, prepare(s, "cinder", "burn-victim"));
  assert.equal(ability(killed, "引燃").length, 0);
  assert.equal(
    killed.state.enemies.some((u) => u.uid === "burn-victim"),
    false,
  );
});

test("detonation spends all burn once, works at zero stacks, and honors ward", () => {
  for (const [layers, ward, dealt] of [
    [5, false, 13],
    [0, false, 3],
    [5, true, 0],
  ]) {
    const s = quiet("burn");
    s.boss.burn = layers;
    s.boss.ward = ward;
    const result = feedback(s, prepare(s, "detonate", "boss"));
    assert.equal(result.state.boss.burn, 0);
    assert.equal(100 - result.state.boss.hp, dealt);
    assert.equal(result.state.boss.ward, false);
    const ended = act(result.state, { type: "endTurn" });
    assert.equal(
      ended.boss.hp,
      result.state.boss.hp,
      "Consumed stacks cannot tick again",
    );
  }
});

test("armor strike spends a bounded amount and never repeatedly reads armor without spending it", () => {
  let s = quiet("armor");
  s.hero.shield = 30;
  const first = feedback(s, prepare(s, "shieldSlam", "boss"));
  assert.equal(first.state.hero.shield, 21);
  assert.equal(first.state.boss.hp, 89);
  const second = feedback(
    first.state,
    prepare(first.state, "shieldSlam", "boss"),
  );
  assert.equal(second.state.hero.shield, 12);
  assert.equal(second.state.boss.hp, 78);
  s = quiet("armor");
  s.hero.shield = 4;
  s = use(s, "shieldSlam", "boss");
  assert.equal(s.hero.shield, 0);
  assert.equal(s.boss.hp, 94);
  s = use(s, "shieldSlam", "boss");
  assert.equal(s.hero.shield, 0);
  assert.equal(s.boss.hp, 92);
});

test("upgraded armor strike spends at most twelve and ward does not refund its armor", () => {
  const s = quiet("armor");
  s.hero.shield = 20;
  s.boss.ward = true;
  const result = feedback(s, prepare(s, "shieldSlam", "boss", true));
  assert.equal(result.state.hero.shield, 8);
  assert.equal(result.state.boss.hp, 100);
  assert.equal(result.state.boss.ward, false);
});

test("forging grows only once per turn, with the ring's new-turn armor in the new budget", () => {
  let s = use(quiet("armor"), "shieldSmith");
  const id = s.allies[0].uid;
  const first = feedback(s, prepare(s, "shield"));
  assert.equal(first.state.allies[0].atk, 3);
  assert.equal(first.state.hero.shield, 7);
  assert.equal(ability(first, "锻甲")[0].sourceId, id);
  assert.equal(ability(first, "锻甲")[0].value, 2);
  const repeated = feedback(first.state, prepare(first.state, "brace"));
  assert.equal(repeated.state.allies[0].atk, 3);
  assert.equal(ability(repeated, "锻甲").length, 0);
  s = repeated.state;
  s.relics = ["ring"];
  const next = feedback(s, { type: "endTurn" });
  assert.equal(next.state.allies[0].atk, 5);
  assert.equal(ability(next, "锻甲").length, 1);
  assert.equal(
    ability(feedback(next.state, prepare(next.state, "shield")), "锻甲").length,
    0,
  );
});

test("new-turn contract armor and later ring armor share exactly one forging trigger", () => {
  let s = use(use(quiet("armor"), "shieldSmith"), "judge");
  s = use(s, "borrowedFlame", "boss");
  s.contracts[0].due = 2;
  s.relics = ["ring"];
  const result = feedback(s, { type: "endTurn" });
  assert.equal(result.state.allies[0].atk, 3);
  assert.equal(result.state.hero.shield, 3);
  assert.equal(ability(result, "锻甲").length, 1);
  const playback = enemyTurnPlayback(s);
  assert.deepEqual(playback.state, result.state);
  assert.deepEqual(
    [...playback.frames.flatMap((f) => f.triggers), ...playback.tailTriggers],
    result.triggers,
  );
});

test("healing route works at full life but caps its retaliation at two healing events per turn", () => {
  let s = use(quiet("healing"), "lifeweaver");
  for (let index = 0; index < 3; index++) {
    const result = feedback(s, prepare(s, "mend"));
    assert.equal(result.state.hero.hp, 40);
    assert.equal(result.state.boss.hp, 100 - Math.min(2, index + 1) * 2);
    assert.equal(ability(result, "返照").length, index < 2 ? 1 : 0);
    if (index < 2) {
      assert.equal(ability(result, "返照")[0].sourceId, s.allies[0].uid);
      assert.equal(ability(result, "返照")[0].targetId, "boss");
      assert.equal(ability(result, "返照")[0].value, 2);
    }
    s = result.state;
  }
});

test("partial healing still triggers once, and multiple doctors have independent limits", () => {
  let s = use(use(quiet("healing"), "lifeweaver"), "lifeweaver");
  s.hero.hp = 39;
  const result = feedback(s, prepare(s, "mend"));
  assert.equal(result.state.hero.hp, 40);
  assert.equal(result.state.boss.hp, 96);
  assert.deepEqual(
    ability(result, "返照").map((t) => t.sourceId),
    s.allies.map((u) => u.uid),
  );
});

test("priest healing consumes the new turn's retaliation budget rather than the previous turn's", () => {
  let s = use(use(quiet("healing"), "lifeweaver"), "priest");
  s = use(use(s, "mend"), "mend");
  assert.equal(s.boss.hp, 96);
  const next = feedback(s, { type: "endTurn" });
  assert.equal(next.state.boss.hp, 94);
  assert.equal(ability(next, "返照").length, 1);
  assert.equal(ability(next, "复苏").length, 1);
  const playback = enemyTurnPlayback(s);
  assert.deepEqual(playback.state, next.state);
  assert.deepEqual(
    [...playback.frames.flatMap((f) => f.triggers), ...playback.tailTriggers],
    next.triggers,
  );
  const second = feedback(next.state, prepare(next.state, "mend"));
  assert.equal(second.state.boss.hp, 92);
  const third = feedback(second.state, prepare(second.state, "mend"));
  assert.equal(third.state.boss.hp, 92);
  assert.equal(ability(third, "返照").length, 0);
});

test("overflow armor uses only the unapplied healing and feeds the armor route once", () => {
  for (const [hp, armor] of [
    [30, 0],
    [39, 3],
    [40, 4],
  ]) {
    const s = use(quiet("healing"), "shieldSmith");
    s.hero.hp = hp;
    const result = feedback(s, prepare(s, "bloom"));
    assert.equal(result.state.hero.hp, Math.min(40, hp + 4));
    assert.equal(result.state.hero.shield, armor);
    assert.equal(ability(result, "锻甲").length, armor > 0 ? 1 : 0);
  }
});

test("ally restoration does not trigger hero healing payoffs", () => {
  let s = use(use(quiet("healing"), "lifeweaver"), "sentinel");
  const target = s.allies[1];
  target.hp = 1;
  const result = feedback(s, prepare(s, "oath", target.uid));
  assert.equal(result.state.boss.hp, 100);
  assert.equal(ability(result, "返照").length, 0);
  assert.equal(result.state.allies[1].hp, result.state.allies[1].maxHp);
});

test("victory, reward and camp recovery never trigger a surviving doctor's combat payoff", () => {
  let s = use(quiet("healing"), "lifeweaver");
  s.hero.hp = 20;
  s.boss.hp = 1;
  const won = feedback(s, prepare(s, "bolt", "boss"));
  assert.equal(won.state.phase, "reward");
  assert.equal(ability(won, "返照").length, 0);
  s = won.state;
  const skipped = feedback(s, { type: "reward", key: "heal" });
  assert.equal(ability(skipped, "返照").length, 0);
  s = act(skipped.state, { type: "reward", key: "heal" });
  s = act(s, { type: "relic", key: s.relicOffer[0] });
  const rested = feedback(s, { type: "camp", choice: "rest" });
  assert.equal(rested.state.phase, "battle");
  assert.equal(ability(rested, "返照").length, 0);
});

test("doctor healing cannot revive a dead hero or turn a simultaneous loss into victory", () => {
  const s = use(quiet("healing"), "lifeweaver");
  s.hero.hp = 0;
  const result = actionFeedback(s, prepare(s, "mend"));
  assert.equal(result.state.hero.hp, 0);
  assert.equal(result.state.phase, "lost");
  assert.equal(ability(result, "返照").length, 0);
});

function dawnLethal({ secondPriest = false, bloodDebt = false } = {}) {
  let s = use(use(quiet("healing"), "lifeweaver"), "priest");
  if (secondPriest) s = use(s, "priest");
  if (bloodDebt) s = use(s, "borrowedFlame", "boss");
  s.hero.hp = 1;
  s.boss.hp = 2;
  s.hand = [];
  s.draw = [];
  s.discard = [];
  s.exhaust = [];
  return s;
}

function assertLethalTail(s, result) {
  const doctor = s.allies.find((u) => u.key === "lifeweaver");
  const firstPriest = s.allies.find((u) => u.key === "priest");
  assert.deepEqual(
    result.triggers.map((t) => [t.ability, t.sourceId]),
    [
      ["复苏", firstPriest.uid],
      ["返照", doctor.uid],
    ],
    "The lethal doctor's payoff and its priest healing source must both survive",
  );
  const playback = enemyTurnPlayback(s);
  assert.deepEqual(playback.state, result.state);
  assert.deepEqual(playback.frames, []);
  assert.deepEqual(playback.tailTriggers, result.triggers);
}

test("dawn healing lethal ends combat before empty-deck fatigue can replace victory with defeat", () => {
  const s = dawnLethal();
  const result = feedback(s, { type: "endTurn" });
  assert.equal(result.state.boss.hp, 0);
  assert.equal(result.state.phase, "reward");
  assert.equal(
    result.state.hero.hp,
    9,
    "1 + 2 priest healing + 6 victory recovery",
  );
  assert.equal(
    result.state.fatigue,
    0,
    "No new cards should be drawn after combat ends",
  );
  assert.equal(result.state.stats.wins, 1);
  assert.equal(result.state.hand.length, 0);
  assertLethalTail(s, result);
});

test("dawn healing lethal stops later priest and ring triggers after the complete lethal event", () => {
  const s = dawnLethal({ secondPriest: true });
  s.relics = ["ring"];
  const result = feedback(s, { type: "endTurn" });
  assert.equal(result.state.phase, "reward");
  assert.equal(
    result.state.hero.hp,
    9,
    "Only the first priest heals before victory recovery",
  );
  assert.equal(
    result.state.hero.shield,
    0,
    "The later ring trigger must not run",
  );
  assert.equal(result.state.fatigue, 0);
  assertLethalTail(s, result);
});

test("dawn healing lethal still pays the genuine unpaid blood bill before awarding victory", () => {
  const s = dawnLethal({ bloodDebt: true });
  assert.equal(s.contracts[0].amount, 6);
  assert.equal(s.contracts[0].due, 3);
  const result = feedback(s, { type: "endTurn" });
  assert.equal(result.state.boss.hp, 0);
  assert.equal(result.state.phase, "lost");
  assert.equal(result.state.hero.hp, 0);
  assert.equal(result.state.stats.victoryBill, 6);
  assert.equal(result.state.stats.paidLife, 6);
  assert.equal(result.state.stats.wins, 0);
  assert.equal(
    result.state.fatigue,
    0,
    "The loss is insolvency, not a post-combat draw",
  );
  assertLethalTail(s, result);
});

test("serializing a battle does not reset any route's per-turn trigger budget", () => {
  for (const [route, unit, spell, target, expectedAbility, uses] of [
    ["burn", "firekeeper", "kindling", "boss", "引燃", 1],
    ["armor", "shieldSmith", "shield", undefined, "锻甲", 1],
    ["healing", "lifeweaver", "mend", undefined, "返照", 2],
  ]) {
    let s = use(quiet(route), unit);
    for (let index = 0; index < uses; index++) s = use(s, spell, target);
    s = JSON.parse(JSON.stringify(s));
    assert.ok(validateSave(s));
    assert.equal(
      ability(feedback(s, prepare(s, spell, target)), expectedAbility).length,
      0,
    );
  }
});

test("all four complete route expeditions preserve action, playback, and saved-state equality", () => {
  for (const route of Object.keys(ARCHETYPES)) {
    let s = newRun(571, "normal", route);
    let steps = 0;
    const phases = new Set();
    while (!["won", "lost"].includes(s.phase) && steps++ < 900) {
      phases.add(s.phase);
      const action = s.phase === "battle" ? chooseAction(s) : chooseProgress(s);
      const result = feedback(s, action);
      if (action.type === "endTurn") {
        const playback = enemyTurnPlayback(s);
        assert.deepEqual(playback.state, result.state, route);
        assert.deepEqual(
          [
            ...playback.frames.flatMap((frame) => frame.triggers),
            ...playback.tailTriggers,
          ],
          result.triggers,
          route,
        );
      }
      s = result.state;
      assert.ok(
        validateSave(JSON.parse(JSON.stringify(s))),
        `${route} after ${action.type}`,
      );
    }
    assert.ok(steps < 900, `${route} must terminate`);
    assert.ok(["won", "lost"].includes(s.phase), route);
    assert.ok(phases.has("battle"));
  }
});
