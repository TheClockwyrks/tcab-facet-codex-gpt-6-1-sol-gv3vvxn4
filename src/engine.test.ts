/// <reference types="node" />
import { it, expect } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFile } from "node:fs/promises";
import { createEngine, ConstantClock } from "@clockwyrks/simple-2d";
import { game, BACKGROUND } from "./game";
import * as C from "./constants";
import { cellX, cellY } from "./logic";
it("runs real art, transitions, input and cue events through the engine and recorder", async () => {
  const events = new EventTarget();
  const engine = createEngine({
    canvas: createCanvas(C.STAGE_W, C.STAGE_H) as unknown as HTMLCanvasElement,
    width: C.STAGE_W,
    height: C.STAGE_H,
    background: BACKGROUND,
    layout: C.LAYOUT,
    clock: new ConstantClock(1000 / 60),
    surface: {
      cssWidth: () => C.STAGE_W,
      cssHeight: () => C.STAGE_H,
      dpr: () => 1,
      events: () => events,
    },
    game: {
      ...game,
      initialize: (api) =>
        game.initialize({
          ...api,
          assets: {
            ...api.assets,
            loadImage: async (path) =>
              (await loadImage(
                await readFile(`public/assets/${path}`),
              )) as unknown as ImageBitmap,
            load: async (path) =>
              new Blob([await readFile(`public/assets/${path}`)]),
          },
          audio: {
            ...api.audio,
            load: async (cue) => {
              api.audio.define(cue, { freq: 440, durationMs: 50 });
            },
          },
        }),
    },
  });
  const played: string[] = [];
  engine.events.on("cue:played", (e) => played.push(e.cue));
  await engine.initialize();
  await engine.advance(1);
  expect(engine.debug.snapshot(engine.state).screen).toBe("title");
  function key(code: string) {
    events.dispatchEvent(Object.assign(new Event("keydown"), { code }));
    events.dispatchEvent(Object.assign(new Event("keyup"), { code }));
  }
  key("Enter");
  await engine.advance(40);
  expect(engine.state.screen).toBe("playing");
  engine.apply((s) => engine.debug.setGem(s, 0, 0, "X0"));
  engine.apply((s) => engine.debug.setGem(s, 1, 0, "R3b"));
  engine.apply((s) => engine.debug.setGem(s, 2, 0, "R3s"));
  function pointer(type: string, x: number, y: number, buttons: number) {
    events.dispatchEvent(
      Object.assign(new Event(type), {
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons,
      }),
    );
  }
  engine.startRecording();
  pointer("pointerdown", cellX(0), cellY(0), 1);
  pointer("pointermove", cellX(1), cellY(0), 1);
  pointer("pointerup", cellX(1), cellY(0), 0);
  await engine.advance(20);
  expect(played).toContain(C.CUES.swap);
  expect(played).toContain(C.CUES.clear);
  expect(engine.state.score).toBeGreaterThan(0);
  key("KeyP");
  await engine.advance(1);
  const frozen = engine.state.stepTimer;
  await engine.advance(10);
  expect(engine.state.screen).toBe("paused");
  expect(engine.state.stepTimer).toBe(frozen);
  key("KeyM");
  await engine.advance(1);
  expect(engine.state.muted).toBe(true);
  key("Escape");
  await engine.advance(1);
  expect(engine.state.screen).toBe("playing");
  const rec = engine.stopRecording();
  expect(rec.frames.length).toBe(33);
  expect(rec.ops.length).toBeGreaterThan(0);
  engine.destroy();
});
