import { cardInfo } from "./data.js";

export const ATTACK_BEATS = { windup: 210, travel: 160, impact: 230 };
export const SPELL_BEATS = { windup: 260, travel: 0, impact: 220 };
export const ABILITY_BEAT = 380;

export function damageTargets(effects) {
  return [
    ...new Set(
      effects
        .filter(
          (e) => e.type === "hit" && typeof e.value === "number" && e.value > 0,
        )
        .map((e) => e.target),
    ),
  ];
}

export function playerFrames(before, action, after, triggers = []) {
  if (after.notice || before.phase !== "battle") return [];
  const played = before.hand.find((c) => c.uid === action.uid);
  const definition = played && cardInfo(played);
  const arriving =
    action.type === "play" &&
    after.allies.find((u) => !before.allies.some((old) => old.uid === u.uid));
  const source = before.allies.find((u) => u.uid === action.uid);
  const target = [
    before.boss,
    before.hero,
    ...before.enemies,
    ...before.allies,
  ].find((u) => u.uid === action.target);
  const contract = before.contracts.find((c) => c.uid === action.target);
  let cue;
  if (arriving)
    cue = {
      type: "summon",
      sourceId: arriving.uid,
      sourceName: arriving.name,
      targetId: arriving.uid,
      targetName: arriving.name,
    };
  else if (action.type === "attack" && source && target)
    cue = {
      type: "attack",
      sourceId: source.uid,
      sourceName: source.name,
      targetId: target.uid,
      targetName: target.name,
    };
  else if (
    (action.type === "play" && definition?.type === "spell") ||
    action.type === "skill"
  ) {
    cue = {
      type: "spell",
      sourceId: played?.uid || "skill",
      sourceName: definition?.name || "烬火之触",
      sourceCard: played,
      targetId: target?.uid || contract?.uid || "hero",
      targetName:
        target?.name || (contract ? `${contract.source}的契约` : "你"),
      localEffect: definition?.contractEffect
        ? "contract"
        : definition?.armor || definition?.armorStrike
          ? "armor"
          : definition?.heal
            ? "heal"
            : definition?.draw
              ? "draw"
              : definition?.energy
                ? "energy"
                : "flame",
      label: `${definition?.name || "烬火之触"} · 施放`,
      targetIds: definition?.aoe ? before.enemies.map((u) => u.uid) : undefined,
    };
  }
  return cue
    ? [
        {
          before,
          after,
          effects: after.effects,
          triggers,
          cue: { ...cue, side: "player", hitIds: damageTargets(after.effects) },
        },
      ]
    : [];
}
