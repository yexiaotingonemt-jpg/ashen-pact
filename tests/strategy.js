import { newRun, act, validTargets } from "../src/engine.js";
import { cardInfo, CARDS } from "../src/data.js";
import { debtValue } from "../src/contracts.js";
export function actions(s) {
  const a = [];
  if (s.phase !== "battle") return a;
  for (const c of s.hand) {
    const d = cardInfo(c);
    if (d.cost > s.energy) continue;
    if (d.type === "unit") {
      if (s.allies.length < 3) a.push({ type: "play", uid: c.uid });
    } else if (d.target === "self") a.push({ type: "play", uid: c.uid });
    else
      for (const target of validTargets(s, { type: "card", uid: c.uid }))
        a.push({ type: "play", uid: c.uid, target });
  }
  for (const u of s.allies)
    if (u.ready)
      for (const target of validTargets(s, { type: "unit", uid: u.uid }))
        a.push({ type: "attack", uid: u.uid, target });
  if (!s.skillUsed && s.energy >= 2)
    for (const target of ["boss", ...s.enemies.map((x) => x.uid)])
      a.push({ type: "skill", target });
  return a;
}
export function value(s) {
  const future = (s.contracts || []).reduce((score, c) => {
    const discount = 1 / (1 + Math.max(0, c.due - s.turn - 1) * 0.28);
    if (c.kind === "omen") {
      const risk =
        c.effect === "strike" || c.effect === "hex"
          ? c.value * 0.85
          : c.effect === "summon"
            ? 5
            : c.effect === "ward"
              ? c.value * 0.4
              : c.effect === "howl"
                ? s.enemies.length * 1.2
                : c.effect === "collect"
                  ? s.contracts.some((x) => x.owner === "player")
                    ? s.contracts.filter((x) => x.owner === "player").length *
                      1.6
                    : 2 * 0.85
                  : c.effect === "writ"
                    ? s.contracts.some((x) => x.owner === "player")
                      ? s.contracts.filter((x) => x.owner === "player").length *
                        1.3
                      : 3 * 0.4
                    : 0;
      return score - (risk + (c.rage || 0) * 0.9) * discount;
    }
    if (c.owner === "enemy") return score + c.amount * 1.4 * discount;
    const unit =
      c.kind === "betrayal" ? s.allies.find((u) => u.uid === c.unitId) : null;
    const risk = unit
      ? (unit.atk * 2 + unit.hp * 0.85) * 0.8
      : debtValue(c) * 0.9;
    return score - risk * discount;
  }, 0);
  return (
    future +
    (s.phase === "won" || s.phase === "reward"
      ? 10000
      : s.phase === "lost"
        ? -10000
        : 0) +
    s.hero.hp * 0.95 +
    s.hero.shield * 0.7 -
    s.boss.hp * 1.4 -
    s.boss.shield * 0.6 -
    s.enemies.reduce(
      (v, u) =>
        v +
        u.atk * 2 +
        u.hp * 0.85 +
        (u.tags.includes("守卫") ? 2 : 0) -
        u.burn * 0.8,
      0,
    ) +
    s.allies.reduce(
      (v, u) =>
        v +
        u.atk * 2 +
        u.hp * 0.85 +
        (u.tags.includes("守卫") ? 3 : 0) +
        (u.tags.includes("复苏") ? 4 : 0) +
        (u.ready ? 1 : 0) +
        (u.ward ? 2 : 0),
      0,
    ) +
    s.hand.length * 0.9 +
    s.energy * 0.4
  );
}
export function chooseAction(s) {
  let best = null,
    score = value(s) + 0.01;
  for (const a of actions(s)) {
    const t = act(s, a);
    if (t.notice) continue;
    const v = value(t);
    if (v > score) {
      score = v;
      best = a;
    }
  }
  return best || { type: "endTurn" };
}
export function chooseProgress(s) {
  if (s.phase === "reward") {
    const order = [
      "phoenix",
      "transfer",
      "rewrite",
      "renewal",
      "weaver",
      "foreclose",
      "bastion",
      "inferno",
      "tempest",
      "oath",
      "cinder",
      "priest",
      "knight",
      "reaper",
      "oracle",
      "lancer",
      "spark",
      "borrowedKnight",
      "borrowedFlame",
      "borrowedAegis",
      "borrowedEnergy",
      "borrowedInsight",
      "defer",
      "sever",
      "judge",
    ];
    return {
      type: "reward",
      key:
        s.hero.hp < 17
          ? "heal"
          : [...s.rewardOffer].sort(
              (a, b) => order.indexOf(a) - order.indexOf(b),
            )[0],
    };
  }
  if (s.phase === "relic") {
    const order = ["quill", "ring", "stone", "banner", "sun", "chalice"];
    return {
      type: "relic",
      key: [...s.relicOffer].sort(
        (a, b) => order.indexOf(a) - order.indexOf(b),
      )[0],
    };
  }
  if (s.phase === "camp") {
    const c =
      s.deck.find((c) => !c.upgraded && CARDS[c.key].type === "unit") ||
      s.deck.find((c) => !c.upgraded);
    return s.hero.hp < 30 || !c
      ? { type: "camp", choice: "rest" }
      : { type: "camp", choice: "upgrade", uid: c.uid };
  }
}
if (
  typeof process !== "undefined" &&
  process.argv[1]?.endsWith("strategy.js")
) {
  const results = {};
  for (const difficulty of ["story", "normal", "eclipse"]) {
    let wins = 0,
      stages = [0, 0, 0, 0, 0],
      turns = 0;
    for (let seed = 1; seed <= 60; seed++) {
      let s = newRun(seed * 571, difficulty);
      let moves = 0;
      while (!["won", "lost"].includes(s.phase) && moves++ < 900) {
        const a = s.phase === "battle" ? chooseAction(s) : chooseProgress(s);
        s = act(s, a);
        if (s.notice) throw Error(s.notice);
      }
      if (moves >= 900) throw Error("Run did not terminate");
      if (s.phase === "won") wins++;
      stages[s.stage]++;
      turns += s.stats.turns + s.turn;
    }
    results[difficulty] = {
      runs: 60,
      wins,
      winRate: `${Math.round((wins / 60) * 100)}%`,
      finishStage: stages,
      averageTurns: Math.round(turns / 60),
    };
  }
  console.log(JSON.stringify(results, null, 2));
}
