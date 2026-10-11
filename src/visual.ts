import type { InitApi, RenderApi } from "@clockwyrks/simple-2d";
import { ParticleSimulator } from "@clockwyrks/particle-runtime";
import type { ParticleSystem } from "@clockwyrks/particle-runtime";
import type { FacetState, ReadState, GemState } from "./game";
import * as C from "./constants";
import { cellX, cellY, targets } from "./logic";
export async function loadArt(api: InitApi<FacetState>) {
  const paths = ["gems/board.png", "gems/brilliant.png", "gems/star.png"];
  for (const name of [...C.GEM_KINDS, "prism"])
    for (let i = 0; i <= C.MAX_STRAIN; i++) paths.push(`gems/${name}-${i}.png`);
  for (const k of C.GEM_KINDS)
    for (let f = 0; f < 6; f++) paths.push(`gems/break/${k}/${f}.png`);
  for (let f = 0; f < 8; f++) paths.push(`gems/prism-turn/${f}.png`);
  const images = Object.fromEntries(
    await Promise.all(
      paths.map(async (p) => [p, await api.assets.loadImage(p)] as const),
    ),
  );
  const effects = Object.fromEntries(
    await Promise.all(
      ["clear", "flawed", "cut", "aura"].map(
        async (k) =>
          [
            k,
            JSON.parse(
              await (await api.assets.load(`fx/${k}.json`)).text(),
            ) as ParticleSystem,
          ] as const,
      ),
    ),
  );
  await Promise.all([
    ...Object.values(C.CUES)
      .filter((k) => k !== C.CUES.clear)
      .map((k) => api.audio.load(k, `audio/${k}.wav`)),
    api.audio.load("title-theme", "audio/title.wav"),
    api.audio.load("play-bed", "audio/play.wav"),
    ...Array.from({ length: C.MAX_MULTIPLIER }, (_, i) =>
      api.audio.load(`ladder-${i + 1}`, `audio/ladder-${i + 1}.wav`),
    ),
    api.audio.load(C.CUES.clear, "audio/shatter.wav"),
  ]);
  return { images, effects };
}
const gold = "#e9c68b",
  muted = "#8da7b1",
  white = "#eef5ec";
function text(
  ctx: CanvasRenderingContext2D,
  t: string,
  x: number,
  y: number,
  size = 18,
  color = white,
  align: CanvasTextAlign = "left",
  serif = false,
) {
  ctx.fillStyle = color;
  ctx.font = `${serif ? "" : "500 "}${size}px ${serif ? "Georgia" : '"Trebuchet MS", sans-serif'}`;
  ctx.textAlign = align;
  ctx.fillText(t, x, y);
}
function sprite(
  ctx: CanvasRenderingContext2D,
  s: ReadState,
  path: string,
  x: number,
  y: number,
) {
  const image = s.images?.[path];
  if (image) ctx.drawImage(image, x - 32, y - 32, 64, 64);
}
function particles(
  ctx: CanvasRenderingContext2D,
  s: ReadState,
  name: string,
  x: number,
  y: number,
  age: number,
  seed: number,
) {
  const system = s.effects?.[name];
  if (!system || age < 0 || age > 1.1) return;
  const sim = new ParticleSimulator(structuredClone(system) as ParticleSystem, {
    seed: seed + s.score,
  });
  for (let t = 0; t < age; t += 1 / 60)
    sim.step(Math.min(1 / 60, age - t) * 1000);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const p of sim.capture()) {
    ctx.globalAlpha = p.opacity;
    ctx.fillStyle = `rgb(${p.color[0] * 255},${p.color[1] * 255},${p.color[2] * 255})`;
    ctx.beginPath();
    ctx.arc(
      x + p.position[0],
      y - p.position[1],
      Math.max(0.2, p.size * 1.2),
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();
}
function gem(
  ctx: CanvasRenderingContext2D,
  s: ReadState,
  g: GemState,
  x: number,
  y: number,
) {
  sprite(ctx, s, `gems/${g.kind ?? "prism"}-${g.strain}.png`, x, y);
  if (g.cut === "prism") {
    ctx.globalAlpha = g.strain === 0 ? 1 : 0.35;
    sprite(
      ctx,
      s,
      `gems/prism-turn/${Math.floor(s.simTime * 9) % 8}.png`,
      x,
      y,
    );
    ctx.globalAlpha = 1;
  }
  if (g.cut === "brilliant" || g.cut === "star")
    sprite(ctx, s, `gems/${g.cut}.png`, x, y);
  if (g.cut !== "plain")
    particles(
      ctx,
      s,
      "aura",
      x,
      y,
      (s.simTime + g.col * 0.11 + g.row * 0.07) % 1,
      idxSeed(g),
    );
}
const idxSeed = (g: GemState) => g.row * C.GRID_COLS + g.col + 31;
function board(ctx: CanvasRenderingContext2D, s: ReadState) {
  const frame = s.images?.["gems/board.png"];
  if (frame) ctx.drawImage(frame, C.BOARD_CX - 300, C.BOARD_CY - 300);
  ctx.save();
  ctx.beginPath();
  ctx.rect(C.BOARD_CX - 288, C.BOARD_CY - 288, 576, 576);
  ctx.clip();
  const shatter = s.lastWaves * C.WAVE_SECONDS;
  for (const g of s.board.cells) {
    let x = cellX(g.col),
      y = cellY(g.row);
    if (s.selection && s.offer) {
      if (g.col === s.selection.col && g.row === s.selection.row) {
        x = cellX(s.offer.col);
        y = cellY(s.offer.row);
      } else if (g.col === s.offer.col && g.row === s.offer.row) {
        x = cellX(s.selection.col);
        y = cellY(s.selection.row);
      }
    }
    if (s.phase === "swapping" && s.swapPair) {
      const { a, b } = s.swapPair;
      const t = Math.min(1, s.swapTimer / C.SWAP_SECONDS);
      if (g.col === a.col && g.row === a.row) {
        x = cellX(b.col) + (x - cellX(b.col)) * t;
        y = cellY(b.row) + (y - cellY(b.row)) * t;
      } else if (g.col === b.col && g.row === b.row) {
        x = cellX(a.col) + (x - cellX(a.col)) * t;
        y = cellY(a.row) + (y - cellY(a.row)) * t;
      }
    }
    if (s.phase === "resolving") {
      if (s.stepTimer < shatter) continue;
      const t = Math.min(
        1,
        Math.max(
          0,
          (s.stepTimer - shatter) / (g.fell * C.FALL_SECONDS_PER_ROW || 1),
        ),
      );
      y -= g.fell * C.CELL_PITCH * (1 - t);
    } else if (s.dealAt !== undefined) {
      const age = s.simTime - s.dealAt;
      const t = Math.min(1, age / (g.fell * C.FALL_SECONDS_PER_ROW || 1));
      y -= g.fell * C.CELL_PITCH * (1 - t);
    }
    gem(ctx, s, g, x, y);
  }
  if (s.phase === "resolving" && s.visualStep) {
    for (const { gem: g, wave } of s.visualStep.removed) {
      const age = s.stepTimer - wave * C.WAVE_SECONDS;
      const x = cellX(g.col),
        y = cellY(g.row);
      if (age < 0) gem(ctx, s, g, x, y);
      else {
        if (age < 0.3 && g.kind)
          sprite(
            ctx,
            s,
            `gems/break/${g.kind}/${Math.min(5, Math.floor(age * 20))}.png`,
            x,
            y,
          );
        particles(
          ctx,
          s,
          g.strain === C.MAX_STRAIN ? "flawed" : "clear",
          x,
          y,
          age,
          idxSeed(g),
        );
      }
    }
    for (const p of s.visualStep.created)
      particles(
        ctx,
        s,
        "cut",
        cellX(p.col),
        cellY(p.row),
        s.stepTimer - shatter,
        idxSeed({ ...p } as GemState),
      );
  }
  ctx.restore();
  if (s.selection) {
    ctx.strokeStyle = gold;
    ctx.lineWidth = 2;
    ctx.strokeRect(
      cellX(s.selection.col) - 33,
      cellY(s.selection.row) - 33,
      66,
      66,
    );
  }
  if (s.refusal) {
    ctx.strokeStyle = "#fb7272";
    ctx.lineWidth = 3;
    for (const p of [s.refusal.a, s.refusal.b])
      ctx.strokeRect(cellX(p.col) - 32, cellY(p.row) - 32, 64, 64);
  }
}
function button(
  ctx: CanvasRenderingContext2D,
  t: { x: number; y: number; w: number; h: number },
  label: string,
  active: boolean,
) {
  ctx.fillStyle = active ? "#d8b77e" : "#172b36";
  ctx.fillRect(t.x, t.y, t.w, t.h);
  ctx.strokeStyle = active ? "#f4dcaa" : "#42535a";
  ctx.lineWidth = 1;
  ctx.strokeRect(t.x + 0.5, t.y + 0.5, t.w - 1, t.h - 1);
  text(
    ctx,
    label,
    t.x + t.w / 2,
    t.y + t.h / 2 + 7,
    20,
    active ? "#12212b" : gold,
    "center",
  );
  if (active) text(ctx, "◆", t.x + 27, t.y + t.h / 2 + 5, 13, "#253641");
}
export function render(s: ReadState, { ctx }: RenderApi) {
  ctx.imageSmoothingEnabled = false;
  const bg = ctx.createRadialGradient(640, 330, 30, 640, 360, 740);
  bg.addColorStop(0, "#18323c");
  bg.addColorStop(1, "#09151f");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, C.STAGE_W, C.STAGE_H);
  ctx.strokeStyle = "#263a42";
  for (let x = 60; x < 1280; x += 160) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 360, 720);
    ctx.stroke();
  }
  text(ctx, "F /", 60, 65, 26, gold);
  text(ctx, "THE LAPIDARY COLLECTION", 103, 62, 12, muted);
  text(ctx, s.muted ? "M · SOUND OFF" : "M · SOUND ON", 60, 686, 12, muted);
  text(ctx, "MATCH • STRAIN • SHATTER", 1220, 686, 12, muted, "right");
  if (!["title", "howto"].includes(s.screen)) {
    board(ctx, s);
    text(ctx, C.HUD_SCORE_LABEL, 360, 40, 12, muted);
    text(ctx, String(s.score).padStart(6, "0"), 360, 78, 32, gold);
    text(
      ctx,
      `${C.HUD_LEVEL_LABEL}  ${String(s.level).padStart(2, "0")}`,
      640,
      47,
      16,
      white,
      "center",
    );
    ctx.fillStyle = "#253b44";
    ctx.fillRect(558, 64, 164, 5);
    ctx.fillStyle = gold;
    ctx.fillRect(
      558,
      64,
      164 * Math.min(1, s.levelScore / (s.level * C.LEVEL_TARGET_STEP)),
      5,
    );
    text(
      ctx,
      `${s.levelScore} / ${s.level * C.LEVEL_TARGET_STEP}`,
      640,
      88,
      12,
      muted,
      "center",
    );
    if (s.phase === "resolving") {
      text(ctx, C.HUD_CHAIN_LABEL, 860, 40, 12, muted);
      text(
        ctx,
        `×${Math.min(s.chainStep, C.MAX_MULTIPLIER)}`,
        860,
        78,
        32,
        gold,
      );
    }
    text(ctx, "01 / TAKE HOLD", 60, 235, 12, gold);
    text(ctx, "Move a stone", 60, 265, 21);
    text(ctx, "onto its neighbor.", 60, 294, 21);
    text(ctx, "Release to shatter.", 60, 333, 15, muted);
    text(ctx, "PRESSURE", 1000, 264, 12, gold);
    text(ctx, "Every clear leaves", 1000, 295, 17);
    text(ctx, "a little more strain.", 1000, 320, 17);
    for (let i = 0; i < 4; i++)
      sprite(ctx, s, `gems/jade-${i}.png`, 1015 + i * 48, 377);
    text(ctx, "Flawed stones carry", 1000, 439, 17);
    text(ctx, "twice the value.", 1000, 464, 17);
    if (s.screen === "playing")
      for (const t of targets(s)) button(ctx, t, C.PAUSE_LABEL, false);
  }
  if (s.screen === "title") {
    text(
      ctx,
      "A GAME OF BEAUTIFUL CONSEQUENCES",
      640,
      158,
      13,
      muted,
      "center",
    );
    text(ctx, C.TITLE_TEXT, 640, 282, 112, gold, "center", true);
    text(ctx, C.TAGLINE_TEXT, 640, 326, 17, white, "center");
    for (let i = 0; i < 7; i++) {
      const g: GemState = {
        col: i,
        row: 0,
        kind: C.GEM_KINDS[i],
        cut: "plain",
        strain: i % 4,
        fell: 0,
      };
      gem(ctx, s, g, 370 + i * 90, 609);
    }
    text(ctx, "Seven stones. One fault line.", 640, 672, 15, muted, "center");
  }
  if (s.screen === "howto") {
    text(ctx, "THE ART OF PRESSURE", 640, 112, 44, gold, "center", true);
    const sections = [
      [
        "01  MAKE A MATCH",
        "Seven kinds of stone. Take hold with a mouse, pen, or finger.",
        "Carry a gem onto its neighbor and release. Three in a line shatter.",
        "Carry it back to cancel; a move that clears nothing is refused.",
      ],
      [
        "02  FIND THE FLAW",
        "Each clear strains the stones beside it. Three strains make a flaw.",
        "A flawed stone shatters when a clear touches it — for double points.",
        "Falling gems can match again. Every chain step is worth more.",
      ],
      [
        "03  EARN A CUT",
        "Four in a line: brilliant, clearing the eight stones around it.",
        "Five or more: prism, clearing a whole kind when swapped with one.",
        "Crossing lines: star, clearing its entire row and column.",
      ],
    ];
    sections.forEach((lines, i) => {
      const y = 184 + i * 128;
      text(ctx, lines[0], 190, y, 16, gold);
      lines.slice(1).forEach((l, j) => text(ctx, l, 190, y + 29 + j * 25, 18));
    });
    text(
      ctx,
      "Reach the level target to continue. No productive move left ends the round.",
      190,
      590,
      17,
      muted,
    );
    text(
      ctx,
      "↑ ↓ menus · Enter / Space choose · P / Escape pause · M mute · Escape back",
      190,
      645,
      15,
      muted,
    );
    button(ctx, targets(s)[0], C.BACK_LABEL, false);
    return;
  }
  if (["paused", "levelclear", "gameover"].includes(s.screen)) {
    ctx.fillStyle = "#07131ee8";
    ctx.fillRect(300, 155, 680, 440);
    ctx.strokeStyle = "#796c50";
    ctx.strokeRect(300, 155, 680, 440);
    const title =
      s.screen === "paused"
        ? C.PAUSED_TITLE_TEXT
        : s.screen === "levelclear"
          ? C.LEVELCLEAR_TITLE_TEXT
          : C.GAMEOVER_TITLE_TEXT;
    text(ctx, title, 640, 248, 47, gold, "center", true);
    text(
      ctx,
      s.screen === "paused"
        ? "A moment to study the stones."
        : s.screen === "levelclear"
          ? `${C.HUD_LEVEL_LABEL} ${s.level}  ·  ${C.BEST_CHAIN_LABEL} ${s.bestChain}  ·  ${C.BEST_MOVE_LABEL} ${s.bestMove}`
          : `${C.HUD_SCORE_LABEL} ${s.score}  ·  ${C.HUD_LEVEL_LABEL} ${s.level}`,
      640,
      306,
      17,
      white,
      "center",
    );
  }
  if (!["playing", "howto"].includes(s.screen)) {
    const items =
      s.screen === "title"
        ? C.TITLE_ITEMS
        : s.screen === "paused"
          ? C.PAUSED_ITEMS
          : s.screen === "levelclear"
            ? C.LEVELCLEAR_ITEMS
            : C.GAMEOVER_ITEMS;
    targets(s).forEach((t, i) => button(ctx, t, items[i], s.menuIndex === i));
  }
}
