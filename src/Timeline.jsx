import React from "react";
import {
  Clock3,
  ArrowRight,
  Flame,
  Shield,
  Zap,
  BookOpen,
  ScrollText,
  Skull,
  Swords,
} from "lucide-react";
import {
  timeline,
  contractLabel,
  contractText,
  victoryBill,
} from "./contracts.js";

export default function Timeline({
  state,
  targets,
  onContract,
  onHistory,
  busy,
}) {
  const bill = victoryBill(state);
  const symbol = (c) =>
    c.kind === "blood"
      ? Flame
      : c.kind === "energy"
        ? Zap
        : c.kind === "draw"
          ? BookOpen
          : c.kind === "betrayal"
            ? Skull
            : c.effect === "ward"
              ? Shield
              : Swords;
  return (
    <section className="future-ledger" aria-label="未来三回合契约时间线">
      <div className="ledger-heading">
        <span>
          <Clock3 size={13} />
          命运账簿<small>未来 3 回合</small>
        </span>
        <button
          onClick={onHistory}
          title={`未兑现债务在战后折付 ${bill} 生命，无视护甲。`}
        >
          {bill > 0 ? (
            <>
              <Flame size={11} />
              <b>战后清账 {bill}</b>
            </>
          ) : (
            <>
              <ScrollText size={11} />
              清账规则
            </>
          )}
        </button>
      </div>
      <div className="timeline-track">
        {timeline(state).map((column) => (
          <div className="timeline-column" key={column.turn}>
            <div className="timeline-date">
              <span>
                {column.offset === 1 ? "下回合" : `${column.offset} 回合后`}
              </span>
              <small>R{String(column.turn).padStart(2, "0")}</small>
              {column.contracts.length > 1 && (
                <b
                  className="contract-count"
                  title={`本回合共有 ${column.contracts.length} 份契约，列表可上下滚动`}
                >
                  {column.contracts.length}份
                </b>
              )}
              <ArrowRight size={9} />
            </div>
            <div className="contract-list">
              {column.contracts.map((c) => {
                const Icon = symbol(c);
                return (
                  <button
                    key={c.uid}
                    disabled={busy}
                    className={`contract-entry ${c.owner} ${c.kind} ${targets.includes(c.uid) ? "targetable" : ""}`}
                    data-contract-id={c.uid}
                    data-combat-id={c.uid}
                    data-contract-kind={c.kind}
                    data-owner={c.owner}
                    data-due={c.due}
                    data-amount={c.amount}
                    data-order={c.order}
                    data-interest={c.interest}
                    data-edits={c.edits}
                    data-unit-id={c.unitId}
                    data-effect={c.effect}
                    data-value={c.value}
                    data-rage={c.rage}
                    data-source={c.source}
                    onClick={() => onContract(c)}
                    aria-label={`第 ${c.due} 回合，${c.source}，${contractLabel(c)}，${contractText(c)}`}
                    title={`${c.source} · 第 ${c.due} 回合\n${contractText(c)}\n点击查看或选择为改写目标`}
                  >
                    <Icon size={11} />
                    <span>{contractLabel(c)}</span>
                    {c.edits > 0 && (
                      <i title={`已延期 ${c.edits} 次`}>{c.edits}</i>
                    )}
                  </button>
                );
              })}
              {!column.contracts.length && (
                <span className="empty-future">这一刻，由你书写</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
