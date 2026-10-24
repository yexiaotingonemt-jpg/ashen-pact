import React, { useEffect, useRef, useState } from "react";
import {
  Sun,
  Flame,
  Heart,
  Shield,
  Swords,
  Sword,
  Sparkles,
  BookOpen,
  Volume2,
  VolumeX,
  CircleHelp,
  X,
  ChevronRight,
  ChevronLeft,
  ScrollText,
  Feather,
  Gem,
  Flag,
  Circle,
  Trophy,
  Skull,
  Tent,
  Plus,
  ArrowUp,
  Trash2,
  Hand,
  RotateCcw,
  Crown,
  Trees,
  Church,
  Castle,
  Map,
  Eye,
  Zap,
  Check,
  Coffee,
  Maximize,
  Minimize,
  Clock3,
  TriangleAlert,
  ArrowLeftRight,
  FilePenLine,
} from "lucide-react";
import { CARDS, cardInfo, ENCOUNTERS, RELICS, DIFFICULTIES } from "./data.js";
import {
  actionFeedback,
  newRun,
  intent,
  validTargets,
  validateSave,
  enemyTurnPlayback,
} from "./engine.js";
import { sound } from "./audio.js";
import Timeline from "./Timeline.jsx";
import CombatPlayback, {
  combatClass,
  impactView,
  actionCaption,
  abilityClass,
  abilityCaption,
} from "./CombatPlayback.jsx";
import {
  contractLabel,
  contractText,
  debtCaption,
  debtValue,
  victoryBill,
  canEditContract,
  upcomingPayment,
  collectWarning,
} from "./contracts.js";

const SAVE_KEY = "ashen-pact-future-save-v2";
const SETTINGS_KEY = "ashen-pact-settings-v1";
const relicIcons = {
  flame: Flame,
  chalice: Coffee,
  feather: Feather,
  ring: Circle,
  sun: Sun,
  gem: Gem,
  flag: Flag,
};
const routeIcons = [Castle, Trees, Church, Swords, Crown];
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (validateSave(s))
      return { ...s, effects: [], notice: "", announcement: "" };
  } catch {}
  return newRun();
}
function settings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || { audio: false };
  } catch {
    return { audio: false };
  }
}
function Art({ index = 0, className = "", ...props }) {
  return (
    <div
      role="img"
      aria-label={props.label || "幻想卡牌插画"}
      className={"art " + className}
      style={{
        backgroundPosition: `${((index % 4) * 100) / 3}% ${Math.floor(index / 4) * 50}%`,
      }}
    />
  );
}
function Sigil({ small = false }) {
  return (
    <span className={"sigil " + (small ? "small" : "")}>
      <Sun strokeWidth={1} />
      <span />
    </span>
  );
}
function Health({ hp, maxHp, compact = false }) {
  return (
    <div className={"health " + (compact ? "compact" : "")}>
      <Heart size={compact ? 13 : 17} fill="currentColor" />
      <div className="health-track">
        <div style={{ width: `${Math.max(0, (hp / maxHp) * 100)}%` }} />
        <span>
          {hp}
          <i> / </i>
          {maxHp}
        </span>
      </div>
    </div>
  );
}
function Stat({ type, children }) {
  const I = type === "atk" ? Sword : type === "shield" ? Shield : Heart;
  return (
    <span className={"stat " + type}>
      <I size={14} fill={type === "hp" ? "currentColor" : "none"} />
      <b>{children}</b>
    </span>
  );
}
function Card({
  card,
  onClick,
  selected = false,
  disabled = false,
  locked = false,
  revealed = false,
  mini = false,
  detail = false,
  index = 0,
}) {
  const d = cardInfo(card);
  const Element = onClick ? "button" : "article";
  return (
    <Element
      className={`play-card ${d.type} ${d.debt ? "has-debt" : ""} ${d.contractEffect ? "editor-card" : ""} ${selected ? "selected" : ""} ${disabled ? "unaffordable" : ""} ${mini ? "mini" : ""} ${detail ? "detail" : ""} ${card.upgraded ? "upgraded" : ""} ${revealed ? "ability-drawn" : ""}`}
      style={{ "--fan": `${index}deg`, "--dip": `${Math.abs(index) * 2}px` }}
      onClick={onClick}
      aria-label={`${onClick ? "选择" : "查看"} ${d.name}，${d.cost} 能量`}
      data-card-key={card.key}
      data-instance-id={card.uid}
      data-combat-id={card.uid}
      aria-pressed={onClick ? selected : undefined}
      aria-disabled={disabled || locked || undefined}
      title={`${d.name} · ${d.rarity}\n${d.text}${d.debt ? "\n" + debtCaption(d.debt) : ""}\n${d.flavor}`}
    >
      <div className="card-frame">
        <Art index={d.art} className="card-art" />
        <div className="card-shade" />
        <div className="card-cost">
          <span>{d.cost}</span>
        </div>
        <div className="card-name">{d.name}</div>
        <div className="card-copy">
          <div className="card-type">
            <span />
            {d.debt
              ? "预 支"
              : d.contractEffect
                ? "改 写"
                : d.type === "unit"
                  ? "随 从"
                  : "法 术"}
            <span />
          </div>
          <p>{d.text}</p>
          {d.debt && (
            <div className="card-debt">
              <Clock3 size={10} />
              {debtCaption(d.debt)}
            </div>
          )}
          {detail && !d.debt && d.text.length <= 24 && <em>{d.flavor}</em>}
        </div>
        {d.type === "unit" && (
          <div className="card-stats">
            <Stat type="atk">{d.atk}</Stat>
            <Stat type="hp">{d.hp}</Stat>
          </div>
        )}
        <span className={"rarity " + d.rarity} />
        <i className="corner tl" />
        <i className="corner tr" />
        <i className="corner bl" />
        <i className="corner br" />
      </div>
    </Element>
  );
}
function Unit({
  unit,
  enemy = false,
  onClick,
  selected,
  valid,
  effects,
  loanDue,
  combatCue,
  combatGeometry,
  abilityCue,
}) {
  return (
    <button
      className={`unit-card ${enemy ? "enemy" : "friendly"} ${unit.ready && !enemy && !unit.fallen ? "ready" : ""} ${selected ? "selected" : ""} ${valid ? "targetable" : ""} ${unit.ward ? "warded" : ""} ${effects.some((e) => e.type === "attack" && e.target === unit.uid) ? "just-attacked" : ""} ${combatClass(combatCue, unit.uid)} ${unit.fallen ? "combat-fallen" : ""} ${abilityClass(abilityCue, unit.uid)}`}
      style={
        combatCue?.sourceId === unit.uid && combatGeometry
          ? {
              "--strike-x": `${combatGeometry.x}px`,
              "--strike-y": `${combatGeometry.y}px`,
            }
          : undefined
      }
      onClick={onClick}
      data-unit-key={unit.key}
      data-target-id={unit.uid}
      data-combat-id={unit.uid}
      data-ability={
        abilityCue?.sourceId === unit.uid ? abilityCue.ability : undefined
      }
      title={`${unit.name}：${CARDS[unit.key]?.text || unit.tags.join(" · ") || "暗影中的敌人。"}${unit.burn ? ` 灼烧 ${unit.burn} 层。` : ""}`}
      aria-label={`${unit.name}，${unit.atk} 攻击，${unit.hp} 生命${unit.fallen ? "，阵亡" : unit.ready && !enemy ? "，可以攻击" : ""}`}
    >
      <Art index={unit.art} />
      <span className="unit-shadow" />
      {abilityCue?.sourceId === unit.uid ? (
        <span key={abilityCue.id} className="ability-unit-label">
          {abilityCue.ability} · 触发
        </span>
      ) : (
        combatCue?.targetId === unit.uid && (
          <span className="combat-unit-label">
            {combatCue.type === "summon"
              ? "召唤入场"
              : combatCue.type === "attack"
                ? "攻击目标"
                : combatCue.type === "burn"
                  ? "灼烧"
                  : "契约兑现"}
          </span>
        )
      )}
      <span className="unit-name">{unit.name}</span>
      <div className="unit-tags">
        {loanDue != null && (
          <span className="loan-badge">
            <Clock3 size={10} />
            {loanDue}回合后倒戈
          </span>
        )}
        {unit.tags.includes("守卫") && (
          <span title="守卫：必须优先攻击">
            <Shield size={11} />
            守卫
          </span>
        )}
        {unit.burn > 0 && (
          <span className="burn">
            <Flame size={11} />
            {unit.burn}
          </span>
        )}
        {unit.ward && (
          <span title="圣盾：抵消下次伤害">
            <Sun size={11} />
          </span>
        )}
      </div>
      <div className="unit-stats">
        <Stat type="atk">{unit.atk}</Stat>
        <Stat type="hp">{unit.hp}</Stat>
      </div>
      {!enemy && (
        <span className="unit-state">
          {unit.fallen ? "阵亡" : unit.ready ? "可攻击" : "休整中"}
        </span>
      )}
      <Effects effects={effects} target={unit.uid} />
    </button>
  );
}
function Effects({ effects, target }) {
  const grouped = [];
  for (const e of effects.filter(
    (e) => e.target === target && e.type !== "attack",
  )) {
    const same = grouped.find(
      (x) =>
        x.type === e.type &&
        typeof x.value === "number" &&
        typeof e.value === "number",
    );
    if (same) same.value += e.value;
    else grouped.push({ ...e });
  }
  return (
    <>
      {grouped.map((e, i) => (
        <span
          key={e.id}
          aria-hidden="true"
          style={{ marginLeft: (i - (grouped.length - 1) / 2) * 24 }}
          className={"combat-float " + e.type}
        >
          {e.type === "hit" && typeof e.value === "number"
            ? "-"
            : e.type === "heal" || e.type === "armor"
              ? "+"
              : ""}
          {e.value}
        </span>
      ))}
    </>
  );
}
function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
  className = "",
}) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const el = ref.current;
    el?.focus();
    function trap(e) {
      if (e.key === "Escape" && onClose) onClose();
      if (e.key === "Tab") {
        const nodes = el.querySelectorAll(
          'button:not([disabled]),[href],input,select,[tabindex="0"]',
        );
        if (!nodes.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first || document.activeElement === el)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    el.addEventListener("keydown", trap);
    return () => {
      el.removeEventListener("keydown", trap);
      previous?.focus?.();
    };
  }, []);
  return (
    <div
      className={"modal-backdrop " + className}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <section
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={"modal " + (wide ? "wide" : "")}
      >
        <div className="modal-top">
          <Sigil small />
          {onClose && (
            <button
              className="icon-btn close"
              aria-label="关闭"
              onClick={onClose}
            >
              <X />
            </button>
          )}
        </div>
        <h2>{title}</h2>
        {subtitle && <p className="modal-subtitle">{subtitle}</p>}
        {children}
      </section>
    </div>
  );
}

export default function App() {
  const [savedState, setS] = useState(load),
    [playbackState, setPlaybackState] = useState(null),
    [combatCue, setCombatCue] = useState(null),
    [abilityCue, setAbilityCue] = useState(null),
    [playbackSide, setPlaybackSide] = useState("enemy"),
    [combatGeometry, setCombatGeometry] = useState(null),
    [prefs, setPrefs] = useState(settings),
    [selection, setSelection] = useState(null),
    [modal, setModal] = useState(() => {
      try {
        return localStorage.getItem("ashen-pact-future-intro") ? null : "intro";
      } catch {
        return "intro";
      }
    }),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [announcement, setAnnouncement] = useState(""),
    [campChoice, setCampChoice] = useState(null),
    [difficulty, setDifficulty] = useState(savedState.difficulty),
    [full, setFull] = useState(false);
  const s = playbackState || savedState;
  const [inspectedContract, setInspectedContract] = useState(null);
  const timer = useRef(null),
    announceTimer = useRef(null),
    noticeTimer = useRef(null),
    stateRef = useRef(savedState),
    playbackToken = useRef(0),
    busyRef = useRef(false);
  stateRef.current = savedState;
  const planned = intent(s),
    targets = validTargets(s, selection),
    selectedCard =
      selection?.type === "card"
        ? s.hand.find((c) => c.uid === selection.uid)
        : null,
    selectedInfo = selectedCard ? cardInfo(selectedCard) : null;
  const [storageWarning, setStorageWarning] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({
          ...savedState,
          effects: [],
          notice: "",
          announcement: "",
        }),
      );
      setStorageWarning(false);
    } catch {
      setStorageWarning(true);
    }
  }, [savedState]);
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(prefs));
    } catch {}
  }, [prefs]);
  useEffect(() => {
    if (busy) return;
    if (s.notice) toast(s.notice);
    if (s.announcement) {
      setAnnouncement(s.announcement);
      clearTimeout(announceTimer.current);
      announceTimer.current = setTimeout(() => setAnnouncement(""), 1450);
    }
  }, [s.revision, busy]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      playbackToken.current++;
      clearTimeout(announceTimer.current);
      clearTimeout(noticeTimer.current);
    },
    [],
  );
  useEffect(() => {
    function key(e) {
      if (
        modal ||
        s.phase !== "battle" ||
        busy ||
        e.target.closest("input,textarea,select")
      )
        return;
      if (e.key === "Escape") {
        setSelection(null);
        return;
      }
      if (e.code === "Space" && !e.target.closest("button")) {
        e.preventDefault();
        finishTurn();
      }
      if (/^[1-8]$/.test(e.key)) {
        const c = s.hand[Number(e.key) - 1];
        if (c) chooseCard(c);
      }
      if (e.key.toLowerCase() === "e") chooseSkill();
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  useEffect(() => {
    function f() {
      setFull(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", f);
    return () => document.removeEventListener("fullscreenchange", f);
  }, []);
  function toast(text) {
    setNotice(text);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 3000);
  }
  function dispatch(a) {
    if (busyRef.current || busy) return;
    const original = stateRef.current;
    const { state: next, triggers } = actionFeedback(original, a);
    const frames = [];
    if (!next.notice && original.phase === "battle") {
      const arriving =
        a.type === "play" &&
        next.allies.find(
          (u) => !original.allies.some((old) => old.uid === u.uid),
        );
      const source = original.allies.find((u) => u.uid === a.uid);
      const target =
        a.target === "boss"
          ? original.boss
          : original.enemies.find((u) => u.uid === a.target);
      if (arriving || (a.type === "attack" && source && target))
        frames.push({
          before: original,
          after: next,
          effects: next.effects,
          triggers,
          cue: {
            type: arriving ? "summon" : "attack",
            side: "player",
            sourceId: arriving?.uid || source.uid,
            sourceName: arriving?.name || source.name,
            targetId: arriving?.uid || target.uid,
            targetName: arriving?.name || target.name,
          },
        });
    }
    if (!next.notice && (frames.length || triggers.length))
      beginPlayback(
        { state: next, frames, tailTriggers: frames.length ? [] : triggers },
        "player",
        original,
      );
    else {
      stateRef.current = next;
      setS(next);
    }
    if (!next.notice) {
      setSelection(null);
      if (!frames.length && !triggers.length)
        sound(
          next.phase === "reward" || next.phase === "won"
            ? "win"
            : a.type === "attack" || a.type === "skill"
              ? "hit"
              : a.type === "endTurn"
                ? "turn"
                : "card",
          prefs.audio,
        );
    }
    return next;
  }
  function chooseCard(c) {
    if (busy || s.phase !== "battle" || modal) return;
    const d = cardInfo(c);
    if (d.cost > s.energy) {
      toast("能量不足。结束回合后，能量上限 +1 并补满。");
      return;
    }
    if (selection?.uid === c.uid) {
      setSelection(null);
      return;
    }
    if (
      d.target === "contract" &&
      !validTargets(s, { type: "card", uid: c.uid }).length
    ) {
      toast(
        d.contractEffect === "transfer"
          ? "没有可转嫁的债务。倒戈条款需先用「改写条款」变成血债。"
          : d.contractEffect === "foreclose"
            ? "首领还没有血债。先使用「债务转嫁」。"
            : "目前没有符合条件的契约。延期最多两次，且不能超出未来三回合。",
      );
      return;
    }
    if (d.type === "unit" && s.allies.length >= 3) {
      toast("你的战场已满，最多容纳 3 名随从。");
      return;
    }
    if (d.target === "self") {
      dispatch({ type: "play", uid: c.uid });
      return;
    }
    if (d.target === "ally" && !s.allies.length) {
      toast("请先召唤一个友方随从。");
      return;
    }
    setSelection({ type: "card", uid: c.uid });
    sound("card", prefs.audio);
  }
  function chooseSkill() {
    if (busy || modal || s.phase !== "battle") return;
    if (s.skillUsed) {
      toast("烬火之触每回合只能使用一次。");
      return;
    }
    if (s.energy < 2) {
      toast("烬火之触需要 2 点能量。");
      return;
    }
    setSelection(selection?.type === "skill" ? null : { type: "skill" });
  }
  function targetEnemy(uid) {
    if (busy) return;
    if (!selection) {
      toast("先选择一个可攻击的随从，或一张法术牌。");
      return;
    }
    if (!targets.includes(uid)) {
      toast("先击败具有「守卫」的敌方随从。");
      return;
    }
    dispatch({
      type:
        selection.type === "unit"
          ? "attack"
          : selection.type === "skill"
            ? "skill"
            : "play",
      uid: selection.uid,
      target: uid,
    });
  }
  function targetContract(c) {
    if (busy) return;
    if (selectedInfo?.target === "contract") {
      if (!targets.includes(c.uid)) {
        toast("这份契约不符合当前卡牌的条件。可点击其他亮起的契约。");
        return;
      }
      dispatch({ type: "play", uid: selection.uid, target: c.uid });
    } else {
      setInspectedContract(c.uid);
      setModal("contract");
    }
  }
  function dismissIntro() {
    try {
      localStorage.setItem("ashen-pact-future-intro", "seen");
    } catch {}
    setModal(null);
  }
  function targetAlly(u) {
    if (busy) return;
    if (selection?.type === "card" && selectedInfo?.target === "ally") {
      dispatch({ type: "play", uid: selection.uid, target: u.uid });
      return;
    }
    if (!u.ready) {
      toast("该随从正在休整，下个回合可以攻击。");
      return;
    }
    setSelection(
      selection?.uid === u.uid ? null : { type: "unit", uid: u.uid },
    );
  }
  function summon() {
    if (selection?.type === "card" && selectedInfo?.type === "unit")
      dispatch({ type: "play", uid: selection.uid });
    else toast("先从手牌中选择一名随从，再点击空位召唤。");
  }
  function finishTurn() {
    if (busyRef.current || modal || stateRef.current.phase !== "battle") return;
    const original = stateRef.current;
    beginPlayback(enemyTurnPlayback(original), "enemy", original);
  }
  function beginPlayback(
    { state: result, frames = [], tailTriggers = [] },
    side,
    original,
  ) {
    if (result.notice) {
      setS(result);
      return;
    }
    const playedEffects = new Set(
      frames.flatMap((f) => f.effects.map((e) => e.id)),
    );
    const next = {
      ...result,
      effects: result.effects.filter((e) => !playedEffects.has(e.id)),
    };
    const token = ++playbackToken.current;
    busyRef.current = true;
    // Persist the completed turn once; visual snapshots never become save data.
    stateRef.current = next;
    setS(next);
    setPlaybackState({
      ...(frames.length ? original : next),
      effects: frames.length ? [] : next.effects,
      phase: "battle",
      announcement: "",
    });
    setSelection(null);
    setBusy(true);
    setPlaybackSide(side);
    setAbilityCue(null);
    setAnnouncement("");
    clearTimeout(announceTimer.current);
    if (side === "enemy") sound("turn", prefs.audio);
    function complete() {
      if (token !== playbackToken.current) return;
      setPlaybackState(null);
      setCombatCue(null);
      setAbilityCue(null);
      busyRef.current = false;
      setBusy(false);
      if (side === "enemy" || ["lost", "reward", "won"].includes(next.phase))
        sound(
          next.phase === "lost"
            ? "hit"
            : ["reward", "won"].includes(next.phase)
              ? "win"
              : "turn",
          prefs.audio,
        );
    }
    function showTriggers(triggers, after, index = 0, prefix = "tail") {
      if (token !== playbackToken.current) return;
      const trigger = triggers[index];
      if (!trigger) {
        setAbilityCue(null);
        after();
        return;
      }
      setAbilityCue({ ...trigger, id: `${token}-${prefix}-${index}` });
      sound(
        trigger.effectType === "heal" && trigger.value > 0 ? "heal" : "card",
        prefs.audio,
      );
      timer.current = setTimeout(
        () => showTriggers(triggers, after, index + 1, prefix),
        380,
      );
    }
    function showFrame(index) {
      if (token !== playbackToken.current) return;
      const frame = frames[index];
      if (!frame) {
        setCombatCue(null);
        setPlaybackState({ ...next, phase: "battle", announcement: "" });
        showTriggers(tailTriggers, complete);
        return;
      }
      setAbilityCue(null);
      const cue = { ...frame.cue, id: `${token}-${index}`, phase: "windup" };
      const lead =
        cue.type === "attack" ? (side === "player" ? 140 : 180) : 100;
      const hold =
        cue.type === "summon"
          ? side === "player"
            ? 320
            : 560
          : cue.type === "attack"
            ? side === "player"
              ? 240
              : 320
            : 280;
      const defensive =
        side === "enemy" && cue.type === "attack"
          ? (frame.triggers || []).filter((t) =>
              ["守卫", "圣盾"].includes(t.ability),
            )
          : [];
      const following = (frame.triggers || []).filter(
        (t) => !defensive.includes(t),
      );
      setPlaybackState({
        ...frame.before,
        effects: [],
        announcement: "",
        phase: "battle",
      });
      setCombatCue(cue);
      timer.current = setTimeout(() => {
        if (token !== playbackToken.current) return;
        setPlaybackState({
          ...impactView(frame),
          announcement: "",
          phase: "battle",
        });
        setCombatCue({ ...cue, phase: "impact" });
        if (defensive.length)
          setAbilityCue({
            ...defensive[0],
            id: `${token}-defence-${index}`,
            ability: defensive.map((t) => t.ability).join(" · "),
            label: defensive.map((t) => t.label).join("；"),
            defensive: true,
          });
        sound(
          frame.effects.some((e) => e.type === "hit") ? "hit" : "card",
          prefs.audio,
        );
        timer.current = setTimeout(() => {
          if (following.length) {
            setCombatCue(null);
            setPlaybackState((view) => ({ ...view, effects: [] }));
          }
          showTriggers(
            following,
            () => showFrame(index + 1),
            0,
            `frame-${index}`,
          );
        }, hold);
      }, lead);
    }
    timer.current = setTimeout(() => showFrame(0), side === "enemy" ? 150 : 30);
  }
  function restart() {
    clearTimeout(timer.current);
    playbackToken.current++;
    busyRef.current = false;
    setPlaybackState(null);
    setCombatCue(null);
    setAbilityCue(null);
    setBusy(false);
    setS(newRun(Date.now(), difficulty));
    setSelection(null);
    setModal(null);
    setCampChoice(null);
    toast("新的契约已经缔结。");
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      toast("当前窗口不支持全屏。可使用浏览器缩放调整显示。");
    }
  }
  const paymentReminder = upcomingPayment(s);
  const collectionWarning = collectWarning(s);
  const activeLink =
    combatCue?.type === "attack"
      ? combatCue
      : abilityCue
        ? {
            ...abilityCue,
            targetId:
              abilityCue.drawnIds?.[0] ||
              (abilityCue.effectType === "discard"
                ? "discard"
                : abilityCue.targetId),
            type: "ability",
            phase: "impact",
          }
        : combatCue;
  const showingAbility = abilityCue && !abilityCue.defensive;
  const selectionHint =
    selection?.type === "unit"
      ? "选择敌方随从或首领，发动攻击"
      : selection?.type === "skill"
        ? "烬火之触 · 选择敌方目标"
        : selectedInfo?.target === "contract"
          ? "点击命运账簿中亮起的契约，改写未来"
          : selectedInfo?.type === "unit"
            ? "点击下方空位，召唤随从"
            : selectedInfo?.target === "ally"
              ? "选择一名友方随从，缔结共生契约"
              : selectedInfo
                ? "选择敌方目标，释放法术"
                : "";

  return (
    <main className={"game future-mode " + (busy ? "resolving" : "")}>
      <div className="world" />
      <div className="world-vignette" />
      <div className="embers" aria-hidden="true">
        {Array.from({ length: 14 }, (_, i) => (
          <i key={i} style={{ "--i": i }} />
        ))}
      </div>
      <header className="topbar">
        <button
          className="brand"
          onClick={() => setModal("journey")}
          aria-label="灰烬契约，查看远征"
        >
          <Sigil />
          <span>
            <strong>灰烬契约</strong>
            <small>BORROW TOMORROW</small>
          </span>
        </button>
        <nav className="journey" aria-label="远征进度">
          {ENCOUNTERS.map((e, i) => {
            const Icon = routeIcons[i];
            return (
              <React.Fragment key={e.name}>
                {i > 0 && (
                  <span
                    className={"route-line " + (i <= s.stage ? "passed" : "")}
                  />
                )}
                <button
                  className={`route-node ${i === s.stage ? "current" : ""} ${i < s.stage ? "passed" : ""}`}
                  aria-label={`第 ${i + 1} 战，${e.place}${i === s.stage ? "，当前战斗" : i < s.stage ? "，已完成" : ""}`}
                  onClick={() => setModal("journey")}
                >
                  <span>{i < s.stage ? <Check /> : <Icon />}</span>
                  <small>1-{i + 1}</small>
                </button>
              </React.Fragment>
            );
          })}
        </nav>
        <div className="top-actions">
          <button
            className="icon-btn"
            title={prefs.audio ? "关闭音效" : "开启音效"}
            aria-label={prefs.audio ? "关闭音效" : "开启音效"}
            onClick={() => {
              setPrefs({ ...prefs, audio: !prefs.audio });
              sound("card", !prefs.audio);
            }}
          >
            {prefs.audio ? <Volume2 /> : <VolumeX />}
          </button>
          <button
            className="icon-btn fullscreen"
            title="全屏"
            aria-label="切换全屏"
            onClick={fullscreen}
          >
            {full ? <Minimize /> : <Maximize />}
          </button>
          <button
            className="icon-btn"
            aria-label="玩法说明"
            title="玩法说明"
            onClick={() => setModal("help")}
          >
            <CircleHelp />
          </button>
          <button
            className="deck-button"
            aria-label={`查看牌组，${s.deck.length} 张`}
            onClick={() => setModal("deck")}
          >
            <BookOpen />
            <span>牌组</span>
            <small>{s.deck.length}</small>
          </button>
        </div>
      </header>

      <aside className="hero-panel ornamental">
        <div className="hero-portrait">
          <Art index={0} label="烬火行者" />
          <span className="portrait-fade" />
          <div className="hero-caption">
            <small>最后的持火者</small>
            <h1>烬火行者</h1>
          </div>
          <i className="corner tl" />
          <i className="corner tr" />
        </div>
        <div
          className={
            "hero-vitals " +
            combatClass(combatCue, "hero") +
            " " +
            abilityClass(abilityCue, "hero")
          }
          data-combat-id="hero"
        >
          {abilityCue?.targetId === "hero" && !abilityCue.defensive && (
            <span className="ability-result-label">
              {abilityCue.effectType === "heal"
                ? `治疗 +${abilityCue.value}`
                : abilityCue.effectType === "armor"
                  ? `护甲 +${abilityCue.value}`
                  : abilityCue.effectType === "fatigue"
                    ? `疲劳 -${abilityCue.value}`
                    : abilityCue.ability}
            </span>
          )}
          {combatCue?.targetId === "hero" && (
            <span className="combat-hero-label">
              {combatCue.type === "attack" ? "攻击目标 · 你" : "契约目标 · 你"}
            </span>
          )}
          <Health hp={s.hero.hp} maxHp={s.hero.maxHp} />
          <div className="hero-armor">
            <Shield size={17} />
            <b>{s.hero.shield}</b>
            <span>护甲</span>
          </div>
          <Effects effects={s.effects} target="hero" />
        </div>
        <div className="energy-block">
          <div
            className="energy-orb"
            aria-label={`能量 ${s.energy} / ${s.maxEnergy}`}
          >
            <span className="orb-ring" />
            <span className="orb-spark one" />
            <span className="orb-spark two" />
            <strong>
              {s.energy}
              <i>/</i>
              {s.maxEnergy}
            </strong>
          </div>
          <small>可用能量</small>
        </div>
        <div className="relics">
          <div className="rail-label">
            <span />
            远征遗物
            <span />
          </div>
          <div className="relic-row">
            {s.relics.map((k) => {
              const I = relicIcons[RELICS[k].icon];
              return (
                <button
                  key={k}
                  className="relic"
                  aria-label={RELICS[k].name}
                  title={RELICS[k].name + "：" + RELICS[k].text}
                  onClick={() => setModal("relics")}
                >
                  <I strokeWidth={1.3} />
                </button>
              );
            })}
            {s.relics.length < 3 &&
              Array.from({ length: 3 - s.relics.length }, (_, i) => (
                <span key={i} className="relic empty">
                  <Plus size={15} />
                </span>
              ))}
          </div>
        </div>
        <button className="log-button" onClick={() => setModal("log")}>
          <ScrollText size={17} />
          战斗记录
          <ChevronRight size={16} />
        </button>
        <button className="journey-link" onClick={() => setModal("new")}>
          <RotateCcw size={12} />
          新的远征<span>{DIFFICULTIES[s.difficulty].name}</span>
        </button>
      </aside>

      <section className="battlefield" aria-label="战场">
        <div className="enemy-header">
          <button
            className={`boss-name ornamental ${targets.includes("boss") ? "targetable" : ""} ${combatClass(combatCue, "boss")}`}
            data-combat-id="boss"
            onClick={() => targetEnemy("boss")}
            aria-label={`攻击首领 ${s.boss.name}，${s.boss.hp} 生命`}
          >
            <div>
              <span className="boss-diamond" />
              <h2>{s.boss.name}</h2>
              <span className="boss-diamond" />
            </div>
            <Health hp={s.boss.hp} maxHp={s.boss.maxHp} compact />
            {(s.boss.shield > 0 || s.boss.burn > 0) && (
              <span className="boss-status">
                {s.boss.shield > 0 && (
                  <span>
                    <Shield size={12} />
                    {s.boss.shield}
                  </span>
                )}
                {s.boss.burn > 0 && (
                  <span>
                    <Flame size={12} />
                    {s.boss.burn}
                  </span>
                )}
              </span>
            )}
            <Effects effects={s.effects} target="boss" />
          </button>
          <div className="intent" title={planned.text}>
            <div className={"intent-gem " + planned.type}>
              {planned.type === "strike" || planned.type === "hex" ? (
                <Sword />
              ) : planned.type === "ward" ? (
                <Shield />
              ) : planned.type === "summon" ? (
                <Skull />
              ) : (
                <Swords />
              )}
            </div>
            <div>
              <small>下回合发动</small>
              <strong>{planned.label}</strong>
              <span>{planned.text}</span>
            </div>
          </div>
        </div>
        <div className="unit-row enemy-row">
          {s.enemies.map((u) => (
            <Unit
              key={u.uid}
              unit={u}
              enemy
              onClick={() => targetEnemy(u.uid)}
              valid={targets.includes(u.uid)}
              effects={s.effects}
              combatCue={combatCue}
              combatGeometry={combatGeometry}
              abilityCue={abilityCue}
            />
          ))}
          {s.enemies.length === 0 && (
            <p className="cleared-line">敌方阵线已破 · 攻击首领</p>
          )}
        </div>
        <Timeline
          state={s}
          targets={targets}
          onContract={targetContract}
          onHistory={() => setModal("ledger")}
          busy={busy}
        />
        <div className="unit-row ally-row">
          {s.allies.map((u) => (
            <Unit
              key={u.uid}
              unit={u}
              onClick={() => targetAlly(u)}
              selected={selection?.uid === u.uid}
              valid={targets.includes(u.uid)}
              effects={s.effects}
              combatCue={combatCue}
              combatGeometry={combatGeometry}
              abilityCue={abilityCue}
              loanDue={
                u.loanContractId
                  ? s.contracts.find((c) => c.uid === u.loanContractId)?.due -
                    s.turn
                  : null
              }
            />
          ))}
          {Array.from({ length: 3 - s.allies.length }, (_, i) => (
            <button
              className={
                "summon-slot " + (targets.includes("slot") ? "targetable" : "")
              }
              key={"slot" + i}
              aria-label={`召唤空位 ${i + 1}`}
              onClick={summon}
            >
              <Sigil small />
              <span>召唤随从</span>
              <small>{targets.includes("slot") ? "点击放置" : "空置"}</small>
            </button>
          ))}
        </div>
        <div
          className={
            "selection-hint " +
            (selection
              ? "active"
              : collectionWarning
                ? "has-collection-warning"
                : "") +
            (abilityCue ? " has-ability-feedback" : "")
          }
        >
          {abilityCue ? (
            <span
              className={
                "combat-caption ability-caption " +
                (["fatigue", "discard"].includes(abilityCue.effectType)
                  ? "ability-warning"
                  : "")
              }
              role="status"
              data-ability-action={abilityCue.ability}
              key={abilityCue.id}
            >
              <Art
                index={abilityCue.sourceArt}
                className="ability-portrait"
                label={abilityCue.sourceName}
              />
              <span>
                {abilityCue.defensive
                  ? `${actionCaption(combatCue)} · ${abilityCue.ability}：${abilityCue.label}`
                  : abilityCaption(abilityCue)}
              </span>
            </span>
          ) : busy ? (
            <span
              className="combat-caption"
              role="status"
              data-combat-action={combatCue?.type || "start"}
            >
              <Swords size={13} /> {actionCaption(combatCue)}
            </span>
          ) : selection ? (
            <>
              <Hand size={15} />
              {selectionHint}
              <button onClick={() => setSelection(null)}>
                取消 <kbd>Esc</kbd>
              </button>
            </>
          ) : paymentReminder ? (
            <button
              className={
                "payment-reminder " +
                (collectionWarning ? "collection-warning" : "")
              }
              aria-label={collectionWarning || paymentReminder}
              title={`${paymentReminder}。账簿保留原日期；预警按当前公开条款计算，不预测随从阵亡等后续变化。点击查看账簿。`}
              onClick={() => setModal("ledger")}
            >
              {collectionWarning ? (
                <TriangleAlert size={12} />
              ) : (
                <Clock3 size={12} />
              )}
              <span role="status">{collectionWarning || paymentReminder}</span>
            </button>
          ) : (
            <span>预支力量，改写代价。点击账簿查看契约。</span>
          )}
        </div>
      </section>

      <aside className="turn-panel">
        <div className="turn-banner">
          <Sigil small />
          <span>
            回合 <strong>{String(s.turn).padStart(2, "0")}</strong>
          </span>
          <i />
          <h2>
            {busy
              ? showingAbility || playbackSide === "player"
                ? "效果结算"
                : "敌方回合"
              : "你的回合"}
          </h2>
          <em className={"rage-warning " + (planned.rage ? "active" : "")}>
            {planned.rage
              ? `狂怒侵蚀 +${planned.rage}`
              : `第 ${planned.rageStart} 回合起狂怒`}
          </em>
        </div>
        <div className="turn-actions">
          <button
            className={`hero-skill ${selection?.type === "skill" ? "selected" : ""} ${s.skillUsed ? "used" : ""}`}
            onClick={chooseSkill}
            aria-label="烬火之触，2 能量"
          >
            <span className="skill-icon">
              <Flame />
            </span>
            <span>
              <strong>烬火之触</strong>
              <small>
                {s.skillUsed
                  ? "本回合已使用"
                  : `造成 ${s.relics.includes("sun") ? 4 : 2} 点伤害`}
              </small>
            </span>
            <b>2</b>
          </button>
          <button
            className="end-turn gold-button"
            onClick={finishTurn}
            disabled={busy || s.phase !== "battle"}
          >
            <span>
              {busy
                ? showingAbility || playbackSide === "player"
                  ? "效果结算中"
                  : "敌方行动中"
                : "结束回合"}
            </span>
            <ChevronRight size={19} />
          </button>
          <small className="turn-note">剩余手牌保留 · 下回合抽 2 张</small>
        </div>
      </aside>

      <section className="hand-area" aria-label="手牌">
        <button
          className="pile draw-pile"
          onClick={() => setModal("draw")}
          aria-label={`查看抽牌堆，${s.draw.length} 张`}
        >
          <div className="card-back">
            <Sigil />
            <span>ASHEN PACT</span>
          </div>
          <strong>抽牌堆</strong>
          <b>{s.draw.length}</b>
        </button>
        <div
          className={`hand hand-${s.hand.length} ${abilityClass(abilityCue, "hand")}`}
          data-combat-id="hand"
        >
          {s.hand.map((c, i) => (
            <Card
              key={c.uid}
              card={c}
              onClick={() => chooseCard(c)}
              selected={selection?.uid === c.uid}
              disabled={
                cardInfo(c).cost > s.energy ||
                (busy && playbackSide === "enemy" && !showingAbility)
              }
              locked={busy}
              revealed={abilityCue?.drawnIds?.includes(c.uid)}
              index={(i - (s.hand.length - 1) / 2) * 2.1}
            />
          ))}
          {!s.hand.length && (
            <div className="empty-hand">
              <BookOpen />
              <p>手中的火种已尽</p>
              <small>结束回合，抽取新的卡牌</small>
            </div>
          )}
        </div>
        <button
          className="pile discard-pile"
          data-combat-id="discard"
          onClick={() => setModal("discard")}
          aria-label={`查看弃牌堆，${s.discard.length} 张`}
        >
          <div className="card-back">
            <Flame strokeWidth={1} />
            <span>ASHES REMAIN</span>
          </div>
          <strong>弃牌堆</strong>
          <b>{s.discard.length}</b>
        </button>
      </section>
      <footer className="footer">
        <span className="desktop-controls">
          <Hand size={14} />
          点击卡牌，再选择目标<span>·</span>
          <kbd>1–8</kbd>选牌<span>·</span>
          <kbd>空格</kbd>结束回合
        </span>
        <span className="mobile-controls">
          点击卡牌与目标 · 左右滑动查看手牌
        </span>
        <button onClick={() => setModal("help")}>
          规则 <CircleHelp size={12} />
        </button>
        <span className="save-note">
          {storageWarning ? "存档不可用" : "进度自动保存"}
        </span>
      </footer>
      <CombatPlayback cue={activeLink} onGeometry={setCombatGeometry} />
      {notice && (
        <div className="toast" role="status">
          <Flame size={16} />
          {notice}
        </div>
      )}
      {announcement && !modal && s.phase === "battle" && (
        <div
          className={"turn-announcement " + (busy ? "enemy" : "")}
          key={announcement + s.turn}
        >
          {announcement}
          <small>{busy ? "暗影正在逼近" : "THE FLAME IS YOURS"}</small>
        </div>
      )}

      {modal === "intro" && (
        <Modal
          title="向明天，借一场胜利"
          subtitle="力量可以免费。代价，不能凭空消失。"
          wide
          className="intro-modal"
        >
          <div className="intro-steps">
            <article>
              <Clock3 />
              <span>01 / 预支</span>
              <h3>今天，你可以很强</h3>
              <p>
                0 费召唤 4/5 突袭骑士，或立刻造成 6
                伤害。对应代价会写进未来三回合的账簿。
              </p>
            </article>
            <article>
              <FilePenLine />
              <span>02 / 改写</span>
              <h3>明天，并非定局</h3>
              <p>
                延期会加息。把倒戈改成血债，再转嫁给首领；敌人的攻击承诺也能被延期或焚毁。
              </p>
            </article>
            <article>
              <Flame />
              <span>03 / 清账</span>
              <h3>赢了，也必须还债</h3>
              <p>
                未到期的己方债务会在胜利后折付生命。欠账太多，即使击败首领也会失败。
              </p>
            </article>
          </div>
          <div className="intro-combo">
            <strong>试试这条因果链</strong>
            <span>
              明日之焰 <ChevronRight size={13} /> 债务转嫁{" "}
              <ChevronRight size={13} /> 提前清算
            </span>
            <small>先打 6 伤害，再把代价变成首领立即支付的 8 生命。</small>
          </div>
          <button className="gold-button modal-cta" onClick={dismissIntro}>
            签下第一份契约
            <ChevronRight size={17} />
          </button>
          <button
            className="text-button intro-help"
            onClick={() => {
              dismissIntro();
              setModal("help");
            }}
          >
            先读战斗手册
          </button>
        </Modal>
      )}
      {modal === "contract" &&
        (() => {
          const c = s.contracts.find((x) => x.uid === inspectedContract);
          if (!c) return null;
          const editors = s.hand.filter((card) => {
            const d = cardInfo(card);
            return d.contractEffect && canEditContract(s, c, d.contractEffect);
          });
          return (
            <Modal
              title={c.source}
              subtitle={`第 ${c.due} 回合兑现 · ${c.owner === "player" ? "由你承担" : c.kind === "omen" ? "敌方承诺" : "由首领承担"}`}
              onClose={() => setModal(null)}
            >
              <div className={"contract-detail " + c.owner}>
                <Clock3 />
                <h3>{contractLabel(c)}</h3>
                <p>{contractText(c)}</p>
                <small>
                  已延期 {c.edits} / 2 次
                  {c.owner === "player"
                    ? ` · 若战斗提前结束，折付 ${debtValue(c)} 生命`
                    : ""}
                </small>
              </div>
              {c.kind === "betrayal" && (
                <p className="muted centered">
                  倒戈条款绑定随从，不能直接转嫁。先用「改写条款」改成血债，就能保住骑士。
                </p>
              )}
              <div className="contract-quick-actions">
                {editors.map((card) => {
                  const d = cardInfo(card);
                  return (
                    <button
                      key={card.uid}
                      disabled={
                        busy ||
                        s.phase !== "battle" ||
                        s.energy < d.cost ||
                        (d.hpCost && s.hero.hp <= d.hpCost)
                      }
                      onClick={() => {
                        setModal(null);
                        dispatch({
                          type: "play",
                          uid: card.uid,
                          target: c.uid,
                        });
                      }}
                    >
                      <FilePenLine size={14} />
                      {d.name}
                      <b>{d.cost} 能量</b>
                    </button>
                  );
                })}
                {!editors.length && (
                  <p className="muted centered">
                    当前手中没有能操纵这份契约的牌。每回合会抽取 2 张新牌。
                  </p>
                )}
              </div>
            </Modal>
          );
        })()}
      {modal === "ledger" && (
        <Modal
          title="命运不会抹去欠款"
          subtitle="时间线上的每一份承诺，都会按签署顺序兑现。"
          onClose={() => setModal(null)}
        >
          <div className="ledger-rules">
            <p>
              <strong>回合交界</strong>
              敌方随从先攻击。随后能量补满，结算到期契约，最后治疗与抽牌。
            </p>
            <p>
              <strong>改写汇率</strong>1 能量或 1 抽牌 = 3
              生命；血债改付能量时向上取整。血债无视护甲。
            </p>
            <p>
              <strong>违约与利息</strong>己方债务每次延期 +1
              金额；倒戈条款改为骑士攻击
              +1。每份契约最多延期两次，不能超出未来三回合。
            </p>
            <p>
              <strong>战后清账</strong>未到期血债按原数、能量/抽牌按汇率、倒戈按
              7 生命（每次加息再 +2）结清。先清账，再领取回血。付不清即失败。
            </p>
            <p>
              <strong>无款可还</strong>能量或回合抽牌不足时，差额按每点/张 3
              生命补偿。借来的骑士阵亡后，倒戈改为原到期支付 3
              生命，已有倒戈利息每层再加 2；仍可改写或转嫁。
            </p>
          </div>
          <div className="ledger-totals">
            <span>
              本场待清账<b>{victoryBill(s)} 生命</b>
            </span>
            <span>
              已操纵契约<b>{s.stats.weaves} 次</b>
            </span>
          </div>
          {s.history.length > 0 && (
            <div className="settled-ledger">
              <h3>最近兑现</h3>
              {[...s.history]
                .reverse()
                .slice(0, 6)
                .map((c) => (
                  <p key={c.uid}>
                    <small>R{c.settledAt}</small>
                    <span>{c.source}</span>
                    <b>{contractLabel(c)}</b>
                  </p>
                ))}
            </div>
          )}
        </Modal>
      )}
      {modal === "help" && (
        <Modal
          title="持火者的战斗手册"
          subtitle="先召唤，再进攻。每一簇火焰，都有它的用处。"
          wide
          onClose={() => setModal(null)}
        >
          <div className="help-grid">
            {[
              [
                Clock3,
                "向未来借力",
                "0 费预支牌会签下能量、抽牌、血债或倒戈契约。看清卡牌红色代价条，再决定出牌。账簿展示双方未来三回合真正会兑现的事件。",
              ],
              [
                FilePenLine,
                "改写兑现条件",
                "先选改写牌，再点账簿中亮起的契约；也能点契约详情直接使用手中改写牌。延期会加息。倒戈必须先改成血债才能转嫁。",
              ],
              [
                ArrowLeftRight,
                "让首领替你还债",
                "债务转嫁改变付款人，不改变到期日。提前清算让首领血债立即兑现并 +2。焚毁契约支付 4 生命，可销毁敌方技能承诺。",
              ],
              [
                Zap,
                "能量与出牌",
                "左上角数字是卡牌费用。每回合补满能量，上限 +1，最多 8。选择随从牌后点击空位；法术若需要目标，点击敌方卡牌或首领。",
              ],
              [
                Swords,
                "随从与攻击",
                "每方最多 3 名随从。友方随从在下回合就绪，点击它再选择敌人。攻击随从时双方同时造成伤害；攻击首领不会受到反击。",
              ],
              [
                Shield,
                "守卫与圣盾",
                "有「守卫」的敌方随从必须先被随从攻击。法术与英雄技能可绕过守卫。「圣盾」抵消首次伤害。护甲跨回合保留。",
              ],
              [
                Eye,
                "观察敌方意图",
                "结束回合时，敌方先受灼烧，再由随从依次攻击。随后时间推进、能量补满，按签署顺序清算到期契约；最后治疗并抽牌。首领的承诺可以延期或焚毁。司祭会催债，统领会加息。",
              ],
              [
                BookOpen,
                "抽牌与构筑",
                "起手 5 张，每回合抽 2 张。手牌保留，最多 8 张，溢出进入弃牌堆。牌库用尽时重洗弃牌；无牌可洗时受到递增疲劳伤害。",
              ],
              [
                Tent,
                "远征与成长",
                "击败首领后，先把未到期己方债务折付生命，再恢复 6 生命。付不清仍会失败。然后选卡牌与遗物，在营火休息、升级或精简卡组。五战结束后仍须完成清账。",
              ],
            ].map(([I, t, c]) => (
              <article key={t}>
                <I />
                <h3>{t}</h3>
                <p>{c}</p>
              </article>
            ))}
          </div>
          <div className="help-keywords">
            <strong>关键词</strong>
            <span>突袭：立即攻击</span>
            <span>复苏：回合开始恢复 2 生命</span>
            <span>共鸣：施法后 +1 攻击</span>
            <span>汲取：攻击后恢复 2 生命</span>
            <span>灼烧：敌方行动前受伤，随后层数 -1</span>
          </div>
          <button
            className="gold-button modal-cta"
            onClick={() => setModal(null)}
          >
            让火焰回答
            <ChevronRight size={18} />
          </button>
        </Modal>
      )}

      {["deck", "draw", "discard"].includes(modal) && (
        <Modal
          title={
            modal === "deck"
              ? "你的契约牌组"
              : modal === "draw"
                ? "抽牌堆"
                : "弃牌堆"
          }
          subtitle={
            modal === "deck"
              ? `${s.deck.length} 张卡牌 · 营火旁可以升级或移除卡牌`
              : modal === "draw"
                ? `${s.draw.length} 张 · 以下按费用排列，不代表抽牌顺序`
                : `${s.discard.length} 张 · 牌库耗尽后将重新洗入`
          }
          wide
          onClose={() => setModal(null)}
        >
          <div className="collection">
            {[
              ...(modal === "deck"
                ? s.deck
                : modal === "draw"
                  ? s.draw
                  : s.discard),
            ]
              .sort((a, b) => cardInfo(a).cost - cardInfo(b).cost)
              .map((c) => (
                <Card key={c.uid} card={c} mini detail />
              ))}
            {(modal === "draw"
              ? !s.draw.length
              : modal === "discard"
                ? !s.discard.length
                : false) && <p className="empty-message">这里暂时没有卡牌。</p>}
          </div>
          {s.exhaust.length > 0 && modal === "discard" && (
            <p className="muted">
              另有 {s.exhaust.length} 张卡已消耗，本场战斗不再洗回。
            </p>
          )}
        </Modal>
      )}
      {modal === "log" && (
        <Modal
          title="灰烬中的记述"
          subtitle="每一个选择，都留有回响。"
          onClose={() => setModal(null)}
        >
          <div className="battle-log">
            {[...s.logs].reverse().map((l) => (
              <p key={l.id} className={l.kind}>
                <span />
                <span>{l.text}</span>
              </p>
            ))}
          </div>
        </Modal>
      )}
      {modal === "relics" && (
        <Modal
          title="随行的旧物"
          subtitle="被遗忘的事物，也曾拥有光芒。"
          onClose={() => setModal(null)}
        >
          <div className="relic-list">
            {s.relics.map((k) => {
              const I = relicIcons[RELICS[k].icon];
              return (
                <article key={k}>
                  <I />
                  <div>
                    <h3>{RELICS[k].name}</h3>
                    <p>{RELICS[k].text}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </Modal>
      )}
      {modal === "journey" && (
        <Modal
          title="长夜远征"
          subtitle={`第 ${s.stage + 1} / 5 战 · ${DIFFICULTIES[s.difficulty].name}难度 · 此刻的火光，正在改变结局。`}
          wide
          onClose={() => setModal(null)}
        >
          <div className="journey-map">
            {ENCOUNTERS.map((e, i) => {
              const I = routeIcons[i];
              return (
                <article
                  key={e.name}
                  className={
                    i === s.stage ? "current" : i < s.stage ? "passed" : ""
                  }
                >
                  <div className="map-art">
                    <Art index={e.art} />
                    {i < s.stage && (
                      <span>
                        <Check />
                      </span>
                    )}
                  </div>
                  <I />
                  <small>第 {i + 1} 战</small>
                  <h3>{e.place}</h3>
                  <p>{e.name}</p>
                  <em>
                    {i < s.stage
                      ? "已征服"
                      : i === s.stage
                        ? "当前战斗"
                        : "尚未抵达"}
                  </em>
                </article>
              );
            })}
          </div>
          <p className="journey-quote">
            “你不是为了燃尽世界，而是为了替某个人，留一盏灯。”
          </p>
          <button
            className="secondary-button journey-new"
            onClick={() => setModal("new")}
          >
            <RotateCcw size={14} />
            开启另一场远征
          </button>
        </Modal>
      )}
      {modal === "new" && (
        <Modal
          title="再缔一次契约"
          subtitle="新的远征会替换当前进度。选择你将面对的长夜。"
          onClose={() => setModal(null)}
        >
          <div className="difficulty-options">
            {Object.entries(DIFFICULTIES).map(([k, d]) => (
              <button
                className={difficulty === k ? "chosen" : ""}
                key={k}
                onClick={() => setDifficulty(k)}
              >
                <span>
                  {k === "story" ? (
                    <Flame />
                  ) : k === "normal" ? (
                    <Sun />
                  ) : (
                    <Crown />
                  )}
                </span>
                <div>
                  <h3>{d.name}</h3>
                  <p>{d.description}</p>
                </div>
                {difficulty === k && <Check />}
              </button>
            ))}
          </div>
          <button className="gold-button modal-cta" onClick={restart}>
            开启新的远征
            <ChevronRight size={18} />
          </button>
        </Modal>
      )}

      {s.phase === "reward" && (
        <Modal
          title="余火中的馈赠"
          subtitle={`${s.boss.name}已被击败 · 选择一张卡牌，加入远征牌组。战后生命已恢复。`}
          wide
          className="reward-modal"
        >
          <div className="victory-mark">
            <Trophy />
          </div>
          <div className="reward-cards">
            {s.rewardOffer.map((key) => (
              <div className="reward-choice" key={key}>
                <Card
                  card={{ key }}
                  detail
                  onClick={() => dispatch({ type: "reward", key })}
                />
                <span className={"rarity-text " + CARDS[key].rarity}>
                  {CARDS[key].rarity}
                </span>
                <button
                  className="text-button"
                  onClick={() => dispatch({ type: "reward", key })}
                >
                  缔结契约
                  <Plus size={14} />
                </button>
              </div>
            ))}
          </div>
          <button
            className="secondary-button reward-skip"
            onClick={() => dispatch({ type: "reward", key: "heal" })}
          >
            <Heart size={15} />
            放弃卡牌，额外恢复 8 点生命
          </button>
          <p className="muted centered">
            当前生命 {s.hero.hp} / {s.hero.maxHp} · 选择后继续领取遗物
          </p>
        </Modal>
      )}
      {s.phase === "relic" && (
        <Modal
          title="旧时代的遗物"
          subtitle="带走一件旧物。它将陪你走到长夜尽头。"
          wide
        >
          <div className="relic-choices">
            {s.relicOffer.map((k) => {
              const I = relicIcons[RELICS[k].icon];
              return (
                <button
                  key={k}
                  onClick={() => dispatch({ type: "relic", key: k })}
                >
                  <div className="relic-emblem">
                    <I strokeWidth={1} />
                  </div>
                  <h3>{RELICS[k].name}</h3>
                  <p>{RELICS[k].text}</p>
                  <span>
                    收入行囊
                    <Plus size={15} />
                  </span>
                </button>
              );
            })}
          </div>
        </Modal>
      )}
      {s.phase === "camp" && (
        <Modal
          title="长夜中的营火"
          subtitle={`下一站 · ${ENCOUNTERS[s.stage + 1]?.place}。你有时间做一件事。`}
          wide
        >
          <div className="camp-flame">
            <Flame strokeWidth={1} />
            <span>
              生命 {s.hero.hp} / {s.hero.maxHp}
            </span>
          </div>
          {!campChoice ? (
            <div className="camp-options">
              <button
                onClick={() => dispatch({ type: "camp", choice: "rest" })}
              >
                <Heart />
                <h3>靠近炉火</h3>
                <p>恢复 12 点生命</p>
                <span>
                  休息并启程
                  <ChevronRight size={15} />
                </span>
              </button>
              <button onClick={() => setCampChoice("upgrade")}>
                <ArrowUp />
                <h3>锻造契约</h3>
                <p>永久升级一张卡牌</p>
                <span>
                  选择卡牌
                  <ChevronRight size={15} />
                </span>
              </button>
              <button
                onClick={() => setCampChoice("remove")}
                disabled={s.deck.length <= 10}
              >
                <Trash2 />
                <h3>放下负担</h3>
                <p>永久移除一张卡牌</p>
                <span>
                  精简牌组
                  <ChevronRight size={15} />
                </span>
              </button>
            </div>
          ) : (
            <>
              <button
                className="text-button"
                onClick={() => setCampChoice(null)}
              >
                <ChevronLeft size={15} />
                返回营火
              </button>
              <p className="centered muted">
                {campChoice === "upgrade"
                  ? "选择一张牌永久升级。随从 +1/+2；法术效果强化。"
                  : "选择一张牌从卡组移除，至少保留 10 张。"}
                选择后立即启程。
              </p>
              <div className="collection camp-collection">
                {s.deck
                  .filter((c) => campChoice === "remove" || !c.upgraded)
                  .map((c) => (
                    <div key={c.uid}>
                      <Card
                        card={c}
                        mini
                        onClick={() => {
                          dispatch({
                            type: "camp",
                            choice: campChoice,
                            uid: c.uid,
                          });
                          setCampChoice(null);
                        }}
                      />
                      <small>
                        {campChoice === "upgrade" ? "点击升级" : "点击移除"}
                      </small>
                    </div>
                  ))}
              </div>
            </>
          )}
        </Modal>
      )}
      {(s.phase === "won" || s.phase === "lost") && (
        <Modal
          title={s.phase === "won" ? "长夜已尽，黎明将至" : "余火，尚未熄灭"}
          subtitle={
            s.phase === "won"
              ? "你击败了永夜之王。那些被遗忘的名字，终于等到了晨光。"
              : "这一次，你停在了这里。但故事还没有结束。"
          }
        >
          <div className={"ending-art " + s.phase}>
            <Art index={s.phase === "won" ? 11 : 0} />
            <span />
            {s.phase === "won" ? <Trophy /> : <Flame />}
          </div>
          <div className="run-stats">
            <div>
              <b>{s.stats.wins}</b>
              <span>征服首领</span>
            </div>
            <div>
              <b>{s.stats.cards}</b>
              <span>使用卡牌</span>
            </div>
            <div>
              <b>{s.stats.weaves}</b>
              <span>改写命运</span>
            </div>
            <div>
              <b>{s.relics.length}</b>
              <span>收集遗物</span>
            </div>
          </div>
          <button
            className="gold-button modal-cta"
            onClick={() => {
              setS(newRun(Date.now(), s.difficulty));
              setSelection(null);
              setCampChoice(null);
            }}
          >
            再燃一次火光
            <RotateCcw size={17} />
          </button>
          <p className="muted centered">
            {DIFFICULTIES[s.difficulty].name}难度 ·{" "}
            {s.phase === "won"
              ? "远征完成"
              : "下次记得：守卫、治疗与护甲同样重要"}
          </p>
        </Modal>
      )}
    </main>
  );
}
