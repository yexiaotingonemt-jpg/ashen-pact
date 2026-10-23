// Shared, renderer-independent rules for the public three-turn ledger.
export function debtValue(contract) {
  if (contract.kind === "energy" || contract.kind === "draw")
    return contract.amount * 3;
  if (contract.kind === "betrayal") return 7 + (contract.interest || 0) * 2;
  return contract.amount || 0;
}

export function contractLabel(c) {
  if (c.kind === "omen") return c.label;
  if (c.kind === "blood")
    return `${c.owner === "enemy" ? "首领付" : "付"} ${c.amount} 生命`;
  if (c.kind === "energy") return `归还 ${c.amount} 能量`;
  if (c.kind === "draw") return `少抽 ${c.amount} 张牌`;
  if (c.kind === "betrayal") return "借来的骑士倒戈";
  return c.source;
}

export function contractText(c) {
  if (c.kind === "omen")
    return c.text + (c.rage ? `；另造成 ${c.rage} 点狂怒伤害` : "");
  if (c.kind === "blood")
    return `${c.owner === "enemy" ? "首领" : "你"}失去 ${c.amount} 点生命，无视护甲。`;
  if (c.kind === "energy")
    return `扣除 ${c.amount} 点本回合能量；不足的每点能量改付 3 生命。`;
  if (c.kind === "draw")
    return `少抽 ${c.amount} 张回合抽牌；不足的每张牌改付 3 生命。`;
  if (c.kind === "betrayal")
    return `绑定随从倒戈，归敌方控制${c.interest ? `并获得 +${c.interest} 攻击` : ""}。敌方战场已满时，随从被收回且首领获得 4 护甲。随从阵亡则条款解除。`;
  return "";
}

export function canEditContract(state, c, effect) {
  if (!c || c.due <= state.turn) return false;
  if (effect === "transfer")
    return c.owner === "player" && c.kind !== "betrayal";
  if (effect === "rewrite") return c.owner === "player";
  if (effect === "defer") return (c.edits || 0) < 2 && c.due < state.turn + 3;
  if (effect === "foreclose") return c.owner === "enemy" && c.kind === "blood";
  if (effect === "sever") return true;
  return false;
}

export function victoryBill(state) {
  return (state.contracts || [])
    .filter((c) => c.owner === "player")
    .reduce((sum, c) => sum + debtValue(c), 0);
}

export function timeline(state) {
  return [1, 2, 3].map((offset) => ({
    turn: state.turn + offset,
    offset,
    contracts: (state.contracts || [])
      .filter((c) => c.due === state.turn + offset)
      .sort((a, b) => a.order - b.order),
  }));
}

export function debtCaption(debt) {
  if (!debt) return "";
  const effect =
    debt.kind === "blood"
      ? `付 ${debt.amount} 生命`
      : debt.kind === "energy"
        ? `还 ${debt.amount} 能量`
        : debt.kind === "draw"
          ? `少抽 ${debt.amount} 张`
          : "随从倒戈";
  return `${debt.after} 回合后 · ${effect}`;
}
