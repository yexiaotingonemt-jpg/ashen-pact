// Balance probe, not a human win-rate estimate. Run: node scripts/archetype-sim.mjs
// Optional: --normal=24 --other=8 --beam=6 --out=C:/path/result.json
// Decisions see the current hand/board/ledger and public pile sizes/composition.
// Hidden draw identities/order and the live PRNG seed are NEVER fed to planning.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  newRun,
  act,
  actionFeedback,
  enemyTurnPlayback,
  validTargets,
  validateSave,
} from "../src/engine.js";
import { CARDS, ARCHETYPES, cardInfo } from "../src/data.js";
import { debtValue } from "../src/contracts.js";

const unknown = (i) => ({
  uid: `sim-unknown-${i}`,
  key: "shield",
  upgraded: false,
});
export function publicState(s) {
  const copy = {};
  for (const key of Object.keys(s)) {
    if (key === "seed" || key === "draw") continue;
    copy[key] = structuredClone(s[key]);
  }
  copy.seed = 0x51a7;
  copy.draw = Array.from({ length: s.draw.length }, (_, i) => unknown(i));
  return copy;
}

function actions(s, knownHand, used = new Set()) {
  if (s.phase !== "battle") return [];
  const result = [];
  for (const c of s.hand) {
    if (!knownHand.has(c.uid) || used.has(c.uid)) continue;
    const d = cardInfo(c);
    if (d.cost > s.energy) continue;
    if (d.type === "unit") {
      if (s.allies.length < 3) result.push({ type: "play", uid: c.uid });
    } else if (d.target === "self") result.push({ type: "play", uid: c.uid });
    else
      for (const target of validTargets(s, { type: "card", uid: c.uid }))
        result.push({ type: "play", uid: c.uid, target });
  }
  for (const unit of s.allies.filter((u) => u.ready))
    for (const target of validTargets(s, { type: "unit", uid: unit.uid }))
      result.push({ type: "attack", uid: unit.uid, target });
  if (!s.skillUsed && s.energy >= 2)
    for (const target of ["boss", ...s.enemies.map((u) => u.uid)])
      result.push({ type: "skill", target });
  return result;
}

function delayedBurn(u, horizon) {
  let damage = 0;
  for (let t = 0; t < horizon; t++)
    damage += Math.max(0, u.burn - t) * 0.78 ** t;
  return Math.min(u.hp + (u.shield || 0), damage) * 0.85;
}

export function positionValue(s) {
  if (s.phase === "lost") return -100000;
  if (["won", "reward", "relic", "camp"].includes(s.phase))
    return 100000 + s.hero.hp;
  const role = {
    书契: 2.5,
    见证: 1.7,
    复苏: 3,
    共鸣: 2.5,
    引燃: 3,
    锻甲: 3.5,
    返照: 4,
  };
  let score = s.hero.hp * 0.76 - Math.max(0, 17 - s.hero.hp) ** 2 * 0.13;
  score += s.hero.shield * (s.archetype === "armor" ? 0.5 : 0.36);
  score -= s.boss.hp * 1.25 + (s.boss.shield || 0) * 0.7;
  score += delayedBurn(s.boss, 3) * 1.25;
  for (const u of s.allies) {
    score += u.atk * 1.7 + u.hp * 0.58 + (u.ready ? 0.8 : 0);
    score += (u.tags.includes("守卫") ? 2 : 0) + (u.ward ? 1.6 : 0);
    score +=
      (u.tags.includes("汲取") ? 2 : 0) +
      u.tags.reduce((n, tag) => n + (role[tag] || 0), 0);
  }
  for (const u of s.enemies)
    score -=
      u.atk * 2.25 +
      u.hp * 0.8 +
      (u.tags.includes("守卫") ? 1.5 : 0) -
      delayedBurn(u, 2);
  score += s.hand.length * 0.95 + s.energy * 0.38;
  for (const c of s.contracts) {
    const discount = 1 / (1 + Math.max(0, c.due - s.turn - 1) * 0.28);
    if (c.kind === "omen") {
      const debts = s.contracts.filter((x) => x.owner === "player");
      const risk = ["strike", "hex"].includes(c.effect)
        ? c.value * 0.9
        : c.effect === "summon"
          ? 5
          : c.effect === "ward"
            ? c.value * 0.45
            : c.effect === "howl"
              ? s.enemies.length * 1.6
              : c.effect === "collect"
                ? debts.length
                  ? debts.length * 1.7
                  : 1.8
                : c.effect === "writ"
                  ? debts.length
                    ? debts.length * 1.3
                    : 1.4
                  : 0;
      score -= (risk + (c.rage || 0)) * discount;
    } else if (c.owner === "enemy") score += debtValue(c) * discount * 1.18;
    else {
      const loan =
        c.kind === "betrayal" && s.allies.find((u) => u.uid === c.unitId);
      score -=
        (loan ? loan.atk * 2.1 + loan.hp * 0.75 : debtValue(c) * 0.92) *
        discount;
    }
  }
  return score;
}

export function chooseBattleAction(original, beam = 6) {
  const s = publicState(original);
  const knownHand = new Set(s.hand.map((c) => c.uid));
  const base = positionValue(s);
  const candidates = [];
  for (const action of actions(s, knownHand)) {
    const next = act(s, action);
    if (!next.notice)
      candidates.push({ action, state: next, score: positionValue(next) });
  }
  candidates.sort((a, b) => b.score - a.score);
  let best = { action: { type: "endTurn" }, score: base + 0.01 };
  for (const candidate of candidates)
    if (candidate.score > best.score) best = candidate;
  // Explicitly compare resource/setup -> payoff combinations. Newly drawn cards
  // are not legal search actions, even if they came from a known discard pile.
  for (const first of candidates.slice(0, beam)) {
    const used = new Set(
      first.action.type === "play" ? [first.action.uid] : [],
    );
    for (const action of actions(first.state, knownHand, used)) {
      const next = act(first.state, action);
      if (next.notice) continue;
      const score = positionValue(next) - 0.015;
      if (score > best.score) best = { action: first.action, score };
    }
  }
  return best.action;
}

const preferences = {
  contract: [
    "transfer",
    "weaver",
    "rewrite",
    "borrowedFlame",
    "foreclose",
    "borrowedEnergy",
    "judge",
    "borrowedKnight",
    "borrowedInsight",
    "sever",
  ],
  burn: [
    "kindling",
    "cinder",
    "firekeeper",
    "detonate",
    "phoenix",
    "inferno",
    "tempest",
  ],
  armor: [
    "shieldSlam",
    "shieldSmith",
    "brace",
    "borrowedAegis",
    "bastion",
    "shield",
    "judge",
  ],
  healing: [
    "lifeweaver",
    "mercy",
    "bloom",
    "priest",
    "renewal",
    "phoenix",
    "reaper",
    "mend",
  ],
};
function cardValue(s, key) {
  const d = CARDS[key];
  const route = preferences[s.archetype] || preferences.contract;
  const index = route.indexOf(key);
  const copies = s.deck.filter((c) => c.key === key).length;
  let value = index >= 0 ? 11 - index * 0.38 : d.type === "unit" ? 6.5 : 4.5;
  if (key === "phoenix") value = Math.max(value, 9);
  if (["renewal", "bastion", "mercy", "oath", "lifeweaver"].includes(key))
    value = Math.max(value, 7.5);
  // Reward diversity: a second copy is useful, a third core crowds a 3-slot board.
  value -= Math.max(0, copies - 1) * (d.type === "unit" ? 3 : 1.4);
  if (!copies && ARCHETYPES[s.archetype].pool.includes(key)) value += 0.8;
  if (key === "detonate" && copies >= 1) value -= 1.5;
  return value;
}
function chooseProgress(s) {
  if (s.phase === "reward") {
    if (s.hero.hp < 14) return { type: "reward", key: "heal" };
    const key = [...s.rewardOffer].sort(
      (a, b) => cardValue(s, b) - cardValue(s, a),
    )[0];
    return { type: "reward", key };
  }
  if (s.phase === "relic") {
    const order =
      s.archetype === "armor"
        ? ["ring", "quill", "stone", "banner", "sun", "chalice"]
        : ["quill", "stone", "ring", "banner", "sun", "chalice"];
    return {
      type: "relic",
      key: [...s.relicOffer].sort(
        (a, b) => order.indexOf(a) - order.indexOf(b),
      )[0],
    };
  }
  if (s.phase === "camp") {
    const cards = s.deck
      .filter((c) => !c.upgraded)
      .sort((a, b) => {
        const upgrade = (c) =>
          cardValue(s, c.key) +
          (c.key === "foreclose" || c.key === "shieldSlam" ? 2 : 0) +
          (CARDS[c.key].type === "unit" ? 1.8 : 0);
        return upgrade(b) - upgrade(a);
      });
    return s.hero.hp < 24 || !cards.length
      ? { type: "camp", choice: "rest" }
      : { type: "camp", choice: "upgrade", uid: cards[0].uid };
  }
  throw new Error("Unexpected phase: " + s.phase);
}

function add(map, key, n = 1) {
  map[key] = (map[key] || 0) + n;
}
export function runCampaign(seed, difficulty, route, beam) {
  let s = newRun(seed, difficulty, route);
  const row = {
    seed,
    difficulty,
    route,
    actions: 0,
    turns: 0,
    forcedTurnEnds: 0,
    casts: {},
    triggers: {},
    triggerValues: {},
    rewards: {},
    rewardRoute: 0,
    rewardOffRoute: 0,
    rewardHeals: 0,
    stageTurns: [],
    stageHp: [],
    maxBurn: 0,
    maxArmor: 0,
    maxAllyAttack: 0,
    shieldSpent: 0,
    detonationLayers: 0,
    firstCoreTrigger: null,
  };
  let perTurn = 0;
  while (!["won", "lost"].includes(s.phase) && row.actions < 1200) {
    if (s.phase === "battle" && perTurn >= 32) row.forcedTurnEnds++;
    const a =
      s.phase === "battle"
        ? perTurn >= 32
          ? { type: "endTurn" }
          : chooseBattleAction(s, beam)
        : chooseProgress(s);
    const before = s;
    let events;
    if (a.type === "endTurn") {
      const next = enemyTurnPlayback(s);
      s = next.state;
      events = [
        ...next.frames.flatMap((f) => f.triggers),
        ...next.tailTriggers,
      ];
      row.turns++;
      perTurn = 0;
    } else {
      const next = actionFeedback(s, a);
      s = next.state;
      events = next.triggers;
      if (before.phase === "battle") perTurn++;
    }
    assert.equal(s.notice, "", `${route}/${difficulty}/${seed}: ${s.notice}`);
    assert.ok(validateSave(s), "Every real result remains a valid save");
    row.actions++;
    if (a.type === "play") {
      const key = before.hand.find((c) => c.uid === a.uid).key;
      add(row.casts, key);
      if (key === "shieldSlam")
        row.shieldSpent += Math.min(
          before.hero.shield,
          cardInfo(before.hand.find((c) => c.uid === a.uid)).armorStrike,
        );
      if (key === "detonate")
        row.detonationLayers += (
          a.target === "boss"
            ? before.boss
            : before.enemies.find((u) => u.uid === a.target)
        ).burn;
    }
    for (const t of events) {
      add(row.triggers, t.ability);
      if (typeof t.value === "number")
        add(row.triggerValues, t.ability, t.value);
      const core = {
        contract: "书契",
        burn: "引燃",
        armor: "锻甲",
        healing: "返照",
      }[route];
      if (!row.firstCoreTrigger && t.ability === core)
        row.firstCoreTrigger = { stage: before.stage + 1, turn: before.turn };
    }
    if (a.type === "reward") {
      if (a.key === "heal") row.rewardHeals++;
      else {
        add(row.rewards, a.key);
        ARCHETYPES[route].pool.includes(a.key)
          ? row.rewardRoute++
          : row.rewardOffRoute++;
      }
    }
    if (before.phase === "battle" && s.phase !== "battle") {
      row.stageTurns.push(s.turn);
      row.stageHp.push(s.hero.hp);
    }
    row.maxBurn = Math.max(
      row.maxBurn,
      s.boss.burn,
      ...s.enemies.map((u) => u.burn),
    );
    row.maxArmor = Math.max(row.maxArmor, s.hero.shield);
    row.maxAllyAttack = Math.max(
      row.maxAllyAttack,
      ...s.allies.map((u) => u.atk),
    );
  }
  assert.ok(row.actions < 1200, "Campaign action budget exhausted");
  return {
    ...row,
    won: s.phase === "won",
    finishStage: s.stage + 1,
    hp: s.hero.hp,
    deckSize: s.deck.length,
    deck: s.deck.map((c) => c.key),
    lifePaid: s.stats.paidLife,
  };
}

function summary(rows) {
  const avg = (key) =>
    Math.round((rows.reduce((a, r) => a + r[key], 0) / rows.length) * 100) /
    100;
  const sumMap = (key) =>
    rows.reduce((map, r) => {
      for (const [k, v] of Object.entries(r[key])) add(map, k, v);
      return map;
    }, {});
  const stages = Array.from({ length: 5 }, (_, i) => {
    const reached = rows.filter((r) => r.stageTurns.length > i);
    return {
      stage: i + 1,
      reached: reached.length,
      meanTurns: reached.length
        ? +(
            reached.reduce((n, r) => n + r.stageTurns[i], 0) / reached.length
          ).toFixed(2)
        : null,
    };
  });
  return {
    runs: rows.length,
    wins: rows.filter((r) => r.won).length,
    meanHp: avg("hp"),
    meanTurns: avg("turns"),
    meanActions: avg("actions"),
    forcedTurnEnds: rows.reduce((n, r) => n + r.forcedTurnEnds, 0),
    meanDeckSize: avg("deckSize"),
    meanRouteRewards: avg("rewardRoute"),
    meanOffRouteRewards: avg("rewardOffRoute"),
    rewardHeals: rows.reduce((n, r) => n + r.rewardHeals, 0),
    runsWithCoreTrigger: rows.filter((r) => r.firstCoreTrigger).length,
    maxBurn: Math.max(...rows.map((r) => r.maxBurn)),
    maxArmor: Math.max(...rows.map((r) => r.maxArmor)),
    maxAllyAttack: Math.max(...rows.map((r) => r.maxAllyAttack)),
    triggers: sumMap("triggers"),
    triggerValues: sumMap("triggerValues"),
    casts: sumMap("casts"),
    rewards: sumMap("rewards"),
    shieldSpent: rows.reduce((n, r) => n + r.shieldSpent, 0),
    detonationLayers: rows.reduce((n, r) => n + r.detonationLayers, 0),
    stages,
  };
}

function verifyNoHiddenInformation() {
  const s = newRun(571, "normal", "burn");
  const expected = chooseBattleAction(s);
  const guarded = { ...s };
  Object.defineProperty(guarded, "seed", {
    enumerable: true,
    get() {
      throw new Error("Policy read live RNG");
    },
  });
  guarded.draw = new Proxy(s.draw, {
    get(target, key) {
      if (key === "length") return target.length;
      throw new Error("Policy read hidden draw identity/order");
    },
  });
  assert.deepEqual(chooseBattleAction(guarded), expected);
  const different = { ...s, seed: 9999999, draw: [...s.draw].reverse() };
  assert.deepEqual(chooseBattleAction(different), expected);
}

async function main() {
  const options = Object.fromEntries(
    process.argv
      .slice(2)
      .map((arg) => arg.replace(/^--/, "").split(/=(.*)/s).slice(0, 2)),
  );
  const normal = Number(options.normal || 24),
    other = Number(options.other || 8),
    beam = Number(options.beam || 6);
  assert.ok(normal > 0 && other > 0 && beam > 0);
  const sourceHashes = Object.fromEntries(
    await Promise.all(
      ["../src/data.js", "../src/engine.js", "./archetype-sim.mjs"].map(
        async (file) => [
          file,
          createHash("sha256")
            .update(await readFile(new URL(file, import.meta.url)))
            .digest("hex"),
        ],
      ),
    ),
  );
  assert.ok(
    !options.ablation || options.ablation === "core",
    "Only --ablation=core is supported",
  );
  const corePassives = {
    contract: ["weaver", "书契"],
    burn: ["firekeeper", "引燃"],
    armor: ["shieldSmith", "锻甲"],
    healing: ["lifeweaver", "返照"],
  };
  const originalTags = Object.fromEntries(
    Object.values(corePassives).map(([key]) => [key, [...CARDS[key].tags]]),
  );
  verifyNoHiddenInformation();
  const rows = [],
    groups = {};
  for (const difficulty of options.only
    ? [options.only]
    : ["normal", "story", "eclipse"])
    for (const route of Object.keys(ARCHETYPES)) {
      if (options.ablation === "core") {
        for (const [key, tags] of Object.entries(originalTags))
          CARDS[key].tags = [...tags];
        const [key, tag] = corePassives[route];
        CARDS[key].tags = CARDS[key].tags.filter((x) => x !== tag);
      }
      const group = [];
      for (let n = 1; n <= (difficulty === "normal" ? normal : other); n++) {
        const row = runCampaign(n * 571, difficulty, route, beam);
        rows.push(row);
        group.push(row);
      }
      groups[`${difficulty}/${route}`] = summary(group);
      console.log(
        JSON.stringify({
          difficulty,
          route,
          ...groups[`${difficulty}/${route}`],
        }),
      );
    }
  const report = {
    sourceHashes,
    method: {
      ablation:
        options.ablation === "core"
          ? "Single-passive ablation: removes only the current route's core tag (bookweaving/ignition/forging/reflection) in memory. Other routes' passives remain available. Keeps card counts, costs, bodies, active cards and reward pools; does NOT disable all three new cards."
          : "None; full route rules.",
      question:
        "Can all four routes finish seeded expeditions, activate their core, and obtain relevant rewards without a route becoming an obvious outlier?",
      assumptions:
        "Same seeds and one bounded heuristic policy per route. 12-card starters, current rules, 32-action turn safety cap. Reward selection favors route synergy with duplicate diminishing returns; camps rest below 24 HP, otherwise upgrade.",
      visibility:
        "Current hand, entities, public contracts, public deck/discard/exhaust composition and draw COUNT. Planner replaces the live draw stack with opaque placeholders and the RNG with a constant. It never plans using newly drawn cards or future random rewards. Getter/proxy assertions enforce the hidden-state boundary.",
      policy: `All legal current actions plus a two-step beam of ${beam} first moves; deferred burn/debt/unit engine heuristic; exact deterministic transitions on sanitized state, replan after each real action.`,
      metrics:
        "Wins/runs (NOT human win rates), survival, turns, core trigger participation/count, casts, armor spent, burn detonated, reward composition and extremes.",
      limitations:
        "Small fixed seeds, hand-authored evaluation, no adversarial search, no exhaustive optimal strategy or UI validation. Rewards and upgrades are heuristic. Unknown draws are valued as one generic card and cannot be used in the two-step plan. New routes require human playtests; strong automatic results alone do not establish balance.",
    },
    groups,
    runs: rows,
  };
  if (options.out) {
    await mkdir(dirname(resolve(options.out)), { recursive: true });
    await writeFile(options.out, JSON.stringify(report, null, 2));
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
