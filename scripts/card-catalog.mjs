import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CARDS,
  cardInfo,
  STARTER,
  ARCHETYPES,
  REWARD_POOL,
} from "../src/data.js";

const names = (keys) => keys.map((key) => CARDS[key].name).join("、");
const cell = (value) =>
  String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
const stats = (card) =>
  `${card.cost} 费${card.type === "unit" ? ` · ${card.atk}/${card.hp}` : ""}`;
const routeNames = (key, field) =>
  Object.values(ARCHETYPES)
    .filter((route) => route[field].includes(key))
    .map((route) => route.name);
function acquisition(key) {
  const parts = [];
  if (STARTER.includes(key)) parts.push("通用开局");
  const starters = routeNames(key, "keys");
  const rewards = routeNames(key, "pool");
  if (starters.length) parts.push(`路线开局：${starters.join("、")}`);
  if (rewards.length) parts.push(`定向：${rewards.join("、")}`);
  return parts.join("；") || "通用奖励";
}
function obligation(card) {
  if (!card.debt)
    return card.hpCost
      ? `即时支付 ${card.hpCost} 生命；无未来债务`
      : "无未来债务";
  const d = card.debt;
  if (d.kind === "betrayal")
    return `${d.after} 回合后倒戈；阵亡改为原到期支付 3 生命，每层已有利息再 +2`;
  if (d.kind === "blood") return `${d.after} 回合后支付 ${d.amount} 生命`;
  if (d.kind === "energy") return `${d.after} 回合后归还 ${d.amount} 能量`;
  if (d.kind === "draw") return `${d.after} 回合后少抽 ${d.amount} 张回合牌`;
  throw new Error(`Unknown debt: ${d.kind}`);
}
const groups = [
  ["预支契约", (card) => !!card.debt],
  ["契约操纵", (card) => !!card.contractEffect],
  ["其他随从", (card) => card.type === "unit" && !card.debt],
  [
    "其他法术",
    (card) => card.type === "spell" && !card.debt && !card.contractEffect,
  ],
];
const allKeys = Object.keys(CARDS);
if (
  new Set(REWARD_POOL).size !== allKeys.length ||
  allKeys.some((key) => !REWARD_POOL.includes(key))
)
  throw new Error("Reward pool must cover every card.");
const units = Object.values(CARDS).filter(
  (card) => card.type === "unit",
).length;
let doc = `# 当前卡牌与构筑总表 · v2.4

此表由 \`node scripts/card-catalog.mjs\` 从 \`src/data.js\` 的卡牌、\`cardInfo\` 升级结果、起始牌和奖励归属生成。运行 \`node scripts/card-catalog.mjs --check\` 可核对文档是否与数据一致。战斗与奖励规则另依据 \`src/engine.js\`、\`src/contracts.js\` 整理。

## 牌库与开局

- 当前 ${allKeys.length} 种卡牌：${units} 种随从、${allKeys.length - units} 种法术。全部 ${REWARD_POOL.length} 种都能出现在奖励中，不存在仅开局可得的卡牌。
- 新远征选择四条起始路线之一：${Object.values(ARCHETYPES)
  .map((route) => route.name)
  .join("、")}。
- 每套 ${STARTER.length + 4} 张起始牌，各 1 张：${STARTER.length} 张通用牌，加 4 张路线牌。通用牌为：${names(STARTER)}。
- 首战起手必有所选路线核心，其余 4 张随机，手牌顺序也随机；后续战斗起手随机抽 5 张。核心不保证在后续战斗起手出现。
- 原 v2 存档可以继续；旧远征保留原牌组，缺少路线字段时按命运书契处理。选择“新的远征”后才应用新的路线开局。

## 四条路线

| 路线 | 核心 | 4 张路线起始牌 | 定向奖励池 |
| --- | --- | --- | --- |
${Object.values(ARCHETYPES)
  .map(
    (route) =>
      `| ${route.name} | ${CARDS[route.core].name} | ${names(route.keys)} | ${names(route.pool)} |`,
  )
  .join("\n")}

路线影响开局与奖励供给，不限制出牌。跨路线卡牌可组合；同一张牌也可属于多个定向池。

## 奖励与成型节奏

- 前四场胜利各有两轮 3 选 1，第五场为最终战，不再发卡牌奖励。
- 第一轮保证 2 张来自当前路线定向池，另 1 张来自当前路线池之外。
- 第二轮提供 1 张当前路线牌、1 张其他路线牌、1 张当前路线池之外的牌；第三张也可能属于其他路线。
- 同一轮不出现重复选项，同场两轮优先避开已经展示过的牌。奖励允许选择已有同名牌，没有“每种只能一张”的限制；稀有度不另加抽取权重。
- 每轮也可放弃卡牌，恢复 4 生命。两轮最多增加 2 张，整场远征最多增加 8 张；新的 12 张开局若全部选牌且不移除，最终为 20 张。
- 第二轮结束后再领取遗物、进入营火。营火仍在休息、升级和移除中选择一项，牌组至少保留 10 张。

## 触发上限与关键规则

| 机制 | 实际规则与边界 |
| --- | --- |
| 引燃 | 每名在场余焰司灯人，每回合首次对存活敌人施加灼烧时，额外 +1 层。追加层数不会再次触发引燃。 |
| 灼烧与引爆 | 灼烧在敌方行动开始前按当前层数造成普通伤害，再减 1 层；单次 3 层依次为 3、2、1。引爆先移除所有层数，再按卡牌公式造成一次普通伤害，不能反复利用同一批层数。 |
| 锻甲 | 每名在场誓炉铸甲师，每回合首次获得正数护甲时，自身攻击 +2，成长仅在本场战斗内保留。盾击消耗护甲，不算获得护甲。 |
| 碎甲反击 | 基础最多消耗 9 护甲，造成 2 + 消耗量伤害；升级最多消耗 12，造成 3 + 消耗量。零护甲也能使用，只造成基础伤害。 |
| 返照 | 每名在场返照医者，每回合前两次正数的英雄治疗尝试，各对首领造成 2 点普通伤害；包括部分或全部溢出治疗。治疗量不影响单次伤害，不会递归治疗。阵亡随从不触发。 |
| 溢出成盾 | 仅写有此效果的余温成盾会把本次溢出治疗转换为等量护甲；其他治疗牌不会自动转甲。可进一步触发尚未触发的锻甲。 |
| 书契与见证 | 织者每回合有效操纵契约的抽牌机会最多一次，每名当时在场织者抽 1 张。见证者对每份实际结算的契约各提供 1 护甲，包括敌方承诺、敌方血债及提前清算。 |
| 升级 | 随从统一 +1 攻击、+2 生命，被动触发数值不变。提前清算的追加金额从 +2 提升至 +5；其余升级以各卡实表为准。 |
| 手牌与随从位 | 手牌上限 8，溢出的抽牌进入弃牌堆；每方最多 3 名随从。跨路线核心会竞争随从位。 |
| 伤害与治疗 | 上述灼烧、引爆、盾击、返照均可被护甲或圣盾抵挡。血债直接失去生命，无视护甲。治疗不能让已经死亡的英雄复活，战后奖励治疗不触发战斗被动。 |

## 全部卡牌

费用与身材均为无遗物加成、未发生战斗成长时的值；身材是“攻击/生命”。“未来代价”与升级版相同，升级不会取消预支债务。所有卡牌均可进入通用奖励；末列进一步注明通用开局、路线开局及定向供给。
`;
const covered = [];
for (const [name, matches] of groups) {
  const entries = Object.entries(CARDS).filter(([, card]) => matches(card));
  doc += `\n### ${name} · ${entries.length} 种\n\n| 卡牌 | 基础费用 / 身材 | 基础效果 | 升级费用 / 身材 | 升级效果 | 实际代价 | 开局与定向归属 |\n| --- | --- | --- | --- | --- | --- | --- |\n`;
  for (const [key, card] of entries) {
    const upgraded = cardInfo({ key, upgraded: true });
    doc += `| ${[card.name, stats(card), card.text, stats(upgraded), upgraded.text, obligation(card), acquisition(key)].map(cell).join(" | ")} |\n`;
    covered.push(key);
  }
}
if (
  covered.length !== allKeys.length ||
  new Set(covered).size !== allKeys.length
)
  throw new Error("Catalog groups must cover every card exactly once.");
doc += `
## 契约代价补充

- 预支契约的“几回合后”以施放回合为起点；延期会加息，催债也可能使日期提前。
- 能量债、抽牌债不足的部分，每点或每张折付 3 生命。抽牌债只扣回合抽牌预算，不禁止法术抽牌。
- 改写、转嫁按每点能量/每张抽牌折 3 生命；血债改付能量向上取整。倒戈改写值为 7 生命，每层已有倒戈利息再 +2。倒戈不能直接转嫁。
- 战胜首领时，未到期己方债务仍须折付生命，先清账再回血；护甲不能代付。付不清则失败。
- 借来的骑士阵亡后留下基础 3 点血债，沿用原到期日；已有倒戈利息每层再 +2。骑士存活且到期时，仍会倒戈。
- “消耗”只指本场不再洗回，下场重新进入战斗牌组；“余烬重生”没有复活随从效果，“不灭火凰”也没有死亡重生能力。

旧版本资料保留为 [v2.3 卡牌与流派缺口](card-catalog-2026-10-24.md)，不代表当前牌库。
`;
const path = fileURLToPath(
  new URL("../design/card-catalog.md", import.meta.url),
);
if (process.argv.includes("--check")) {
  if (readFileSync(path, "utf8").replaceAll("\r\n", "\n") !== doc)
    throw new Error(
      "Card catalog is stale. Run node scripts/card-catalog.mjs.",
    );
  console.log(
    `Card catalog verified: ${covered.length}/${allKeys.length}, ${units} units, ${allKeys.length - units} spells.`,
  );
} else {
  writeFileSync(path, doc, "utf8");
  console.log(
    `Card catalog generated: ${covered.length}/${allKeys.length} cards.`,
  );
}
