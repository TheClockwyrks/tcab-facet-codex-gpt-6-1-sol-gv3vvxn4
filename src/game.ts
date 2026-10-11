import type { Game } from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import * as C from "./constants";
import {
  debug,
  initial,
  advance,
  pointerEvent,
  choose,
  changeScreen,
} from "./logic";
import { loadArt, render } from "./visual";
export type GemKind =
  "ruby" | "amber" | "citrine" | "jade" | "beryl" | "sapphire" | "amethyst";

export type Cut = "plain" | "brilliant" | "star" | "prism";

export type Screen =
  "title" | "howto" | "playing" | "paused" | "levelclear" | "gameover";

export type Phase = "idle" | "swapping" | "resolving";

export type PointerDevice = "mouse" | "pen" | "touch";

export interface CellRef {
  readonly col: number;
  readonly row: number;
}

export interface GemState {
  readonly col: number;
  readonly row: number;
  readonly kind: GemKind | null;
  readonly cut: Cut;
  readonly strain: number;
  readonly fell: number;
}

export interface BoardState {
  readonly cols: number;
  readonly rows: number;
  readonly cells: readonly GemState[];
}

export interface RefusalState {
  readonly a: CellRef;
  readonly b: CellRef;
  readonly timer: number;
}

export interface PointerState {
  readonly x: number;
  readonly y: number;
  readonly down: boolean;
  readonly device: PointerDevice;
}

export interface FacetState {
  readonly swapPair?: { readonly a: CellRef; readonly b: CellRef } | null;
  readonly visualStep?: import("./logic").VisualStep | null;
  readonly dealAt?: number;
  readonly images?: Readonly<Record<string, ImageBitmap>>;
  readonly effects?: DeepReadonly<
    Record<string, import("@clockwyrks/particle-runtime").ParticleSystem>
  >;
  readonly screen: Screen;
  readonly menuIndex: number;

  readonly board: BoardState;
  readonly phase: Phase;
  readonly chainStep: number;
  readonly swapTimer: number;
  readonly stepTimer: number;

  readonly score: number;
  readonly level: number;
  readonly levelScore: number;
  readonly lastCleared: number;
  readonly lastPoints: number;
  readonly lastWaves: number;

  readonly moveScore: number;
  readonly bestMove: number;
  readonly bestChain: number;

  readonly selection: CellRef | null;
  readonly offer: CellRef | null;
  readonly refusal: RefusalState | null;
  readonly armedTarget: string | null;

  readonly pointer: PointerState;
  readonly simTime: number;
  readonly muted: boolean;
  readonly refillKinds: readonly string[];
}

export type ReadState = DeepReadonly<FacetState>;
export type FacetDebugApi = typeof debug;
export const BACKGROUND = "#09151f";
export const game: Game<FacetState, FacetDebugApi> = {
  async initialize(api) {
    for (const action of C.ACTIONS)
      api.input.register(action, { keys: [...C.BINDINGS[action]] });
    const assets = await loadArt(api);
    for (const key of [
      "screen",
      "phase",
      "score",
      "level",
      "levelScore",
      "chainStep",
      "lastCleared",
      "lastPoints",
      "lastWaves",
      "bestMove",
      "bestChain",
    ] as const)
      api.diagnostics.register(key, (s) => s[key]);
    api.diagnostics.register(
      "board",
      (s) => `${s.board.cols} × ${s.board.rows}`,
    );
    api.diagnostics.register("target", (s) => C.LEVEL_TARGET_STEP * s.level);
    api.diagnostics.register("multiplier", (s) =>
      Math.min(s.chainStep, C.MAX_MULTIPLIER),
    );
    api.diagnostics.register("lastFall", (s) =>
      Math.max(0, ...s.board.cells.map((g) => g.fell)),
    );
    api.diagnostics.register("selection", (s) => JSON.stringify(s.selection));
    api.diagnostics.register("offer", (s) => JSON.stringify(s.offer));
    api.diagnostics.register("legal swap", (s) => debug.snapshot(s).legalSwap);
    api.diagnostics.register(
      "pointer",
      (s) =>
        `${Math.round(s.pointer.x)}, ${Math.round(s.pointer.y)} ${s.pointer.device}`,
    );
    return [{ ...initial(), ...assets }, debug];
  },
  update(state, api, dt) {
    const cues = new Set<string>();
    let n: FacetState = { ...state };
    const actions = Object.fromEntries(
      C.ACTIONS.map((a) => [a, api.input.pressed(a)]),
    );
    if (actions.mute) api.audio.setMuted(!api.audio.muted());
    if (actions.pause && (n.screen === "playing" || n.screen === "paused"))
      n = changeScreen(n, n.screen === "playing" ? "paused" : "playing");
    else if (actions.back && (n.screen === "howto" || n.screen === "gameover"))
      n = {
        ...changeScreen(n, "title"),
        menuIndex: n.screen === "howto" ? 1 : 0,
      };
    else {
      if (actions.up || actions.down) {
        if (!["playing", "howto"].includes(n.screen))
          n = {
            ...n,
            menuIndex: (n.menuIndex + (actions.down ? 1 : -1) + 2) % 2,
          };
      }
      if (actions.confirm) n = choose(n);
    }
    for (const p of api.input.pointerSamples()) {
      if (!p.primary) continue;
      const before = n;
      n = pointerEvent(n, p.type, p.x, p.y, p.device);
      if (n.phase === "swapping" && before.phase !== "swapping")
        cues.add(C.CUES.swap);
      if (n.refusal && n.refusal !== before.refusal) cues.add(C.CUES.refuse);
      if (
        n.selection &&
        JSON.stringify(n.selection) !== JSON.stringify(before.selection)
      )
        cues.add(C.CUES.select);
    }
    n = advance(n, dt, (cue) => cues.add(cue));
    n = {
      ...n,
      pointer: api.input.pointer(),
      muted: api.audio.muted(),
      images: state.images,
      effects: state.effects,
    };
    for (const cue of cues) {
      api.audio.play(cue);
      if (cue === C.CUES.clear)
        api.audio.play(
          `ladder-${Math.max(1, Math.min(n.chainStep || n.bestChain, C.MAX_MULTIPLIER))}`,
        );
    }
    const theme = ["title", "howto"].includes(n.screen)
      ? "title-theme"
      : "play-bed";
    api.audio.stop(theme === "title-theme" ? "play-bed" : "title-theme");
    api.audio.loop(theme);
    return n;
  },
  render,
};
