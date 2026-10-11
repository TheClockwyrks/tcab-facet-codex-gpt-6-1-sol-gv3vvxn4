import { describe, it, expect } from "vitest";
import {
  initial,
  debug,
  runs,
  legal,
  advance,
  resolve,
  choose,
  cellX,
  cellY,
  stepHold,
} from "./logic";
import type { FacetState } from "./game";
const base = Array.from({ length: 8 }, (_, r) =>
  Array.from({ length: 8 }, (_, c) => "RACJBSM"[(c + r * 2) % 7] + "0").join(
    " ",
  ),
);
function board() {
  return debug.setScreen(debug.loadBoard(initial(), base), "playing");
}
function gems(s: FacetState, entries: [number, number, string][]) {
  for (const [c, r, t] of entries) s = debug.setGem(s, c, r, t);
  return s;
}
describe("Facet simulation", () => {
  it("resets the complete state and preserves mute", () => {
    expect(
      debug.snapshot(debug.reset({ ...board(), score: 42, muted: true })),
    ).toMatchObject({
      screen: "title",
      score: 0,
      level: 1,
      muted: true,
      board: { cols: 0, rows: 0, cells: [] },
    });
  });
  it("deals run-free playable boards from above", () => {
    for (let i = 0; i < 30; i++) {
      const s = debug.dealBoard(initial());
      expect(runs(s.board.cells)).toHaveLength(0);
      expect(legal(s)).toBe(true);
      expect(
        s.board.cells.every((g) => g.fell >= g.row + 1 && g.strain === 0),
      ).toBe(true);
    }
  });
  it("validates notation and poses only requested fields", () => {
    expect(() => debug.loadBoard(initial(), ["R0"])).toThrow();
    expect(() => debug.setGem(board(), 0, 0, "X0b")).toThrow();
    expect(() => debug.setLevel(board(), 0)).toThrow();
    const s = { ...board(), score: 95, selection: { col: 2, row: 2 } };
    expect(debug.loadBoard(s, base)).toMatchObject({
      score: 95,
      selection: s.selection,
    });
  });
  it("refuses nonadjacent and unproductive moves without changing board", () => {
    const s = board();
    const n = debug.requestSwap(s, 0, 0, 2, 0);
    expect(n.board).toEqual(s.board);
    expect(n.refusal).not.toBeNull();
    expect(advance(n, 0.31).refusal).toBeNull();
  });
  it("offers on drag and plays only on release", () => {
    let s = gems(board(), [
      [0, 0, "R0"],
      [1, 0, "A0"],
      [2, 0, "R0"],
      [1, 1, "R0"],
    ]);
    s = debug.pointerDown(s, cellX(1), cellY(1), "touch");
    s = debug.pointerMove(s, cellX(1), cellY(0), "touch");
    expect(s.phase).toBe("idle");
    expect(s.offer).toEqual({ col: 1, row: 0 });
    s = debug.pointerUp(s, "touch");
    expect(s.phase).toBe("swapping");
    expect(s.selection).toBeNull();
    expect(s.pointer.device).toBe("touch");
  });
  it("withdraws an offer when dragged back", () => {
    let s = debug.pointerDown(board(), cellX(0), cellY(0));
    s = debug.pointerMove(s, cellX(1), cellY(0));
    s = debug.pointerMove(s, cellX(0), cellY(0));
    expect(debug.pointerUp(s).phase).toBe("idle");
    expect(s.offer).toBeNull();
  });
  it("scores seed gems before strain, and settles with durable fell", () => {
    let s = gems(board(), [
      [0, 7, "R0"],
      [1, 7, "R0"],
      [2, 7, "R3"],
    ]);
    s = resolve({ ...s, phase: "resolving", chainStep: 1 });
    expect(s.lastPoints).toBe(40);
    expect(s.lastCleared).toBe(3);
    expect(s.board.cells.find((g) => g.col === 0 && g.row === 7)?.fell).toBe(1);
    expect(s.board.cells.find((g) => g.col === 3 && g.row === 7)?.strain).toBe(
      1,
    );
  });
  it("expands flawed adjacency in waves", () => {
    let s = gems(board(), [
      [0, 7, "R0"],
      [1, 7, "R0"],
      [2, 7, "R0"],
      [3, 7, "A3"],
      [4, 7, "C3"],
    ]);
    s = resolve({ ...s, phase: "resolving", chainStep: 2 });
    expect(s.lastCleared).toBe(5);
    expect(s.lastWaves).toBe(2);
    expect(s.lastPoints).toBe(140);
  });
  it("creates brilliant, prism and intersecting star", () => {
    for (const [length, cut] of [
      [4, "brilliant"],
      [5, "prism"],
    ] as const) {
      let s = board();
      for (let c = 0; c < length; c++) s = debug.setGem(s, c, 7, "R0");
      s = resolve({ ...s, phase: "resolving", chainStep: 1 });
      expect(s.board.cells.some((g) => g.cut === cut && g.strain === 0)).toBe(
        true,
      );
    }
    let s = gems(board(), [
      [2, 5, "R0"],
      [2, 6, "R0"],
      [2, 7, "R0"],
      [1, 6, "R0"],
      [3, 6, "R0"],
    ]);
    s = resolve({ ...s, phase: "resolving", chainStep: 1 });
    expect(s.board.cells.some((g) => g.cut === "star")).toBe(true);
  });
  it("prism pair clears all cells and creates no cut", () => {
    let s = gems(board(), [
      [0, 0, "X0"],
      [1, 0, "X0"],
    ]);
    s = debug.requestSwap(s, 0, 0, 1, 0);
    s = advance(s, 0.18);
    expect(s.lastCleared).toBe(64);
    expect(s.board.cells.every((g) => g.cut === "plain")).toBe(true);
  });
  it("honors persistent per-column refills", () => {
    let s = gems(board(), [
      [0, 7, "R0"],
      [1, 7, "R0"],
      [2, 7, "R0"],
    ]);
    s = debug.setRefillKinds(s, 0, "M");
    s = resolve({ ...s, chainStep: 1, phase: "resolving" });
    expect(s.board.cells[0].kind).toBe("amethyst");
    expect(s.refillKinds[0]).toBe("M");
  });
  it("freezes resolution and refusal on pause but advances simTime", () => {
    const s = {
      ...debug.requestSwap(gems(board(), [[0, 0, "X0"]]), 0, 0, 1, 0),
      screen: "paused" as const,
    };
    const n = advance(s, 2);
    expect(n.swapTimer).toBe(0);
    expect(n.simTime).toBe(2);
  });
  it("carries frame remainder into chain timing", () => {
    const s = debug.requestSwap(gems(board(), [[0, 0, "X0"]]), 0, 0, 1, 0);
    const n = advance(s, 0.2);
    expect(n.phase).toBe("resolving");
    expect(n.stepTimer).toBeCloseTo(0.02);
    expect(stepHold(n)).toBeGreaterThan(0.25);
  });
  it("screen targets arm and cancel correctly", () => {
    let s = debug.pointerDown(initial(), 640, 420);
    s = debug.pointerMove(s, 100, 100);
    s = debug.pointerUp(s);
    expect(s.screen).toBe("title");
    s = debug.pointerDown(s, 640, 420);
    s = debug.pointerUp(s);
    expect(s.screen).toBe("playing");
  });
  it("quit puts down board while preserving round figures", () => {
    const s = {
      ...board(),
      screen: "paused" as const,
      menuIndex: 1,
      score: 420,
    };
    expect(choose(s)).toMatchObject({
      screen: "title",
      score: 420,
      board: { cols: 0, rows: 0, cells: [] },
    });
  });
  it("continuing advances level and preserves total score", () => {
    const n = choose({
      ...board(),
      screen: "levelclear",
      score: 2200,
      levelScore: 2200,
      bestMove: 100,
      bestChain: 3,
    });
    expect(n).toMatchObject({
      level: 2,
      score: 2200,
      levelScore: 0,
      bestMove: 0,
      bestChain: 0,
      screen: "playing",
    });
  });
});

it("evaluates level completion before a board with no legal swap", () => {
  const s = {
    ...board(),
    phase: "resolving" as const,
    chainStep: 1,
    moveScore: 90,
    levelScore: 2000,
  };
  const n = advance(s, 0.26);
  expect(n.screen).toBe("levelclear");
  expect(n.bestMove).toBe(90);
  expect(n.chainStep).toBe(0);
  expect(n.stepTimer).toBe(0);
});
it("ends a settled round with no productive move", () => {
  const s = { ...board(), phase: "resolving" as const, chainStep: 1 };
  expect(legal(s)).toBe(false);
  expect(advance(s, 0.26).screen).toBe("gameover");
});
