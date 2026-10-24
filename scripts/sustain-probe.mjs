// Focused armor/healing probe. Uses the existing bounded public-information
// battle policy. Optional candidates mutate card numbers only inside this process;
// source game files and the policy are never edited.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chooseBattleAction } from "./archetype-sim.mjs";
import {
  newRun,
  actionFeedback,
  enemyTurnPlayback,
  validateSave,
} from "../src/engine.js";
import { CARDS, ARCHETYPES, cardInfo } from "../src/data.js";

const outputRoot = "C:/Users/onemt/Documents/Codex/ashen-pact_support/outputs";
const preference = {
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
// Intentionally matches archetype-sim.mjs's progression policy, which is private
// to that module. Kept here rather than changing the already-published simulator.
function cardValue(s, key) {
  const d = CARDS[key],
    index = preference[s.archetype].indexOf(key);
  const copies = s.deck.filter((c) => c.key === key).length;
  let score = index >= 0 ? 11 - index * 0.38 : d.type === "unit" ? 6.5 : 4.5;
  if (key === "phoenix") score = Math.max(score, 9);
  if (["renewal", "bastion", "mercy", "oath", "lifeweaver"].includes(key))
    score = Math.max(score, 7.5);
  score -= Math.max(0, copies - 1) * (d.type === "unit" ? 3 : 1.4);
  if (!copies && ARCHETYPES[s.archetype].pool.includes(key)) score += 0.8;
  if (key === "detonate" && copies >= 1) score -= 1.5;
  return score;
}
function progress(s) {
  if (s.phase === "reward")
    return {
      type: "reward",
      key:
        s.hero.hp < 14
          ? "heal"
          : [...s.rewardOffer].sort(
              (a, b) => cardValue(s, b) - cardValue(s, a),
            )[0],
    };
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
    const upgrade = (c) =>
      cardValue(s, c.key) +
      (["foreclose", "shieldSlam"].includes(c.key) ? 2 : 0) +
      (CARDS[c.key].type === "unit" ? 1.8 : 0);
    const cards = s.deck
      .filter((c) => !c.upgraded)
      .sort((a, b) => upgrade(b) - upgrade(a));
    return s.hero.hp < 24 || !cards.length
      ? { type: "camp", choice: "rest" }
      : { type: "camp", choice: "upgrade", uid: cards[0].uid };
  }
  throw new Error("Unexpected phase " + s.phase);
}
const add = (map, key, n = 1) => {
  map[key] = (map[key] || 0) + n;
};
const mean = (values) =>
  values.length
    ? Math.round(
        (values.reduce((n, x) => n + x, 0) / values.length + Number.EPSILON) *
          100,
      ) / 100
    : null;
function distribution(values) {
  const x = [...values].sort((a, b) => a - b);
  return {
    n: x.length,
    mean: mean(x),
    min: x[0] ?? null,
    p25: x[Math.floor((x.length - 1) * 0.25)] ?? null,
    median: x[Math.floor((x.length - 1) * 0.5)] ?? null,
    max: x.at(-1) ?? null,
  };
}

function composition(s) {
  const counts = {};
  for (const c of s.deck) add(counts, c.key);
  return {
    size: s.deck.length,
    counts,
    ownRoute: s.deck.filter((c) => ARCHETYPES[s.archetype].pool.includes(c.key))
      .length,
    coreCopies: counts[ARCHETYPES[s.archetype].core] || 0,
    armorSources: s.deck.filter(
      (c) =>
        CARDS[c.key].armor || CARDS[c.key].overhealArmor || c.key === "judge",
    ).length,
    healingSources: s.deck.filter(
      (c) =>
        CARDS[c.key].heal ||
        CARDS[c.key].tags?.some((t) => ["汲取", "复苏"].includes(t)),
    ).length,
    slamCopies: counts.shieldSlam || 0,
  };
}

function stageRecord(s) {
  return {
    stage: s.stage + 1,
    startHp: s.hero.hp,
    minHp: s.hero.hp,
    endHp: null,
    turns: null,
    opening: s.hand.map((c) => c.key),
    openingArmorCards: s.hand.filter((c) => cardInfo(c).armor).length,
    firstCorePlayed: null,
    firstCoreTrigger: null,
    corePlayed: 0,
    coreDeathsBeforeTrigger: 0,
    armorCardsBeforeCore: 0,
    armorBeforeCore: 0,
    coreBlockedByFullBoard: 0,
    firstReadyCoreCard: null,
    firstCoreAffordable: null,
    triggers: {},
    triggerDamage: 0,
    reflectionOverheal: 0,
    reflectionPartial: 0,
    slamCasts: 0,
    slamSpent: 0,
    slamNoArmor: 0,
    maxCoreAttack: 0,
    twoCoreTurns: [],
    coreUnits: {},
    endTurnsAt15: 0,
    coreTurnDeath: [],
    firstBattleTrace: [],
  };
}

export function probeRun(seed, difficulty, route, beam = 6) {
  let s = newRun(seed, difficulty, route);
  const row = {
    seed,
    difficulty,
    route,
    actions: 0,
    forcedEnds: 0,
    stages: [stageRecord(s)],
    casts: {},
    rewards: [],
    relics: [],
    camp: [],
    minimumHp: 40,
    reflection: 0,
    reflectionDamage: 0,
    reflectionOverheal: 0,
    reflectionPartial: 0,
    shieldCasts: 0,
    shieldSpent: 0,
    shieldEmpty: 0,
    shieldDamage: 0,
    coreAttacks: 0,
    coreAttackDamage: 0,
    coreBossAttackDamage: 0,
    maxCoreAttack: 0,
    healingFx: 0,
    damageFx: 0,
    rewardSnapshots: [],
  };
  let perTurn = 0;
  const coreKey = ARCHETYPES[route].core,
    coreTag = route === "armor" ? "锻甲" : "返照";
  function sample(snapshot, stage) {
    stage.minHp = Math.min(stage.minHp, snapshot.hero.hp);
    row.minimumHp = Math.min(row.minimumHp, snapshot.hero.hp);
    const core = snapshot.allies.filter((u) => u.key === coreKey && u.hp > 0);
    for (const unit of core) {
      stage.maxCoreAttack = Math.max(stage.maxCoreAttack, unit.atk);
      row.maxCoreAttack = Math.max(row.maxCoreAttack, unit.atk);
    }
    if (core.length >= 2 && !stage.twoCoreTurns.includes(snapshot.turn))
      stage.twoCoreTurns.push(snapshot.turn);
  }
  function observe(before, after, effects, events, stage, turn) {
    // Ordered FX reconstruct life before later healing/after-victory recovery.
    // Blocking has nonnumeric "格挡" FX and does not reduce life.
    let hp = before.hero.hp;
    for (const fx of effects) {
      if (fx.target !== "hero" || typeof fx.value !== "number") continue;
      if (fx.type === "hit") {
        hp = Math.max(0, hp - fx.value);
        row.damageFx += fx.value;
      }
      if (fx.type === "heal") {
        hp = Math.min(after.hero.maxHp, hp + fx.value);
        row.healingFx += fx.value;
      }
      stage.minHp = Math.min(stage.minHp, hp);
      row.minimumHp = Math.min(row.minimumHp, hp);
    }
    assert.equal(
      hp,
      after.hero.hp,
      "Ordered hero FX must reconstruct actual final life",
    );
    for (const event of events) {
      add(stage.triggers, event.ability);
      if (event.ability === coreTag) {
        if (stage.firstCoreTrigger === null) stage.firstCoreTrigger = turn;
        if (stage.coreUnits[event.sourceId])
          stage.coreUnits[event.sourceId].triggered = true;
      }
      if (event.ability === "返照") {
        row.reflection++;
        row.reflectionDamage += event.value;
        stage.triggerDamage += event.value;
        if (event.healed === 0) {
          row.reflectionOverheal++;
          stage.reflectionOverheal++;
        } else if (event.overheal > 0) {
          row.reflectionPartial++;
          stage.reflectionPartial++;
        }
      }
    }
    for (const unit of before.allies.filter((u) => u.key === coreKey)) {
      if (!after.allies.some((u) => u.uid === unit.uid)) {
        if (!stage.coreUnits[unit.uid]?.triggered)
          stage.coreDeathsBeforeTrigger++;
        stage.coreTurnDeath.push(turn);
      }
    }
    sample(after, stage);
  }
  while (!["won", "lost"].includes(s.phase) && row.actions < 1200) {
    let stage = row.stages.at(-1);
    if (s.phase === "battle") {
      const c = s.hand.find((c) => c.key === coreKey);
      if (c && stage.firstReadyCoreCard === null)
        stage.firstReadyCoreCard = s.turn;
      if (
        c &&
        cardInfo(c).cost <= s.energy &&
        stage.firstCoreAffordable === null
      )
        stage.firstCoreAffordable = s.turn;
      if (c && cardInfo(c).cost <= s.energy && s.allies.length >= 3)
        stage.coreBlockedByFullBoard++;
    }
    if (s.phase === "battle" && perTurn >= 32) row.forcedEnds++;
    const a =
      s.phase === "battle"
        ? perTurn >= 32
          ? { type: "endTurn" }
          : chooseBattleAction(s, beam)
        : progress(s);
    const before = s;
    const played =
      a.type === "play" ? before.hand.find((c) => c.uid === a.uid) : null;
    const definition = played && cardInfo(played);
    let events = [];
    if (a.type === "endTurn") {
      if (before.hero.hp <= 15) stage.endTurnsAt15++;
      const result = enemyTurnPlayback(before);
      s = result.state;
      for (const frame of result.frames) {
        observe(
          frame.before,
          frame.after,
          frame.effects,
          frame.triggers,
          stage,
          frame.after.turn,
        );
        events.push(...frame.triggers);
      }
      const ids = new Set(
        result.frames.flatMap((f) => f.effects.map((e) => e.id)),
      );
      observe(
        result.frames.at(-1)?.after || before,
        s,
        s.effects.filter((e) => !ids.has(e.id)),
        result.tailTriggers,
        stage,
        s.turn,
      );
      events.push(...result.tailTriggers);
      perTurn = 0;
    } else {
      const result = actionFeedback(before, a);
      s = result.state;
      events = result.triggers;
      if (before.phase === "battle") {
        // Register the source before events from that same summon are observed.
        if (played?.key === coreKey)
          for (const unit of s.allies.filter(
            (u) =>
              u.key === coreKey && !before.allies.some((b) => b.uid === u.uid),
          ))
            stage.coreUnits[unit.uid] = { turn: before.turn, triggered: false };
        observe(before, s, s.effects, events, stage, s.turn);
        perTurn++;
      }
    }
    assert.equal(s.notice, "");
    assert.ok(validateSave(s));
    row.actions++;
    const directTargetDamage = () =>
      s.effects
        .filter(
          (fx) =>
            fx.target === a.target &&
            fx.type === "hit" &&
            typeof fx.value === "number",
        )
        .reduce((n, fx) => n + fx.value, 0);
    if (
      a.type === "attack" &&
      before.allies.find((u) => u.uid === a.uid)?.key === coreKey
    ) {
      row.coreAttacks++;
      row.coreAttackDamage += directTargetDamage();
      if (a.target === "boss") row.coreBossAttackDamage += directTargetDamage();
    }
    if (played) {
      add(row.casts, played.key);
      if (played.key === coreKey) {
        stage.corePlayed++;
        if (stage.firstCorePlayed === null) stage.firstCorePlayed = before.turn;
      }
      if (definition.armor && stage.firstCorePlayed === null) {
        stage.armorCardsBeforeCore++;
        stage.armorBeforeCore += definition.armor;
      }
      if (played.key === "shieldSlam") {
        const spent = Math.min(before.hero.shield, definition.armorStrike);
        row.shieldCasts++;
        row.shieldSpent += spent;
        row.shieldDamage += directTargetDamage();
        stage.slamCasts++;
        stage.slamSpent += spent;
        if (!spent) {
          row.shieldEmpty++;
          stage.slamNoArmor++;
        }
      }
    }
    if (before.phase === "battle" && stage.stage === 1)
      stage.firstBattleTrace.push({
        turn: before.turn,
        action: a.type,
        card: played?.key,
        target: a.target,
        hpBefore: before.hero.hp,
        hpAfter: s.hero.hp,
        armorBefore: before.hero.shield,
        energy: before.energy,
        allies: before.allies.map((u) => u.key),
        triggers: events.map((t) => t.ability),
      });
    if (before.phase === "battle" && s.phase !== "battle") {
      stage.turns = s.turn;
      stage.endHp = s.hero.hp;
      stage.outcome = s.phase;
    }
    if (a.type === "reward") {
      row.rewards.push({
        stage: before.stage + 1,
        round: before.rewardRound,
        key: a.key,
        offered: [...before.rewardOffer],
      });
      row.rewardSnapshots.push({
        stage: before.stage + 1,
        round: before.rewardRound,
        ...composition(s),
      });
    }
    if (a.type === "relic") row.relics.push(a.key);
    if (a.type === "camp") {
      row.camp.push({
        stage: before.stage + 1,
        choice: a.choice,
        card: a.uid && before.deck.find((c) => c.uid === a.uid)?.key,
        hp: before.hero.hp,
      });
      row.stages.push(stageRecord(s));
      perTurn = 0;
    }
  }
  assert.ok(row.actions < 1200);
  return {
    ...row,
    won: s.phase === "won",
    finalHp: s.hero.hp,
    finishStage: s.stage + 1,
    deck: composition(s),
  };
}

function summarize(rows) {
  const stages = rows.flatMap((r) => r.stages),
    first = rows.map((r) => r.stages[0]);
  const total = (key) => rows.reduce((n, r) => n + r[key], 0);
  const selected = {};
  for (const row of rows) for (const r of row.rewards) add(selected, r.key);
  return {
    n: rows.length,
    wins: rows.filter((r) => r.won).length,
    finalHp: distribution(rows.map((r) => r.finalHp)),
    minHp: distribution(rows.map((r) => r.minimumHp)),
    fullFinal: rows.filter((r) => r.finalHp === 40).length,
    everAt15: rows.filter((r) => r.minimumHp <= 15).length,
    everAt10: rows.filter((r) => r.minimumHp <= 10).length,
    fightTurns: distribution(
      stages.filter((s) => s.turns !== null).map((s) => s.turns),
    ),
    firstBattle: {
      corePlayed: first.filter((s) => s.firstCorePlayed !== null).length,
      coreTriggered: first.filter((s) => s.firstCoreTrigger !== null).length,
      corePlayTurn: distribution(
        first
          .filter((s) => s.firstCorePlayed !== null)
          .map((s) => s.firstCorePlayed),
      ),
      coreTriggerTurn: distribution(
        first
          .filter((s) => s.firstCoreTrigger !== null)
          .map((s) => s.firstCoreTrigger),
      ),
      playedButNoTrigger: first.filter(
        (s) => s.firstCorePlayed !== null && s.firstCoreTrigger === null,
      ).length,
      noArmorOpening: first.filter((s) => !s.openingArmorCards).length,
      usedArmorBeforeCore: first.filter((s) => s.armorCardsBeforeCore > 0)
        .length,
      blockedByFullBoard: first.filter((s) => s.coreBlockedByFullBoard > 0)
        .length,
      coreDiedBeforeTrigger: first.filter((s) => s.coreDeathsBeforeTrigger > 0)
        .length,
      minHp: distribution(first.map((s) => s.minHp)),
    },
    shieldCasts: total("shieldCasts"),
    shieldSpent: total("shieldSpent"),
    meanShieldPerCast: total("shieldCasts")
      ? +(total("shieldSpent") / total("shieldCasts")).toFixed(2)
      : 0,
    emptyShieldCasts: total("shieldEmpty"),
    shieldDamage: total("shieldDamage"),
    maxCoreAttack: distribution(rows.map((r) => r.maxCoreAttack)),
    coreAttacks: total("coreAttacks"),
    coreAttackDamage: total("coreAttackDamage"),
    coreBossAttackDamage: total("coreBossAttackDamage"),
    reflection: total("reflection"),
    reflectionDamage: total("reflectionDamage"),
    reflectionOverheal: total("reflectionOverheal"),
    overhealFraction: total("reflection")
      ? +(total("reflectionOverheal") / total("reflection")).toFixed(3)
      : 0,
    runsWithTwoCore: rows.filter((r) =>
      r.stages.some((s) => s.twoCoreTurns.length),
    ).length,
    twoCoreTurns: stages.reduce((n, s) => n + s.twoCoreTurns.length, 0),
    stageFormation: Array.from({ length: 4 }, (_, i) => {
      const snapshots = rows.flatMap((r) =>
        r.rewardSnapshots.filter((x) => x.stage === i + 1 && x.round === 2),
      );
      return {
        afterStage: i + 1,
        n: snapshots.length,
        coreCopies: mean(snapshots.map((x) => x.coreCopies)),
        sameRouteCards: mean(snapshots.map((x) => x.ownRoute)),
        armorSources: mean(snapshots.map((x) => x.armorSources)),
        healingSources: mean(snapshots.map((x) => x.healingSources)),
        slamCopies: mean(snapshots.map((x) => x.slamCopies)),
        twoCoreDecks: snapshots.filter((x) => x.coreCopies >= 2).length,
      };
    }),
    rewards: selected,
    forcedEnds: total("forcedEnds"),
  };
}

async function main() {
  const options = Object.fromEntries(
    process.argv
      .slice(2)
      .map((a) => a.replace(/^--/, "").split(/=(.*)/s).slice(0, 2)),
  );
  const n = Number(options.n || 24),
    beam = Number(options.beam || 6);
  assert.ok(n > 0 && beam > 0);
  const variant = options.variant || "baseline";
  const variants = {
    baseline: [],
    "control-v240": [
      { card: "shieldSmith", property: "hp", value: 6 },
      { card: "lifeweaver", property: "atk", value: 2 },
    ],
    A: [{ card: "shieldSmith", property: "hp", value: 8 }],
    B: [{ card: "shieldSmith", property: "hp", value: 9 }],
    C: [{ card: "lifeweaver", property: "atk", value: 1 }],
    D: [
      { card: "shieldSmith", property: "hp", value: 8 },
      { card: "lifeweaver", property: "atk", value: 1 },
    ],
    E: [
      { card: "shieldSmith", property: "hp", value: 9 },
      { card: "lifeweaver", property: "atk", value: 1 },
    ],
  };
  assert.ok(Object.hasOwn(variants, variant), "Unknown candidate");
  const runtimeMutations = variants[variant].map((change) => ({
    ...change,
    original: CARDS[change.card][change.property],
  }));
  for (const change of runtimeMutations)
    CARDS[change.card][change.property] = change.value;
  const sourceHashes = Object.fromEntries(
    await Promise.all(
      [
        "../src/data.js",
        "../src/engine.js",
        "./archetype-sim.mjs",
        "./sustain-probe.mjs",
      ].map(async (file) => [
        file,
        createHash("sha256")
          .update(await readFile(new URL(file, import.meta.url)))
          .digest("hex"),
      ]),
    ),
  );
  const rows = [],
    groups = {};
  for (const difficulty of ["normal", "eclipse"])
    for (const route of ["armor", "healing"]) {
      const group = [];
      for (let i = 1; i <= n; i++) {
        const row = probeRun(i * 571, difficulty, route, beam);
        group.push(row);
        rows.push(row);
      }
      groups[`${difficulty}/${route}`] = summarize(group);
      console.log(
        JSON.stringify({
          group: `${difficulty}/${route}`,
          ...groups[`${difficulty}/${route}`],
        }),
      );
    }
  const report = {
    version: "2.4-focused-" + variant,
    variant,
    runtimeMutations,
    sourceHashes,
    method: {
      purpose:
        "Compare armor/healing formation timing, damage conversion and survival; not just wins.",
      policy:
        "Same public-information two-step beam from archetype-sim; identical reward/camp policy copied here, no hidden draw identities/order or live RNG in decision making.",
      health:
        "Minimum HP reconstructed from ordered hero damage/healing FX, checked against final HP after every segment, including victory billing before recovery. Final HP is after the final boss; first four stage end HP include victory recovery.",
      damage:
        "Reflection damage uses the engine trigger value (after armor/ward, may include overkill); full-overheal count is per source proc, not unique heal attempts when multiple doctors react.",
      limits:
        "One hand-authored policy, fixed seeds, no cross-turn optimal hand retention or human error. Core play delay can reflect policy and board competition. Reward preferences influence formation. Repeated success is not a human win-rate estimate.",
    },
    groups,
    runs: rows,
  };
  await mkdir(outputRoot, { recursive: true });
  await writeFile(
    resolve(outputRoot, options.file || "sustain-v240-baseline.json"),
    JSON.stringify(report, null, 2),
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
