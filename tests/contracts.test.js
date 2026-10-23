import test from "node:test";
import assert from "node:assert/strict";
import {
  newRun,
  act,
  validTargets,
  validateSave,
  intent,
} from "../src/engine.js";
import {
  debtValue,
  victoryBill,
  timeline,
  canEditContract,
} from "../src/contracts.js";
const quiet = () => {
  const s = newRun(99);
  s.enemies = [];
  s.boss.hp = 100;
  s.boss.maxHp = 100;
  return s;
};
function play(s, key, target) {
  s.hand.push({ uid: "test" + s.nextId++, key, upgraded: false });
  s.energy = 20;
  return act(s, { type: "play", uid: s.hand.at(-1).uid, target });
}
const debt = (s) => s.contracts.find((c) => c.owner === "player");
const end = (s) => act(s, { type: "endTurn" });

test("three-turn enemy promises are deterministic, real and visible", () => {
  const s = newRun(6);
  assert.deepEqual(
    timeline(s).map((x) => x.turn),
    [2, 3, 4],
  );
  assert.equal(s.contracts.length, 3);
  assert.equal(s.contracts[0].effect, "strike");
  assert.equal(s.contracts[1].effect, "ward");
  assert.equal(s.contracts[2].effect, "summon");
  assert.ok(validateSave(s));
});
test("zero-cost power signs an immutable two-turn blood debt", () => {
  const initial = quiet();
  const s = play(initial, "borrowedFlame", "boss");
  assert.equal(initial.contracts.length, 3);
  assert.equal(s.boss.hp, 94);
  assert.equal(debt(s).due, 3);
  assert.equal(debt(s).amount, 6);
  assert.equal(s.stats.signed, 1);
  assert.equal(
    s.hand.some((c) => c.key === "borrowedFlame"),
    true,
  );
});
test("blood debt is paid exactly on its due turn and bypasses armor", () => {
  let s = play(quiet(), "borrowedFlame", "boss");
  s.hero.shield = 100;
  s = end(s);
  assert.equal(s.hero.hp, 40);
  s = end(s);
  assert.equal(s.hero.hp, 34);
  assert.equal(debt(s), undefined);
  assert.ok(s.hero.shield > 90);
  assert.ok(validateSave(s));
});
test("borrowed energy withholds next turn resources", () => {
  let s = play(quiet(), "borrowedEnergy");
  assert.equal(s.energy, 22);
  assert.equal(s.exhaust.length, 1);
  s = end(s);
  assert.equal(s.maxEnergy, 4);
  assert.equal(s.energy, 2);
  assert.equal(s.hero.hp, 37);
});
test("unpayable energy debt converts only its shortfall to life", () => {
  let s = play(quiet(), "borrowedEnergy");
  debt(s).amount = 6;
  s = end(s);
  assert.equal(s.energy, 0);
  assert.equal(s.hero.hp, 31);
});
test("borrowed aegis skips exactly two future draws", () => {
  let s = play(quiet(), "borrowedAegis");
  const hand = s.hand.length;
  s = end(s);
  assert.equal(s.hand.length, hand);
  assert.equal(s.hero.hp, 40);
  s = end(s);
  assert.equal(s.hand.length, hand + 2);
});
test("stacked draw debts charge life for unavailable draws", () => {
  let s = play(quiet(), "borrowedAegis");
  s = play(s, "borrowedAegis");
  s = end(s);
  assert.equal(s.hero.hp, 34);
});
test("borrowed knight is charge now and defects after two turns", () => {
  let s = play(quiet(), "borrowedKnight");
  const uid = s.allies[0].uid;
  assert.equal(s.allies[0].ready, true);
  s = end(s);
  assert.equal(s.allies.length, 1);
  s = end(s);
  assert.equal(s.allies.length, 0);
  assert.equal(s.enemies.find((u) => u.uid === uid).key, "borrowedKnight");
  assert.ok(validateSave(s));
});
test("dead loan unit releases its binding debt", () => {
  let s = play(quiet(), "borrowedKnight");
  s.enemies = [
    {
      uid: "giant",
      key: "guard",
      name: "Giant",
      art: 4,
      atk: 10,
      hp: 20,
      maxHp: 20,
      tags: [],
      burn: 0,
      ready: true,
      ward: false,
    },
  ];
  s = act(s, { type: "attack", uid: s.allies[0].uid, target: "giant" });
  assert.equal(s.allies.length, 0);
  assert.equal(debt(s), undefined);
});
test("rewriting betrayal changes its payment and keeps the knight", () => {
  let s = play(quiet(), "borrowedKnight");
  s = play(s, "rewrite", debt(s).uid);
  assert.equal(debt(s).kind, "blood");
  assert.equal(debt(s).amount, 7);
  assert.equal(debt(s).unitId, undefined);
  assert.equal(s.allies[0].loanContractId, undefined);
  s = end(end(s));
  assert.equal(s.allies.length, 1);
  assert.equal(s.hero.hp, 30);
});
test("raw betrayal cannot transfer; rewriting makes it portable", () => {
  let s = play(quiet(), "borrowedKnight");
  const uid = debt(s).uid;
  let rejected = play(s, "transfer", uid);
  assert.ok(rejected.notice);
  assert.equal(debt(rejected).kind, "betrayal");
  s = play(s, "rewrite", uid);
  s = play(s, "transfer", uid);
  assert.equal(s.contracts.find((c) => c.uid === uid).owner, "enemy");
  assert.equal(victoryBill(s), 0);
});
test("transfer changes debtor and preserves the due date", () => {
  let s = play(quiet(), "borrowedFlame", "boss");
  const uid = debt(s).uid;
  s = play(s, "transfer", uid);
  assert.equal(s.contracts.find((c) => c.uid === uid).due, 3);
  s = end(end(s));
  assert.equal(s.hero.hp, 37);
  assert.equal(s.boss.hp, 88);
  assert.equal(s.stats.transfers, 1);
});
test("transferred energy becomes a plainly defined three-for-one blood debt", () => {
  let s = play(quiet(), "borrowedEnergy");
  s = play(s, "transfer", debt(s).uid);
  const c = s.contracts.find((c) => c.kind === "blood");
  assert.equal(c.amount, 6);
  s = end(s);
  assert.equal(s.energy, 4);
  assert.equal(s.boss.hp, 94);
});
test("blood-to-energy rewrite changes the actual resource paid", () => {
  let s = play(quiet(), "borrowedFlame", "boss");
  s = play(s, "rewrite", debt(s).uid);
  assert.equal(debt(s).kind, "energy");
  assert.equal(debt(s).amount, 2);
  s = end(end(s));
  assert.equal(s.hero.hp, 37);
  assert.equal(s.energy, 3);
});
test("deferral moves a debt, adds interest, and respects a three-turn horizon", () => {
  let s = play(quiet(), "borrowedFlame", "boss");
  const uid = debt(s).uid;
  s = play(s, "defer", uid);
  assert.equal(debt(s).due, 4);
  assert.equal(debt(s).amount, 7);
  assert.ok(play(s, "defer", uid).notice);
  s = end(s);
  s = play(s, "defer", uid);
  assert.equal(debt(s).due, 5);
  assert.equal(debt(s).edits, 2);
  s = end(s);
  assert.ok(play(s, "defer", uid).notice);
});
test("deferring an enemy promise really prevents its original scheduled attack", () => {
  let s = quiet();
  const first = s.contracts[0];
  s = play(s, "defer", first.uid);
  assert.equal(intent(s).type, "silenced");
  s = end(s);
  assert.equal(s.hero.hp, 40);
  s = end(s);
  assert.equal(s.hero.hp, 37);
});
test("burning an enemy promise does not regenerate the canceled event", () => {
  let s = quiet();
  const uid = s.contracts[0].uid;
  s = play(s, "sever", uid);
  assert.equal(s.hero.hp, 36);
  s = end(s);
  assert.equal(s.hero.hp, 36);
  assert.equal(
    s.contracts.some((c) => c.uid === uid),
    false,
  );
  assert.equal(
    s.contracts.some((c) => c.kind === "omen" && c.due === 2),
    false,
  );
});
test("sever requires survival and invalid payment is atomic", () => {
  let s = quiet();
  s.hero.hp = 4;
  const uid = s.contracts[0].uid;
  const next = play(s, "sever", uid);
  assert.ok(next.notice);
  assert.equal(next.hero.hp, 4);
  assert.equal(next.contracts.length, 3);
});
test("foreclosure settles transferred blood now with two extra damage", () => {
  let s = play(quiet(), "borrowedFlame", "boss");
  const uid = debt(s).uid;
  s = play(s, "transfer", uid);
  s = play(s, "foreclose", uid);
  assert.equal(s.boss.hp, 86);
  assert.equal(
    s.contracts.some((c) => c.uid === uid),
    false,
  );
  assert.equal(s.exhaust.at(-1).key, "foreclose");
});
test("victory collects outstanding debt, so lethal burst never erases the bill", () => {
  let s = quiet();
  s.boss.hp = 1;
  s.hero.hp = 20;
  s = play(s, "borrowedFlame", "boss");
  assert.equal(s.phase, "reward");
  assert.equal(s.stats.victoryBill, 6);
  assert.equal(s.hero.hp, 20);
  assert.equal(s.contracts.length, 0);
});
test("insolvent victory is a real loss before victory healing", () => {
  let s = quiet();
  s.boss.hp = 1;
  s.hero.hp = 5;
  s = play(s, "borrowedFlame", "boss");
  assert.equal(s.phase, "lost");
  assert.equal(s.hero.hp, 0);
  assert.equal(s.stats.wins, 0);
});
test("witnesses gain armor on actual settlement and never on cancellation", () => {
  let s = play(quiet(), "judge");
  const uid = s.contracts[0].uid;
  s = play(s, "sever", uid);
  assert.equal(s.hero.shield, 0);
  s = end(s);
  assert.equal(s.hero.shield, 0);
  s = end(s);
  assert.equal(s.hero.shield, 1);
});
test("weaver draws on first manipulation only and resets next turn", () => {
  let s = play(quiet(), "weaver");
  let draw = s.draw.length;
  s = play(s, "defer", s.contracts[0].uid);
  assert.equal(s.draw.length, draw - 1);
  s = play(s, "defer", s.contracts.find((c) => c.due === 3).uid);
  assert.equal(s.draw.length, draw - 1);
  s = end(s);
  assert.equal(s.weaverDrawn, false);
});
test("priest collection brings a future debt forward into the current settlement", () => {
  let s = newRun(7);
  s.phase = "camp";
  s.stage = 1;
  s = act(s, { type: "camp", choice: "rest" });
  s.enemies = [];
  s = play(s, "borrowedFlame", "boss");
  assert.equal(debt(s).due, 3);
  s = end(s);
  assert.equal(s.turn, 2);
  assert.equal(debt(s), undefined);
  assert.equal(s.hero.hp, 34);
});
test("future ledger survives serialization and rejects corrupt contracts", () => {
  let s = play(quiet(), "borrowedKnight");
  assert.ok(validateSave(JSON.parse(JSON.stringify(s))));
  s.contracts[0].due = 999;
  assert.equal(validateSave(s), false);
  s = quiet();
  s.contracts[0].amount = NaN;
  assert.equal(validateSave(s), false);
});
test("target validation only exposes eligible public contracts", () => {
  let s = quiet();
  s = play(s, "borrowedKnight");
  const c = { uid: "transfer-test", key: "transfer", upgraded: false };
  s.hand.push(c);
  assert.deepEqual(validTargets(s, { type: "card", uid: c.uid }), []);
  assert.equal(debtValue(debt(s)), 7);
  assert.equal(canEditContract(s, debt(s), "rewrite"), true);
});
