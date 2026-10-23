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

export function omenText(c) {
  if (c.effect === "collect")
    return "所有己方债务提前 1 回合；若无己方债务，对你造成 2 点伤害";
  if (c.effect === "writ")
    return "所有己方债务加息，倒戈骑士攻击 +1；若无己方债务，首领获得 3 护甲";
  return c.text;
}

export function contractText(c) {
  if (c.kind === "omen")
    return omenText(c) + (c.rage ? `；另造成 ${c.rage} 点狂怒伤害` : "");
  if (c.kind === "blood")
    return `${c.owner === "enemy" ? "首领" : "你"}失去 ${c.amount} 点生命，无视护甲。`;
  if (c.kind === "energy")
    return `扣除 ${c.amount} 点本回合能量；不足的每点能量改付 3 生命。`;
  if (c.kind === "draw")
    return `少抽 ${c.amount} 张回合抽牌；不足的每张牌改付 3 生命。`;
  if (c.kind === "betrayal")
    return `绑定随从倒戈，归敌方控制${c.interest ? `并获得 +${c.interest} 攻击` : ""}。敌方战场已满时，随从被收回且首领获得 4 护甲。随从阵亡则改为原到期支付 ${3 + (c.interest || 0) * 2} 生命（基础 3，每层已有倒戈利息 +2），仍可改写或转嫁。`;
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

function paymentSummary(debts) {
  const totals = {};
  for (const c of debts)
    totals[c.kind] =
      (totals[c.kind] || 0) + (c.kind === "betrayal" ? 1 : c.amount);
  const parts = [
    totals.blood && `${totals.blood} 生命`,
    totals.energy && `${totals.energy} 能量`,
    totals.draw && `少抽 ${totals.draw} 张`,
    totals.betrayal && `${totals.betrayal} 名随从倒戈`,
  ].filter(Boolean);
  return parts.join(" · ");
}

export function upcomingPayment(state) {
  const debts = (state.contracts || []).filter((c) => c.owner === "player");
  if (!debts.length) return "";
  const due = Math.min(...debts.map((c) => c.due));
  return `${due === state.turn + 1 ? "下回合" : `${due - state.turn} 回合后`}账面到期：${paymentSummary(debts.filter((c) => c.due === due))}`;
}

export function collectWarning(state) {
  const boundary = state.turn + 1;
  const pending = (state.contracts || []).map((c) => ({ ...c }));
  if (
    !pending.some(
      (c) => c.kind === "omen" && c.effect === "collect" && c.due === boundary,
    )
  )
    return "";
  const accelerated = new Set();
  const payments = [];
  // Project only public clauses at the next boundary. Combat, death, later
  // choices and resource-shortfall conversion are deliberately not predicted.
  while (true) {
    pending.sort((a, b) => a.due - b.due || a.order - b.order);
    const c = pending[0];
    if (!c || c.due > boundary) break;
    pending.shift();
    if (c.kind === "omen" && c.effect === "collect") {
      for (const debt of pending.filter((x) => x.owner === "player")) {
        const due = Math.max(boundary, debt.due - 1);
        if (due < debt.due) accelerated.add(debt);
        debt.due = due;
      }
    } else if (c.kind === "omen" && c.effect === "writ") {
      for (const debt of pending.filter((x) => x.owner === "player")) {
        if (debt.kind === "betrayal") debt.interest = (debt.interest || 0) + 1;
        else debt.amount++;
      }
    } else if (c.owner === "player" && accelerated.has(c)) {
      payments.push(c);
    }
  }
  const parts = payments.length
    ? [`下回合提前兑现 ${paymentSummary(payments)}`]
    : [];
  const later = pending.filter((c) => accelerated.has(c));
  for (const due of [...new Set(later.map((c) => c.due))].sort(
    (a, b) => a - b,
  )) {
    parts.push(
      `${parts.length ? "另将" : "下回合将"} ${paymentSummary(later.filter((c) => c.due === due))}提前至第 ${due} 回合`,
    );
  }
  return parts.length ? `催债预警：${parts.join("；")}（按当前条款）` : "";
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
