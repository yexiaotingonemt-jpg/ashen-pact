let ctx;
export function sound(kind, enabled) {
  if (!enabled) return;
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    const now = ctx.currentTime;
    const notes =
      kind === "win"
        ? [392, 494, 587, 784]
        : kind === "turn"
          ? [261, 392]
          : kind === "hit"
            ? [110, 75]
            : kind === "heal"
              ? [440, 660]
              : [294, 440];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(),
        g = ctx.createGain();
      o.type = kind === "hit" ? "triangle" : "sine";
      o.frequency.setValueAtTime(f, now + i * 0.08);
      g.gain.setValueAtTime(0, now + i * 0.08);
      g.gain.linearRampToValueAtTime(0.075, now + i * 0.08 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.32);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(now + i * 0.08);
      o.stop(now + i * 0.08 + 0.35);
    });
  } catch {
    /* Audio is optional; the game remains playable without it. */
  }
}
