import React, { useLayoutEffect, useState } from "react";

export function combatClass(cue, uid) {
  if (!cue) return "";
  const names = [];
  if (cue.type === "attack" && cue.sourceId === uid)
    names.push("combat-attacker", `combat-${cue.phase}`);
  if (cue.targetId === uid)
    names.push(
      cue.type === "summon" ? "combat-arriving" : "combat-target",
      `combat-${cue.phase}`,
    );
  return names.join(" ");
}

export function impactView(frame) {
  const view = { ...frame.after, effects: frame.effects };
  // Hold the struck unit in its slot for the impact beat, including lethal hits.
  if (frame.cue.type === "attack") {
    for (const side of ["allies", "enemies"])
      view[side] = frame.before[side]
        .map(
          (u) =>
            frame.after[side].find((next) => next.uid === u.uid) || {
              ...u,
              hp: 0,
              fallen: true,
            },
        )
        .concat(
          frame.after[side].filter(
            (u) => !frame.before[side].some((old) => old.uid === u.uid),
          ),
        );
  }
  return view;
}

export function actionCaption(cue) {
  if (!cue) return "敌方正在行动";
  if (cue.type === "attack")
    return `${cue.sourceName} → ${cue.targetId === "hero" ? "你（英雄）" : `你的${cue.targetName}`}`;
  if (cue.type === "summon")
    return `${cue.contractKind === "betrayal" ? "契约倒戈" : "敌方召唤"} · ${cue.targetName}`;
  return cue.label || `${cue.sourceName} · ${cue.targetName || "契约兑现"}`;
}

export default function CombatPlayback({ cue, onGeometry }) {
  const [line, setLine] = useState(null);
  useLayoutEffect(() => {
    if (!cue) {
      setLine(null);
      onGeometry(null);
      return;
    }
    function measure() {
      const nodes = [...document.querySelectorAll(".game [data-combat-id]")];
      const source = nodes.find((e) => e.dataset.combatId === cue.sourceId);
      const target = nodes.find((e) => e.dataset.combatId === cue.targetId);
      if (!source || !target || source === target) {
        setLine(null);
        onGeometry(null);
        return;
      }
      const a = source.getBoundingClientRect(),
        b = target.getBoundingClientRect();
      const x1 = a.x + a.width / 2,
        y1 = a.y + a.height / 2;
      const x2 = b.x + b.width / 2,
        y2 = b.y + b.height / 2;
      const distance = Math.hypot(x2 - x1, y2 - y1) || 1;
      setLine({ x1, y1, x2, y2 });
      onGeometry({
        x: ((x2 - x1) / distance) * 24,
        y: ((y2 - y1) / distance) * 24,
      });
    }
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [cue?.id, cue?.phase, onGeometry]);
  if (!cue || !line || cue.type !== "attack") return null;
  return (
    <svg className={`combat-arrow combat-${cue.phase}`} aria-hidden="true">
      <defs>
        <marker
          id="combat-arrow-tip"
          markerWidth="7"
          markerHeight="7"
          refX="5"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L6,3 L0,6 Z" fill="#ffe2b0" />
        </marker>
      </defs>
      <line {...line} markerEnd="url(#combat-arrow-tip)" />
      <circle cx={line.x2} cy={line.y2} r="17" />
    </svg>
  );
}
