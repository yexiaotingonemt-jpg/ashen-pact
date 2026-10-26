import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BookOpen, Clock3, Flame, Heart, Shield, Zap } from "lucide-react";
import { ATTACK_BEATS, ABILITY_BEAT } from "./playback.js";

export function combatClass(cue, uid) {
  if (!cue) return "";
  const names = [];
  if (cue.type === "attack" && cue.sourceId === uid)
    names.push("combat-attacker", `combat-${cue.phase}`);
  if (
    cue.sourceId === uid &&
    (cue.type === "spell" ||
      (cue.type === "contract" && cue.contractKind === "omen"))
  )
    names.push("combat-caster", `combat-${cue.phase}`);
  if (cue.targetId === uid || cue.targetIds?.includes(uid))
    names.push(
      cue.type === "summon" ? "combat-arriving" : "combat-target",
      `combat-${cue.phase}`,
    );
  return names.join(" ");
}

export function abilityClass(cue, uid) {
  if (!cue) return "";
  return [
    cue.sourceId === uid && "ability-source",
    cue.targetId === uid &&
      `ability-target ${cue.effectType === "fatigue" ? "ability-negative" : ""}`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function abilityCaption(cue) {
  return `${cue.sourceName} · ${cue.ability}：${cue.label}`;
}

export function impactView(frame) {
  const view = { ...frame.after, effects: frame.effects };
  // Keep every lethal combat target in its slot until its impact is visible.
  if (["attack", "spell", "burn"].includes(frame.cue.type)) {
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
  if (frame.cue.type === "spell" && frame.cue.sourceCard) {
    // Reserve the cast card's slot until the visual releases it. Saved state
    // already contains the real hand; this placeholder never becomes playable.
    view.hand = frame.before.hand.concat(
      frame.after.hand.filter(
        (c) => !frame.before.hand.some((old) => old.uid === c.uid),
      ),
    );
  }
  return view;
}

export function actionCaption(cue) {
  if (!cue) return "正在结算";
  if (cue.type === "attack")
    return `${cue.sourceName} → ${cue.side === "player" ? (cue.targetId === "boss" ? `首领${cue.targetName}` : cue.targetName) : cue.targetId === "hero" ? "你（英雄）" : `你的${cue.targetName}`}`;
  if (cue.type === "summon")
    return `${cue.side === "player" ? "我方召唤" : cue.contractKind === "betrayal" ? "契约倒戈" : "敌方召唤"} · ${cue.targetName}`;
  return cue.label || `${cue.sourceName} · ${cue.targetName || "契约兑现"}`;
}

function combatNode(uid) {
  return [...document.querySelectorAll(".game [data-combat-id]")].find(
    (e) => e.dataset.combatId === uid && e.getClientRects().length,
  );
}
const icons = {
  contract: Clock3,
  armor: Shield,
  heal: Heart,
  draw: BookOpen,
  energy: Zap,
  flame: Flame,
};

export default function CombatPlayback({
  cue,
  effects = [],
  onGeometry,
  cardPreview,
}) {
  const [geometry, setGeometry] = useState(null);
  const [numbers, setNumbers] = useState([]);
  const remembered = useRef(null),
    numberTimers = useRef(new Set()),
    seen = useRef({ token: null, ids: new Set() });

  useEffect(
    () => () => {
      for (const timer of numberTimers.current) clearTimeout(timer);
    },
    [],
  );

  useLayoutEffect(() => {
    if (!cue) {
      setGeometry(null);
      onGeometry(null);
      return;
    }
    function measure() {
      const source = combatNode(cue.sourceId),
        target = combatNode(cue.targetId);
      if (
        source &&
        (cue.type !== "spell" || remembered.current?.id !== cue.id)
      ) {
        const r = source.getBoundingClientRect();
        remembered.current = {
          id: cue.id,
          source: { x: r.x, y: r.y, width: r.width, height: r.height },
        };
      }
      const a =
        remembered.current?.id === cue.id ? remembered.current.source : null;
      const b = target?.getBoundingClientRect();
      const line =
        a && b && source !== target
          ? {
              x1: a.x + a.width / 2,
              y1: a.y + a.height / 2,
              x2: b.x + b.width / 2,
              y2:
                b.y +
                b.height *
                  (target.classList.contains("unit-card") ? 0.35 : 0.5),
            }
          : null;
      const sourceBox = a && {
        ...a,
        x: Math.max(
          8 + a.width * 0.07,
          Math.min(a.x, innerWidth - a.width * 1.07 - 8),
        ),
        y: Math.max(
          8 + a.height * 0.07,
          Math.min(a.y, innerHeight - a.height * 1.07 - 8),
        ),
      };
      setGeometry({ line, source: sourceBox });
      if (line) {
        const d = Math.hypot(line.x2 - line.x1, line.y2 - line.y1) || 1;
        onGeometry({
          x: ((line.x2 - line.x1) / d) * 24,
          y: ((line.y2 - line.y1) / d) * 24,
        });
      } else onGeometry(null);
    }
    if (cue.type === "ability") {
      const incoming = combatNode(cue.drawnIds?.[0]);
      if (incoming?.closest(".hand")) {
        const hand = incoming.closest(".hand"),
          a = incoming.getBoundingClientRect(),
          b = hand.getBoundingClientRect();
        if (a.left < b.left + 8) hand.scrollLeft += a.left - b.left - 8;
        else if (a.right > b.right - 8)
          hand.scrollLeft += a.right - b.right + 8;
      }
    }
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, {
      capture: true,
      passive: true,
    });
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [cue?.id, cue?.phase, onGeometry]);

  useEffect(() => {
    if (!cue || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const node = combatNode(cue.sourceId);
    if (
      !node ||
      cue.sourceCard ||
      !["attack", "ability", "spell", "contract"].includes(cue.type) ||
      (cue.type === "contract" && cue.contractKind !== "omen")
    )
      return;
    let keys, duration;
    if (cue.type === "attack" && cue.phase === "windup") {
      keys = [
        { scale: "1", rotate: "0deg", offset: 0 },
        { scale: "1.14", rotate: "0deg", offset: 0.5 },
        { scale: "1.14", rotate: "-2.4deg", offset: 0.65 },
        { scale: "1.14", rotate: "2.4deg", offset: 0.8 },
        { scale: "1.14", rotate: "0deg", offset: 1 },
      ];
      duration = ATTACK_BEATS.windup;
    } else if (cue.type === "attack" && cue.phase === "impact") {
      keys = [{ scale: "1.14" }, { scale: "1" }];
      duration = 160;
    } else if (cue.type === "ability") {
      keys = [
        { scale: "1" },
        { scale: "1.12", offset: 0.35 },
        { scale: "1.12", offset: 0.65 },
        { scale: "1" },
      ];
      duration = ABILITY_BEAT;
    } else if (["spell", "contract"].includes(cue.type)) {
      keys =
        cue.phase === "windup"
          ? [{ scale: "1" }, { scale: "1.1" }]
          : [{ scale: "1.1" }, { scale: "1" }];
      duration =
        cue.phase === "windup" ? (cue.type === "spell" ? 260 : 100) : 200;
    }
    if (!keys) return;
    const animation = node.animate(keys, {
      duration,
      easing: "ease-out",
      fill: "forwards",
    });
    return () => animation.cancel();
  }, [cue?.id, cue?.phase]);

  useLayoutEffect(() => {
    if (cue && cue.phase !== "impact") return;
    const token = cue ? String(cue.id).split("-")[0] : seen.current.token;
    if (seen.current.token !== token) seen.current = { token, ids: new Set() };
    const groups = new Map();
    for (const effect of effects) {
      if (
        !["hit", "ward"].includes(effect.type) ||
        seen.current.ids.has(effect.id)
      )
        continue;
      seen.current.ids.add(effect.id);
      const node = combatNode(effect.target);
      if (!node) continue;
      const group = groups.get(effect.target) || {
        value: 0,
        label: "",
        ids: [],
        node,
      };
      if (typeof effect.value === "number") group.value += effect.value;
      else group.label = effect.type === "ward" ? "圣盾" : effect.value;
      group.ids.push(effect.id);
      groups.set(effect.target, group);
    }
    const incoming = [...groups.values()].map((g) => {
      const r = g.node.getBoundingClientRect();
      return {
        id: `${token}-${g.ids.join("-")}`,
        x: r.x + r.width / 2,
        y: r.y + r.height * 0.28,
        text: g.value > 0 ? `−${g.value}` : g.label,
        blocked: g.value === 0,
      };
    });
    if (!incoming.length) return;
    setNumbers((old) => [...old, ...incoming]);
    const timer = setTimeout(() => {
      setNumbers((old) =>
        old.filter((n) => !incoming.some((i) => i.id === n.id)),
      );
      numberTimers.current.delete(timer);
    }, 680);
    numberTimers.current.add(timer);
  }, [cue?.id, cue?.phase, effects]);

  const line = geometry?.line,
    box = geometry?.source,
    CastIcon = icons[cue?.localEffect] || Flame;
  return (
    <>
      {cue && line && ["attack", "ability"].includes(cue.type) && (
        <svg
          className={`combat-arrow combat-${cue.phase} ${cue.type === "ability" ? "ability-link" : "attack-link"}`}
          aria-hidden="true"
        >
          <defs>
            <radialGradient id="combat-bolt-glow">
              <stop offset="0" stopColor="#fffbe1" />
              <stop offset=".3" stopColor="#ffd391" />
              <stop offset="1" stopColor="#f9753500" />
            </radialGradient>
          </defs>
          <line {...line} />
          <circle className="combat-aim" cx={line.x2} cy={line.y2} r="14" />
          {cue.type === "attack" && cue.phase === "travel" && (
            <g
              key={cue.id}
              className="combat-bolt"
              style={{
                "--from-x": `${line.x1}px`,
                "--from-y": `${line.y1}px`,
                "--to-x": `${line.x2}px`,
                "--to-y": `${line.y2}px`,
                "--flight": `${ATTACK_BEATS.travel}ms`,
              }}
            >
              <circle r="19" fill="url(#combat-bolt-glow)" />
              <circle r="4" fill="#fff7cd" />
            </g>
          )}
          {cue.type === "attack" && cue.phase === "impact" && (
            <circle
              key={cue.id}
              className="combat-impact-ring"
              cx={line.x2}
              cy={line.y2}
              r="9"
            />
          )}
        </svg>
      )}
      {cue?.type === "spell" && box && cardPreview && (
        <div
          key={cue.id}
          className={`combat-focus-card cast-${cue.phase} cast-${cue.localEffect}`}
          aria-hidden="true"
          style={{
            left: box.x,
            top: box.y,
            width: box.width,
            height: box.height,
          }}
        >
          {cardPreview}
          <span className="cast-sigil">
            <i />
            <CastIcon size={34} />
            <i />
          </span>
        </div>
      )}
      {numbers.map((n) => (
        <span
          key={n.id}
          className={`combat-damage-number ${n.blocked ? "blocked" : ""}`}
          aria-hidden="true"
          style={{ left: n.x, top: n.y }}
        >
          {n.text}
        </span>
      ))}
    </>
  );
}
