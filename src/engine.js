import {
  CARDS,
  cardInfo,
  ENEMIES,
  ENCOUNTERS,
  STARTER,
  REWARD_POOL,
  RELICS,
  DIFFICULTIES,
} from "./data.js";
import {
  canEditContract,
  contractText,
  debtValue,
  victoryBill,
} from "./contracts.js";

export const SAVE_VERSION = 2;
const clone = (v) => structuredClone(v);
function random(s) {
  s.seed = (Math.imul(s.seed, 1664525) + 1013904223) >>> 0;
  return s.seed / 4294967296;
}
function shuffled(s, items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random(s) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function id(s) {
  return "c" + s.nextId++;
}
function log(s, text, kind = "info") {
  s.logs.push({ id: s.nextId++, text, kind });
  s.logs = s.logs.slice(-80);
}
function fx(s, type, target, value) {
  s.effects.push({ id: s.nextId++, type, target, value });
}
function heal(s, target, n) {
  const got = Math.min(n, target.maxHp - target.hp);
  target.hp += got;
  if (got) fx(s, "heal", target.uid, got);
  return got;
}
function draw(s, n) {
  for (let i = 0; i < n; i++) {
    if (!s.draw.length && s.discard.length) {
      s.draw = shuffled(s, s.discard);
      s.discard = [];
      log(s, "弃牌堆已重新洗入牌库。");
    }
    if (!s.draw.length) {
      s.fatigue++;
      damage(s, s.hero, s.fatigue);
      log(s, `牌库耗尽，疲劳造成 ${s.fatigue} 点伤害。`, "bad");
      continue;
    }
    const c = s.draw.pop();
    if (s.hand.length >= 8) {
      s.discard.push(c);
      log(s, `手牌已满，${cardInfo(c).name} 进入弃牌堆。`);
    } else {
      s.hand.push(c);
    }
  }
}
function damage(s, target, n) {
  if (n <= 0) return 0;
  if (target.ward) {
    target.ward = false;
    fx(s, "ward", target.uid, "圣盾");
    return 0;
  }
  const blocked = Math.min(target.shield || 0, n);
  target.shield = (target.shield || 0) - blocked;
  const dealt = n - blocked;
  target.hp = Math.max(0, target.hp - dealt);
  fx(s, "hit", target.uid, dealt || "格挡");
  return dealt;
}
function armor(s, n) {
  s.hero.shield += n;
  fx(s, "armor", "hero", n);
}

function signContract(s, details) {
  const order = s.nextId;
  const c = { uid: id(s), order, edits: 0, interest: 0, amount: 0, ...details };
  s.contracts.push(c);
  if (c.owner === "player") s.stats.signed++;
  log(
    s,
    `签下契约「${c.source}」：第 ${c.due} 回合，${contractText(c)}`,
    c.owner === "player" ? "contract" : "info",
  );
  return c;
}

function releaseBond(s, c) {
  if (!c.unitId) return;
  const unit = s.allies.find((u) => u.uid === c.unitId);
  if (unit) delete unit.loanContractId;
}

function takeContract(s, c) {
  s.contracts = s.contracts.filter((x) => x.uid !== c.uid);
  releaseBond(s, c);
}

function bloodPayment(s, target, amount) {
  target.hp = Math.max(0, target.hp - amount);
  fx(s, "hit", target.uid, amount);
  if (target.uid === "hero") s.stats.paidLife += amount;
  else s.stats.damage += amount;
}

function settleContract(s, c, context = { drawBudget: 2 }) {
  takeContract(s, c);
  log(
    s,
    `清算「${c.source}」：${contractText(c)}`,
    c.owner === "player" ? "bad" : "contract",
  );
  s.stats.settled++;
  s.history.push({ ...c, settledAt: s.turn });
  s.history = s.history.slice(-16);
  if (c.kind === "blood")
    bloodPayment(s, c.owner === "enemy" ? s.boss : s.hero, c.amount);
  else if (c.kind === "energy") {
    const paid = Math.min(s.energy, c.amount);
    s.energy -= paid;
    if (paid < c.amount) bloodPayment(s, s.hero, (c.amount - paid) * 3);
  } else if (c.kind === "draw") {
    const paid = Math.min(context.drawBudget, c.amount);
    context.drawBudget -= paid;
    if (paid < c.amount) bloodPayment(s, s.hero, (c.amount - paid) * 3);
  } else if (c.kind === "betrayal") {
    const u = s.allies.find((u) => u.uid === c.unitId);
    if (u) {
      s.allies = s.allies.filter((x) => x.uid !== u.uid);
      if (s.enemies.length < 3) {
        u.atk += c.interest || 0;
        u.ready = true;
        s.enemies.push(u);
        log(s, `${u.name}兑现旧誓，转身加入敌方。`, "bad");
      } else {
        s.boss.shield += 4;
        log(s, "敌方战场已满，骑士被收回，首领获得 4 护甲。", "bad");
      }
    }
  } else if (c.kind === "omen") {
    if (c.effect === "strike" || c.effect === "hex") {
      damage(s, s.hero, c.value);
      if (c.effect === "hex") s.boss.shield += 2;
    } else if (c.effect === "ward") s.boss.shield += c.value;
    else if (c.effect === "howl") s.enemies.forEach((u) => u.atk++);
    else if (c.effect === "summon" && s.enemies.length < 3)
      s.enemies.push(makeEnemy(s, s.stage >= 2 ? "elder" : "wolf"));
    else if (c.effect === "collect") {
      s.contracts
        .filter((x) => x.owner === "player")
        .forEach((x) => (x.due = Math.max(s.turn, x.due - 1)));
      log(s, "催债仪式：所有己方债务提前 1 回合。", "bad");
    } else if (c.effect === "writ") {
      s.contracts
        .filter((x) => x.owner === "player")
        .forEach((x) => {
          if (x.kind === "betrayal") x.interest++;
          else x.amount++;
        });
      log(s, "追加罚息：所有己方债务金额 +1；倒戈骑士攻击 +1。", "bad");
    }
    if (c.rage) damage(s, s.hero, c.rage);
  }
  const witnesses = s.allies.filter((u) => u.tags.includes("见证")).length;
  if (witnesses) armor(s, witnesses);
}

function queueOmens(s) {
  while (s.omenScheduledUntil < s.turn + 3) {
    const due = ++s.omenScheduledUntil;
    const definition = omenAt(s, due - 1);
    signContract(s, {
      owner: "enemy",
      kind: "omen",
      due,
      source: s.boss.name,
      effect: definition.type,
      ...definition,
    });
  }
}

function resolveDue(s) {
  const context = { drawBudget: 2 };
  for (let safety = 0; safety < 60; safety++) {
    const c = s.contracts
      .filter((c) => c.due <= s.turn)
      .sort((a, b) => a.due - b.due || a.order - b.order)[0];
    if (!c) return context;
    settleContract(s, c, context);
    if (check(s)) return context;
  }
  throw new Error("契约结算超出安全上限。");
}

function manipulate(s, c, effect) {
  if (effect === "transfer") {
    c.amount = debtValue(c);
    c.kind = "blood";
    c.owner = "enemy";
    s.stats.transfers++;
    log(s, `债务转嫁：第 ${c.due} 回合由首领支付 ${c.amount} 生命。`, "good");
  } else if (effect === "defer") {
    c.due++;
    c.edits++;
    if (c.owner === "player") {
      if (c.kind === "betrayal") c.interest++;
      else c.amount++;
    }
    log(
      s,
      `再借一天：「${c.source}」延期至第 ${c.due} 回合。${c.owner === "player" ? "债务已加息。" : ""}`,
      "good",
    );
  } else if (effect === "rewrite") {
    releaseBond(s, c);
    delete c.unitId;
    if (c.kind === "blood") {
      c.amount = Math.ceil(c.amount / 3);
      c.kind = "energy";
    } else {
      c.amount = debtValue(c);
      c.kind = "blood";
    }
    log(s, `改写条款：${contractText(c)}`, "good");
  } else if (effect === "sever") {
    takeContract(s, c);
    s.stats.cancelled++;
    log(s, `「${c.source}」被焚毁，不再兑现。`, "good");
  } else if (effect === "foreclose") {
    c.amount += 2;
    settleContract(s, c);
  }
  s.stats.weaves++;
  if (!s.weaverDrawn) {
    const n = s.allies.filter((u) => u.tags.includes("书契")).length;
    if (n) {
      draw(s, n);
      s.weaverDrawn = true;
    }
  }
}
function makeEnemy(s, key) {
  const d = ENEMIES[key];
  return {
    ...clone(d),
    key,
    uid: id(s),
    maxHp: d.hp,
    atk: Math.max(1, d.atk + DIFFICULTIES[s.difficulty].attack),
    burn: 0,
    ward: false,
    ready: true,
  };
}
function makeUnit(s, c) {
  const d = cardInfo(c);
  return {
    uid: id(s),
    key: c.key,
    upgraded: c.upgraded,
    name: d.name,
    art: d.art,
    atk: d.atk,
    hp: d.hp + (s.relics.includes("banner") ? 1 : 0),
    maxHp: d.hp + (s.relics.includes("banner") ? 1 : 0),
    tags: [...(d.tags || [])],
    burn: 0,
    ward: d.tags.includes("圣盾"),
    ready: d.tags.includes("突袭"),
  };
}
function clean(s) {
  const deadIds = s.allies.filter((u) => u.hp <= 0).map((u) => u.uid);
  for (const c of s.contracts.filter(
    (c) => c.kind === "betrayal" && deadIds.includes(c.unitId),
  )) {
    takeContract(s, c);
    log(s, `绑定随从阵亡，「${c.source}」的倒戈条款解除。`, "good");
  }
  for (const u of s.enemies.filter((x) => x.hp <= 0)) {
    log(s, `${u.name} 化为灰烬。`, "good");
    s.stats.kills++;
    if (s.relics.includes("ember") && !s.emberUsed) {
      heal(s, s.hero, 3);
      s.emberUsed = true;
      log(s, "不熄余烬：恢复 3 点生命。", "good");
    }
  }
  for (const u of s.allies.filter((x) => x.hp <= 0))
    log(s, `${u.name} 倒下了。`, "bad");
  s.enemies = s.enemies.filter((x) => x.hp > 0);
  s.allies = s.allies.filter((x) => x.hp > 0);
}
function check(s) {
  clean(s);
  if (s.hero.hp <= 0) {
    s.phase = "lost";
    log(s, "火光熄灭了。下一次，你会走得更远。", "bad");
    return true;
  }
  if (s.boss.hp <= 0) {
    const bill = victoryBill(s);
    if (bill) {
      bloodPayment(s, s.hero, bill);
      log(s, `战后清账：未兑现债务折付 ${bill} 生命，无视护甲。`, "bad");
      s.stats.victoryBill += bill;
    }
    s.contracts.forEach((c) => releaseBond(s, c));
    s.contracts = [];
    if (s.hero.hp <= 0) {
      s.phase = "lost";
      log(s, "首领倒下了，但你没能付清借来的明天。", "bad");
      return true;
    }
    s.stats.wins++;
    s.stats.turns += s.turn;
    if (s.stage === ENCOUNTERS.length - 1) {
      s.phase = "won";
      log(s, "永夜已尽。你守住了最后的火光。", "good");
    } else {
      s.phase = "reward";
      s.rewardOffer = shuffled(s, REWARD_POOL).slice(0, 3);
      const recovery = 6 + (s.relics.includes("chalice") ? 5 : 0);
      heal(s, s.hero, recovery);
      log(s, `战斗胜利。恢复 ${recovery} 点生命，选择你的战利品。`, "good");
    }
    return true;
  }
  return false;
}
export function rage(s) {
  const d = DIFFICULTIES[s.difficulty];
  return Math.max(0, Math.floor((s.turn - d.rageStart) / 2) + 1) * d.rageRate;
}
function omenAt(s, turn) {
  const e = ENCOUNTERS[s.stage],
    type = e.pattern[(turn - 1) % e.pattern.length],
    power = Math.max(1, e.power + DIFFICULTIES[s.difficulty].attack);
  const base =
    type === "strike"
      ? {
          type,
          label: "暗刃突袭",
          text: `对你造成 ${power} 点伤害`,
          value: power,
        }
      : type === "ward"
        ? {
            type,
            label: "黑铁庇护",
            text: `首领获得 ${power + 2} 点护甲`,
            value: power + 2,
          }
        : type === "summon"
          ? {
              type,
              label: "亡者呼唤",
              text: "召唤一名随从（战场未满时）",
              value: 1,
            }
          : type === "howl"
            ? {
                type,
                label: "血月咆哮",
                text: "所有敌方随从获得 +1 攻击",
                value: 1,
              }
            : type === "collect"
              ? {
                  type,
                  label: "催债仪式",
                  text: "所有己方债务提前 1 回合",
                  value: 0,
                }
              : type === "writ"
                ? {
                    type,
                    label: "追加罚息",
                    text: "所有己方债务加息，倒戈骑士攻击 +1",
                    value: 1,
                  }
                : {
                    type,
                    label: "蚀心诅咒",
                    text: `对你造成 ${power} 点伤害，并获得 2 点护甲`,
                    value: power,
                  };
  return {
    ...base,
    rage: rage({ ...s, turn }),
    rageStart: DIFFICULTIES[s.difficulty].rageStart,
  };
}
export function intent(s) {
  const c = s.contracts?.find((c) => c.kind === "omen" && c.due === s.turn + 1);
  if (c)
    return {
      ...c,
      type: c.effect,
      rageStart: DIFFICULTIES[s.difficulty].rageStart,
    };
  if (!s.contracts) return omenAt(s, s.turn);
  return {
    type: "silenced",
    label: "承诺已被改写",
    text: "下一回合边界没有首领技能",
    value: 0,
    rage: 0,
    rageStart: DIFFICULTIES[s.difficulty].rageStart,
  };
}
function startBattle(s) {
  const e = ENCOUNTERS[s.stage];
  s.phase = "battle";
  s.turn = 1;
  s.maxEnergy = 3 + (s.relics.includes("stone") ? 1 : 0);
  s.energy = s.maxEnergy;
  s.hero.shield = s.relics.includes("ring") ? 2 : 0;
  s.hero.burn = 0;
  s.boss = {
    uid: "boss",
    name: e.name,
    art: e.art,
    hp: Math.round(e.hp * DIFFICULTIES[s.difficulty].hp),
    maxHp: Math.round(e.hp * DIFFICULTIES[s.difficulty].hp),
    shield: 0,
    burn: 0,
  };
  s.allies = [];
  s.enemies = e.units.map((k) => makeEnemy(s, k));
  s.draw = shuffled(
    s,
    s.deck.map((c) => ({ ...c })),
  );
  s.hand = [];
  s.discard = [];
  s.exhaust = [];
  s.fatigue = 0;
  s.skillUsed = false;
  s.firstSpell = false;
  s.emberUsed = false;
  s.weaverDrawn = false;
  s.contracts = [];
  s.history = [];
  s.omenScheduledUntil = 1;
  queueOmens(s);
  s.effects = [];
  s.notice = "";
  if (s.stage === 0) {
    const opening = [
      "borrowedKnight",
      "borrowedFlame",
      "transfer",
      "defer",
      "shield",
    ];
    for (const key of opening) {
      const i = s.draw.findIndex((c) => c.key === key);
      s.hand.push(s.draw.splice(i, 1)[0]);
    }
  } else draw(s, 5);
  log(s, `踏入${e.place}。${e.name}正在等待你。`);
  s.announcement = "你的回合";
}
export function newRun(seed = Date.now(), difficulty = "normal") {
  const s = {
    version: SAVE_VERSION,
    seed: seed >>> 0,
    nextId: 1,
    difficulty: Object.hasOwn(DIFFICULTIES, difficulty) ? difficulty : "normal",
    phase: "battle",
    stage: 0,
    hero: { uid: "hero", hp: 40, maxHp: 40, shield: 0, burn: 0 },
    deck: [],
    relics: ["ember"],
    logs: [],
    effects: [],
    stats: {
      cards: 0,
      kills: 0,
      wins: 0,
      turns: 0,
      damage: 0,
      signed: 0,
      settled: 0,
      weaves: 0,
      transfers: 0,
      cancelled: 0,
      paidLife: 0,
      victoryBill: 0,
    },
    notice: "",
    revision: 0,
  };
  s.deck = STARTER.map((key) => ({ key, uid: id(s), upgraded: false }));
  startBattle(s);
  return s;
}
function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}
function getTarget(s, uid, side) {
  if (side === "enemy")
    return uid === "boss" ? s.boss : s.enemies.find((u) => u.uid === uid);
  return s.allies.find((u) => u.uid === uid);
}
export function validTargets(s, selection) {
  if (!selection || s.phase !== "battle") return [];
  if (selection.type === "card") {
    const card = s.hand.find((c) => c.uid === selection.uid);
    if (!card) return [];
    const d = cardInfo(card);
    if (d.type === "unit") return s.allies.length < 3 ? ["slot"] : [];
    if (d.target === "contract")
      return s.contracts
        .filter((c) => canEditContract(s, c, d.contractEffect))
        .map((c) => c.uid);
    if (d.target === "enemy") return ["boss", ...s.enemies.map((u) => u.uid)];
    if (d.target === "ally") return s.allies.map((u) => u.uid);
    return ["self"];
  }
  if (selection.type === "skill")
    return ["boss", ...s.enemies.map((u) => u.uid)];
  const guards = s.enemies.filter((u) => u.tags.includes("守卫"));
  return guards.length
    ? guards.map((u) => u.uid)
    : ["boss", ...s.enemies.map((u) => u.uid)];
}
function play(s, a) {
  const idx = s.hand.findIndex((c) => c.uid === a.uid);
  requireThat(idx >= 0, "这张牌已经不在手中。");
  const c = s.hand[idx],
    d = cardInfo(c);
  requireThat(s.energy >= d.cost, "能量不足。结束回合可补充能量。");
  if (d.hpCost)
    requireThat(
      s.hero.hp > d.hpCost,
      `焚毁契约需要支付 ${d.hpCost} 生命，且至少保留 1 生命。`,
    );
  let t;
  if (d.type === "unit")
    requireThat(s.allies.length < 3, "战场已满，最多容纳 3 名随从。");
  else if (d.target === "contract") {
    t = s.contracts.find((c) => c.uid === a.target);
    requireThat(
      canEditContract(s, t, d.contractEffect),
      "该契约不能这样改写：倒戈须先改写才可转嫁；延期最多两次且不能超出三回合。",
    );
  } else if (d.target === "enemy" || d.target === "ally") {
    t = getTarget(s, a.target, d.target);
    requireThat(t, "请选择一个有效目标。");
  }
  s.energy -= d.cost;
  s.hand.splice(idx, 1);
  s.stats.cards++;
  if (d.hpCost) bloodPayment(s, s.hero, d.hpCost);
  log(s, `你使用了${d.name}。`, "good");
  if (d.type === "unit") {
    const u = makeUnit(s, c);
    s.allies.push(u);
    if (d.debt) {
      const contract = signContract(s, {
        ...d.debt,
        kind: d.debt.kind,
        owner: "player",
        due: s.turn + d.debt.after,
        source: d.name,
        unitId: u.uid,
      });
      u.loanContractId = contract.uid;
    }
    fx(s, "summon", u.uid, "召唤");
    if (d.tags.includes("启示")) draw(s, 1);
  } else {
    if (d.contractEffect) manipulate(s, t, d.contractEffect);
    if (d.damage) {
      const dealt = damage(s, t, d.damage);
      s.stats.damage += dealt;
      if (c.key === "bolt" && t.hp <= 0) draw(s, 1);
    }
    if (d.burn && t && t.hp > 0) {
      t.burn += d.burn;
      fx(s, "burn", t.uid, d.burn);
    }
    if (d.armor) armor(s, d.armor);
    if (d.heal) heal(s, s.hero, d.heal);
    if (d.draw) draw(s, d.draw);
    if (d.aoe) for (const u of s.enemies) s.stats.damage += damage(s, u, d.aoe);
    if (d.buff) {
      t.atk += d.buff;
      t.maxHp += d.buff;
      t.hp = t.maxHp;
      fx(s, "heal", t.uid, "强化");
    }
    if (d.energy) s.energy += d.energy;
    if (d.debt)
      signContract(s, {
        ...d.debt,
        owner: "player",
        due: s.turn + d.debt.after,
        source: d.name,
      });
    for (const u of s.allies.filter((u) => u.tags.includes("共鸣"))) {
      u.atk++;
      fx(s, "buff", u.uid, "+1 攻击");
    }
    if (s.relics.includes("quill") && !s.firstSpell) {
      s.firstSpell = true;
      draw(s, 1);
      log(s, "渡鸦翎羽：抽 1 张牌。", "good");
    }
  }
  if (["spark", "borrowedEnergy", "foreclose"].includes(c.key))
    s.exhaust.push(c);
  else s.discard.push(c);
  check(s);
}
function attack(s, a) {
  const u = s.allies.find((u) => u.uid === a.uid);
  requireThat(u && u.ready, "该随从本回合无法攻击。");
  requireThat(
    validTargets(s, { type: "unit", uid: u.uid }).includes(a.target),
    "必须先击败具有「守卫」的敌方随从。",
  );
  const t = getTarget(s, a.target, "enemy");
  requireThat(t, "请选择敌方目标。");
  u.ready = false;
  fx(s, "attack", u.uid, "");
  const dealt = damage(s, t, u.atk);
  s.stats.damage += dealt;
  if (a.target !== "boss") damage(s, u, t.atk);
  if (u.tags.includes("汲取") && dealt > 0) heal(s, s.hero, 2);
  log(s, `${u.name}攻击${t.name}，造成 ${dealt} 点伤害。`, "good");
  check(s);
}
function skill(s, a) {
  requireThat(!s.skillUsed, "每回合只能使用一次英雄技能。");
  requireThat(s.energy >= 2, "英雄技能需要 2 点能量。");
  const t = getTarget(s, a.target, "enemy");
  requireThat(t, "请选择敌方目标。");
  s.energy -= 2;
  s.skillUsed = true;
  const n = 2 + (s.relics.includes("sun") ? 2 : 0);
  s.stats.damage += damage(s, t, n);
  log(s, `烬火之触对${t.name}造成 ${n} 点伤害。`, "good");
  check(s);
}
function burnTick(s, t) {
  if (t.burn > 0) {
    damage(s, t, t.burn);
    log(s, `${t.name || "你"}受到 ${t.burn} 点灼烧伤害。`);
    t.burn--;
  }
}
function endTurn(s) {
  s.announcement = "新的回合";
  // Damage-over-time resolves before attacks; a dying enemy never gets to attack.
  for (const u of [s.boss, ...s.enemies]) burnTick(s, u);
  if (check(s)) return;
  log(s, `—— 敌方回合 ${s.turn} ——`);
  for (const u of [...s.enemies]) {
    const guards = s.allies.filter((x) => x.tags.includes("守卫"));
    const candidates = guards.length ? guards : s.allies;
    // Guard first, otherwise take a favorable trade when available; face in other cases.
    const killable = candidates
      .filter((t) => t.hp <= u.atk)
      .sort((a, b) => b.atk - a.atk)[0];
    const target = guards[0] || killable || s.hero;
    const dealt = damage(s, target, u.atk);
    if (target.uid !== "hero") damage(s, u, target.atk);
    if (u.tags.includes("汲取") && dealt) heal(s, s.boss, 2);
    log(
      s,
      `${u.name}攻击${target.name || "你"}，造成 ${dealt} 点伤害。`,
      "bad",
    );
    if (check(s)) return;
  }
  s.turn++;
  s.maxEnergy = Math.min(8, s.maxEnergy + 1);
  s.energy = s.maxEnergy;
  const settlement = resolveDue(s);
  if (s.phase !== "battle") return;
  s.skillUsed = false;
  s.firstSpell = false;
  s.weaverDrawn = false;
  for (const u of s.allies) {
    u.ready = true;
    if (u.tags.includes("复苏")) heal(s, s.hero, 2);
  }
  if (s.relics.includes("ring")) armor(s, 2);
  draw(s, settlement.drawBudget);
  queueOmens(s);
  log(s, `—— 你的回合 ${s.turn} · 能量 ${s.energy} ——`, "good");
  check(s);
}
function postReward(s) {
  const available = Object.keys(RELICS).filter((k) => !s.relics.includes(k));
  if (available.length) {
    s.phase = "relic";
    s.relicOffer = shuffled(s, available).slice(0, 3);
  } else s.phase = "camp";
}
export function act(original, a) {
  const s = clone(original);
  s.effects = [];
  s.notice = "";
  s.announcement = "";
  s.revision++;
  try {
    if (["play", "attack", "skill", "endTurn"].includes(a.type))
      requireThat(s.phase === "battle", "当前不在战斗中。");
    if (a.type === "play") play(s, a);
    else if (a.type === "attack") attack(s, a);
    else if (a.type === "skill") skill(s, a);
    else if (a.type === "endTurn") endTurn(s);
    else if (a.type === "reward") {
      requireThat(s.phase === "reward", "当前无法领取战利品。");
      if (a.key === "heal") {
        heal(s, s.hero, 8);
        log(s, "放弃卡牌奖励，恢复 8 点生命。", "good");
      } else {
        requireThat(s.rewardOffer.includes(a.key), "请选择本次奖励中的卡牌。");
        s.deck.push({ key: a.key, uid: id(s), upgraded: false });
        log(s, `${CARDS[a.key].name}加入了卡组。`, "good");
      }
      postReward(s);
    } else if (a.type === "relic") {
      requireThat(
        s.phase === "relic" && s.relicOffer.includes(a.key),
        "请选择有效的遗物。",
      );
      s.relics.push(a.key);
      log(s, `获得遗物：${RELICS[a.key].name}。`, "good");
      s.phase = "camp";
    } else if (a.type === "camp") {
      requireThat(s.phase === "camp", "尚未抵达营火。");
      if (a.choice === "rest") {
        heal(s, s.hero, 12);
        log(s, "在营火旁休息，恢复 12 点生命。", "good");
      } else if (a.choice === "upgrade") {
        const c = s.deck.find((c) => c.uid === a.uid);
        requireThat(c && !c.upgraded, "请选择尚未升级的卡牌。");
        c.upgraded = true;
        log(s, `${CARDS[c.key].name}已升级。`, "good");
      } else if (a.choice === "remove") {
        requireThat(s.deck.length > 10, "卡组至少需要 10 张牌。");
        const i = s.deck.findIndex((c) => c.uid === a.uid);
        requireThat(i >= 0, "请选择要移除的卡牌。");
        log(s, `${CARDS[s.deck[i].key].name}离开了卡组。`);
        s.deck.splice(i, 1);
      } else requireThat(false, "请选择一项营火行动。");
      s.stage++;
      startBattle(s);
    } else requireThat(false, "未知操作。");
    return s;
  } catch (e) {
    return {
      ...original,
      notice: e.message,
      revision: original.revision + 1,
      effects: [],
    };
  }
}

export function validateSave(s) {
  try {
    const finite = (n) => typeof n === "number" && Number.isFinite(n);
    const entity = (u) =>
      !!u &&
      typeof u.uid === "string" &&
      finite(u.hp) &&
      finite(u.maxHp) &&
      u.maxHp > 0 &&
      u.hp >= 0 &&
      u.hp <= u.maxHp &&
      finite(u.burn) &&
      u.burn >= 0;
    const card = (c) =>
      c &&
      typeof c.uid === "string" &&
      Object.hasOwn(CARDS, c.key) &&
      typeof c.upgraded === "boolean";
    const unit = (u) =>
      entity(u) &&
      finite(u.atk) &&
      u.atk >= 0 &&
      Array.isArray(u.tags) &&
      typeof u.ready === "boolean";
    const contract = (c) =>
      !!c &&
      typeof c.uid === "string" &&
      ["player", "enemy"].includes(c.owner) &&
      ["blood", "draw", "energy", "betrayal", "omen"].includes(c.kind) &&
      Number.isInteger(c.due) &&
      c.due >= s.turn &&
      c.due <= s.turn + 3 &&
      finite(c.amount) &&
      c.amount >= 0 &&
      finite(c.order) &&
      finite(c.edits) &&
      c.edits >= 0 &&
      c.edits <= 2 &&
      finite(c.interest) &&
      c.interest >= 0 &&
      typeof c.source === "string" &&
      (c.kind !== "omen" ||
        ["strike", "hex", "ward", "summon", "howl", "collect", "writ"].includes(
          c.effect,
        ));
    return (
      s?.version === SAVE_VERSION &&
      Number.isInteger(s.seed) &&
      Number.isInteger(s.nextId) &&
      Object.hasOwn(DIFFICULTIES, s.difficulty) &&
      Number.isInteger(s.stage) &&
      s.stage >= 0 &&
      s.stage < 5 &&
      Number.isInteger(s.turn) &&
      s.turn >= 1 &&
      finite(s.energy) &&
      s.energy >= 0 &&
      finite(s.maxEnergy) &&
      s.maxEnergy >= 3 &&
      s.maxEnergy <= 8 &&
      ["battle", "reward", "relic", "camp", "won", "lost"].includes(s.phase) &&
      entity(s.hero) &&
      finite(s.hero.shield) &&
      s.hero.shield >= 0 &&
      entity(s.boss) &&
      typeof s.boss.name === "string" &&
      Array.isArray(s.deck) &&
      s.deck.length >= 10 &&
      s.deck.every(card) &&
      ["hand", "draw", "discard", "exhaust"].every(
        (k) => Array.isArray(s[k]) && s[k].every(card),
      ) &&
      s.hand.length <= 8 &&
      Array.isArray(s.allies) &&
      s.allies.length <= 3 &&
      s.allies.every((u) => unit(u) && Object.hasOwn(CARDS, u.key)) &&
      Array.isArray(s.enemies) &&
      s.enemies.length <= 3 &&
      s.enemies.every(
        (u) =>
          unit(u) &&
          (Object.hasOwn(ENEMIES, u.key) || Object.hasOwn(CARDS, u.key)),
      ) &&
      Array.isArray(s.logs) &&
      s.logs.every((l) => typeof l.text === "string") &&
      Array.isArray(s.relics) &&
      s.relics.every((k) => Object.hasOwn(RELICS, k)) &&
      !!s.stats &&
      [
        "cards",
        "kills",
        "wins",
        "turns",
        "damage",
        "signed",
        "settled",
        "weaves",
        "transfers",
        "cancelled",
        "paidLife",
        "victoryBill",
      ].every((k) => finite(s.stats[k]) && s.stats[k] >= 0) &&
      finite(s.revision) &&
      finite(s.fatigue) &&
      Array.isArray(s.contracts) &&
      s.contracts.length < 64 &&
      s.contracts.every(contract) &&
      Array.isArray(s.history) &&
      Number.isInteger(s.omenScheduledUntil) &&
      s.omenScheduledUntil >= s.turn &&
      typeof s.weaverDrawn === "boolean" &&
      (s.phase !== "reward" ||
        (Array.isArray(s.rewardOffer) &&
          s.rewardOffer.every((k) => Object.hasOwn(CARDS, k)))) &&
      (s.phase !== "relic" ||
        (Array.isArray(s.relicOffer) &&
          s.relicOffer.every((k) => Object.hasOwn(RELICS, k))))
    );
  } catch {
    return false;
  }
}
