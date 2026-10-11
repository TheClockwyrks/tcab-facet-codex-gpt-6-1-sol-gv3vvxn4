import * as C from "./constants";
import type {
  FacetState,
  ReadState,
  GemState,
  GemKind,
  CellRef,
  Screen,
  PointerDevice,
  Cut,
} from "./game";
export const cellX = (col: number) =>
  C.BOARD_CX - ((C.GRID_COLS - 1) * C.CELL_PITCH) / 2 + col * C.CELL_PITCH;
export const cellY = (row: number) =>
  C.BOARD_CY - ((C.GRID_ROWS - 1) * C.CELL_PITCH) / 2 + row * C.CELL_PITCH;
const letters = "RACJBSM";
const idx = (p: CellRef) => p.row * C.GRID_COLS + p.col;
const ref = (i: number) => ({
  col: i % C.GRID_COLS,
  row: Math.floor(i / C.GRID_COLS),
});
const adjacent = (a: CellRef, b: CellRef) =>
  Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1;
function integer(n: number, min = 0, max = Infinity) {
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error("Facet: invalid integer");
  return n;
}
function cell(col: number, row: number) {
  integer(col, 0, C.GRID_COLS - 1);
  integer(row, 0, C.GRID_ROWS - 1);
  return { col, row };
}
function token(t: string, p: CellRef): GemState {
  if (!/^(?:[RACJBSM][0-3][bs]?|X[0-3])$/.test(t))
    throw new Error("Facet: invalid token");
  return {
    ...p,
    kind: t[0] === "X" ? null : C.GEM_KINDS[letters.indexOf(t[0])],
    strain: Number(t[1]),
    cut:
      t[0] === "X"
        ? "prism"
        : t[2] === "b"
          ? "brilliant"
          : t[2] === "s"
            ? "star"
            : "plain",
    fell: 0,
  };
}
export function initial(muted = false): FacetState {
  return {
    screen: "title",
    menuIndex: 0,
    board: { cols: 0, rows: 0, cells: [] },
    phase: "idle",
    chainStep: 0,
    swapTimer: 0,
    stepTimer: 0,
    score: 0,
    level: 1,
    levelScore: 0,
    lastCleared: 0,
    lastPoints: 0,
    lastWaves: 0,
    moveScore: 0,
    bestMove: 0,
    bestChain: 0,
    selection: null,
    offer: null,
    refusal: null,
    armedTarget: null,
    pointer: { x: 0, y: 0, down: false, device: "mouse" },
    simTime: 0,
    muted,
    refillKinds: Array<string>(C.GRID_COLS).fill(""),
  };
}
export interface Run {
  cells: number[];
  vertical: boolean;
}
export function runs(cells: readonly GemState[]): Run[] {
  const out: Run[] = [];
  if (cells.length !== C.GRID_COLS * C.GRID_ROWS) return out;
  for (const vertical of [false, true])
    for (let a = 0; a < C.GRID_ROWS; a++) {
      let list: number[] = [];
      let kind: GemKind | null = null;
      for (let b = 0; b <= C.GRID_COLS; b++) {
        const i = vertical ? b * C.GRID_COLS + a : a * C.GRID_COLS + b;
        const k = b < C.GRID_COLS ? cells[i].kind : null;
        if (k !== kind || k === null) {
          if (list.length >= C.MATCH_MIN) out.push({ cells: list, vertical });
          list = [];
        }
        if (k !== null) list.push(i);
        kind = k;
      }
    }
  return out;
}
function exchanged(s: ReadState, a: CellRef, b: CellRef) {
  const cells = s.board.cells.map((g) => ({ ...g }));
  const ia = idx(a),
    ib = idx(b);
  if (!cells[ia] || !cells[ib]) throw new Error("Facet: no gem");
  [cells[ia], cells[ib]] = [
    { ...cells[ib], ...a, fell: 0 },
    { ...cells[ia], ...b, fell: 0 },
  ];
  return cells;
}
export function legal(s: ReadState): boolean {
  for (const g of s.board.cells)
    for (const p of [
      { col: g.col + 1, row: g.row },
      { col: g.col, row: g.row + 1 },
    ])
      if (p.col < C.GRID_COLS && p.row < C.GRID_ROWS) {
        if (
          g.cut === "prism" ||
          s.board.cells[idx(p)].cut === "prism" ||
          runs(exchanged(s, g, p)).length
        )
          return true;
      }
  return false;
}
export function deal(s: ReadState): FacetState {
  let cells: GemState[];
  do {
    cells = [];
    for (let i = 0; i < C.GRID_COLS * C.GRID_ROWS; i++) {
      const p = ref(i);
      let kind: GemKind;
      do {
        kind = C.GEM_KINDS[Math.floor(Math.random() * C.GEM_KIND_COUNT)];
      } while (
        (p.col >= 2 &&
          cells[i - 1].kind === kind &&
          cells[i - 2].kind === kind) ||
        (p.row >= 2 &&
          cells[i - C.GRID_COLS].kind === kind &&
          cells[i - 2 * C.GRID_COLS].kind === kind)
      );
      cells.push({ ...p, kind, cut: "plain", strain: 0, fell: p.row + 1 });
    }
  } while (
    !legal({ ...s, board: { cols: C.GRID_COLS, rows: C.GRID_ROWS, cells } })
  );
  return { ...s, board: { cols: C.GRID_COLS, rows: C.GRID_ROWS, cells } };
}
export interface VisualStep {
  readonly removed: readonly {
    readonly gem: GemState;
    readonly wave: number;
  }[];
  readonly created: readonly CellRef[];
}
// Transition evidence is derived by replaying the accepted move over its prior board.
export function request(s: ReadState, a: CellRef, b: CellRef): FacetState {
  cell(a.col, a.row);
  cell(b.col, b.row);
  if (!s.board.cells[idx(a)] || !s.board.cells[idx(b)])
    throw new Error("Facet: no board");
  if (s.phase !== "idle" || !adjacent(a, b))
    return { ...s, refusal: { a, b, timer: 0 } };
  const cells = exchanged(s, a, b);
  if (
    !cells.some(
      (g, i) => (i === idx(a) || i === idx(b)) && g.cut === "prism",
    ) &&
    !runs(cells).length
  )
    return { ...s, refusal: { a, b, timer: 0 } };
  return {
    ...s,
    board: { ...s.board, cells },
    phase: "swapping",
    swapTimer: 0,
    stepTimer: 0,
    chainStep: 0,
    moveScore: 0,
    refusal: null,
    swapPair: { a, b },
    visualStep: null,
  };
}
export function lastFall(s: ReadState) {
  return Math.max(0, ...s.board.cells.map((g) => g.fell));
}
export function stepHold(s: ReadState) {
  return (
    s.lastWaves * C.WAVE_SECONDS +
    lastFall(s) * C.FALL_SECONDS_PER_ROW +
    C.STEP_SECONDS
  );
}
export function resolve(s: ReadState): FacetState {
  const cells = s.board.cells;
  const rr = runs(cells);
  let seed = rr.flatMap((r) => r.cells);
  const pair = s.swapPair;
  if (s.chainStep === 1 && pair) {
    const a = cells[idx(pair.a)],
      b = cells[idx(pair.b)];
    if (a.cut === "prism" || b.cut === "prism") {
      const k = a.cut === "prism" ? b.kind : a.kind;
      seed = cells.flatMap((g, i) =>
        k === null ||
        g.kind === k ||
        ((i === idx(pair.a) || i === idx(pair.b)) && g.cut === "prism")
          ? [i]
          : [],
      );
      rr.length = 0;
    }
  }
  const waves = new Map<number, number>(seed.map((i) => [i, 0]));
  const queue = [...waves.keys()];
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q],
      g = cells[i],
      w = waves.get(i)!;
    const reach: number[] = [];
    for (const h of cells) {
      const dx = Math.abs(h.col - g.col),
        dy = Math.abs(h.row - g.row);
      if (
        (g.cut === "brilliant" && dx <= 1 && dy <= 1) ||
        (g.cut === "star" && (dx === 0 || dy === 0)) ||
        (h.strain === C.MAX_STRAIN && dx + dy === 1)
      )
        reach.push(idx(h));
    }
    for (const j of reach)
      if (!waves.has(j)) {
        waves.set(j, w + 1);
        queue.push(j);
      }
  }
  const created = new Map<number, Cut>();
  const rank = { plain: 0, brilliant: 1, star: 2, prism: 3 };
  const put = (i: number, cut: Cut) => {
    if (rank[cut] > rank[created.get(i) ?? "plain"]) created.set(i, cut);
  };
  for (const r of rr) {
    if (r.cells.length >= 4) {
      const choices = pair
        ? r.cells.filter((i) => i === idx(pair.a) || i === idx(pair.b))
        : [];
      put(
        choices[0] ?? r.cells[Math.floor((r.cells.length - 1) / 2)],
        r.cells.length >= 5 ? "prism" : "brilliant",
      );
    }
    for (const t of rr)
      if (t.vertical !== r.vertical)
        for (const i of r.cells) if (t.cells.includes(i)) put(i, "star");
  }
  const points = [...waves.keys()].reduce(
    (n, i) =>
      n +
      (cells[i].strain === C.MAX_STRAIN ? C.FLAWED_SCORE : C.BASE_SCORE) *
        Math.min(s.chainStep, C.MAX_MULTIPLIER),
    0,
  );
  const remaining: (GemState | null)[] = cells.map((g, i) => {
    if (waves.has(i)) return null;
    const strain = [...waves.keys()].some((j) => adjacent(g, cells[j]))
      ? Math.min(C.MAX_STRAIN, g.strain + 1)
      : g.strain;
    return { ...g, strain, fell: 0 };
  });
  for (const [i, cut] of created)
    remaining[i] = {
      ...cells[i],
      cut,
      kind: cut === "prism" ? null : cells[i].kind,
      strain: 0,
      fell: 0,
    };
  const settled: GemState[] = Array<GemState>(cells.length);
  for (let col = 0; col < C.GRID_COLS; col++) {
    const survivors = remaining.filter(
      (g): g is GemState => g !== null && g.col === col,
    );
    const empty = C.GRID_ROWS - survivors.length;
    for (let row = 0; row < C.GRID_ROWS; row++) {
      const g = survivors[row - empty];
      settled[row * C.GRID_COLS + col] = g
        ? { ...g, row, fell: row - g.row }
        : {
            col,
            row,
            kind:
              C.GEM_KINDS[letters.indexOf(s.refillKinds[col][row])] ??
              C.GEM_KINDS[Math.floor(Math.random() * C.GEM_KIND_COUNT)],
            cut: "plain",
            strain: 0,
            fell: empty,
          };
    }
  }
  return {
    ...s,
    board: { ...s.board, cells: settled },
    stepTimer: 0,
    lastCleared: waves.size,
    lastPoints: points,
    lastWaves: Math.max(0, ...waves.values()),
    score: s.score + points,
    levelScore: s.levelScore + points,
    moveScore: s.moveScore + points,
    bestChain: Math.max(s.bestChain, s.chainStep),
    visualStep: {
      removed: [...waves].map(([i, wave]) => ({ gem: cells[i], wave })),
      created: [...created.keys()].map(ref),
    },
  };
}
export function advance(
  s: ReadState,
  dt: number,
  onEvent: (cue: string) => void = () => {},
): FacetState {
  let n: FacetState = { ...s, simTime: s.simTime + dt };
  if (n.screen !== "playing") return n;
  if (n.refusal)
    n = {
      ...n,
      refusal:
        n.refusal.timer + dt >= C.REFUSAL_SECONDS
          ? null
          : { ...n.refusal, timer: n.refusal.timer + dt },
    };
  let time = dt;
  let limit = 0;
  while (time > 0 && limit++ < 1000) {
    if (n.phase === "idle") break;
    if (n.phase === "swapping") {
      const use = Math.min(time, C.SWAP_SECONDS - n.swapTimer);
      n = { ...n, swapTimer: n.swapTimer + use };
      time -= use;
      if (n.swapTimer >= C.SWAP_SECONDS - 1e-9) {
        const old = n;
        n = resolve({ ...n, phase: "resolving", chainStep: 1, swapTimer: 0 });
        events(old, n, onEvent);
      }
    } else {
      const hold = stepHold(n),
        land = hold - C.STEP_SECONDS;
      const use = Math.min(time, hold - n.stepTimer);
      if (
        n.stepTimer < land &&
        n.stepTimer + use >= land &&
        lastFall(n) > C.LAND_MIN_ROWS
      )
        onEvent(C.CUES.land);
      n = { ...n, stepTimer: n.stepTimer + use };
      time -= use;
      if (n.stepTimer >= hold - 1e-9) {
        if (runs(n.board.cells).length) {
          const old = n;
          n = resolve({ ...n, chainStep: n.chainStep + 1 });
          events(old, n, onEvent);
        } else {
          n = {
            ...n,
            phase: "idle",
            chainStep: 0,
            stepTimer: 0,
            bestMove: Math.max(n.bestMove, n.moveScore),
            visualStep: null,
          };
          if (n.levelScore >= C.LEVEL_TARGET_STEP * n.level) {
            n = changeScreen(n, "levelclear");
            onEvent(C.CUES.levelUp);
          } else if (!legal(n)) {
            n = changeScreen(n, "gameover");
            onEvent(C.CUES.gameOver);
          }
          if (n.screen !== "playing") break;
        }
      }
    }
  }
  return n;
}
function events(old: ReadState, n: ReadState, emit: (cue: string) => void) {
  emit(C.CUES.clear);
  if (n.visualStep?.created.length) emit(C.CUES.cut);
  const removed = n.visualStep?.removed.map((v) => v.gem) ?? [];
  if (
    old.board.cells.some(
      (g) =>
        g.strain === C.MAX_STRAIN - 1 &&
        !removed.some((h) => idx(h) === idx(g)) &&
        removed.some((h) => adjacent(g, h)),
    )
  )
    emit(C.CUES.flaw);
}
export function targets(s: ReadState) {
  if (s.screen === "playing")
    return [{ id: "pause", x: 1060, y: 34, w: 160, h: C.TARGET_MIN_H }];
  if (s.screen === "howto")
    return [{ id: "back", x: 1060, y: 610, w: 160, h: C.TARGET_MIN_H }];
  return [0, 1].map((i) => ({
    id: `menu-${i}`,
    x: 470,
    y: 388 + i * 94,
    w: 340,
    h: C.TARGET_MIN_H,
  }));
}
export function changeScreen(s: ReadState, screen: Screen): FacetState {
  return { ...s, screen, menuIndex: 0, armedTarget: null };
}
function quit(s: ReadState): FacetState {
  return {
    ...changeScreen(s, "title"),
    board: { cols: 0, rows: 0, cells: [] },
    phase: "idle",
    chainStep: 0,
    swapTimer: 0,
    stepTimer: 0,
    selection: null,
    offer: null,
    refusal: null,
    visualStep: null,
    swapPair: null,
  };
}
export function choose(s: ReadState): FacetState {
  if (s.screen === "title")
    return s.menuIndex === 0
      ? {
          ...deal({
            ...initial(s.muted),
            images: s.images,
            effects: s.effects,
          }),
          screen: "playing",
          simTime: s.simTime,
          dealAt: s.simTime,
        }
      : changeScreen(s, "howto");
  if (s.screen === "paused")
    return s.menuIndex === 0 ? changeScreen(s, "playing") : quit(s);
  if (s.screen === "levelclear")
    return s.menuIndex === 0
      ? {
          ...deal(s),
          screen: "playing",
          menuIndex: 0,
          level: s.level + 1,
          levelScore: 0,
          bestMove: 0,
          bestChain: 0,
          selection: null,
          offer: null,
          armedTarget: null,
          dealAt: s.simTime,
        }
      : quit(s);
  if (s.screen === "gameover")
    return s.menuIndex === 0
      ? {
          ...deal({
            ...initial(s.muted),
            images: s.images,
            effects: s.effects,
          }),
          screen: "playing",
          simTime: s.simTime,
          dealAt: s.simTime,
        }
      : quit(s);
  return { ...s };
}
function hit(s: ReadState, x: number, y: number) {
  return targets(s).find(
    (t) => x >= t.x && y >= t.y && x <= t.x + t.w && y <= t.y + t.h,
  );
}
function hitCell(s: ReadState, x: number, y: number) {
  let best: CellRef | null = null,
    d = C.GEM_HIT_R ** 2;
  for (const g of s.board.cells) {
    const dd = (cellX(g.col) - x) ** 2 + (cellY(g.row) - y) ** 2;
    if (dd <= d && (!best || dd < d)) {
      best = { col: g.col, row: g.row };
      d = dd;
    }
  }
  return best;
}
export function pointerEvent(
  s: ReadState,
  type: "down" | "move" | "up",
  x: number,
  y: number,
  device: PointerDevice = "mouse",
): FacetState {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !["mouse", "pen", "touch"].includes(device)
  )
    throw new Error("Facet: invalid pointer");
  let n: FacetState = {
    ...s,
    pointer: {
      x,
      y,
      device,
      down: type === "down" ? true : type === "up" ? false : s.pointer.down,
    },
  };
  const t = hit(n, x, y);
  if (type === "down") {
    n = { ...n, armedTarget: t?.id ?? null };
    if (t?.id.startsWith("menu"))
      n = { ...n, menuIndex: Number(t.id.slice(5)) };
    if (!t && n.screen === "playing") {
      const p = hitCell(n, x, y);
      if (p && n.selection && adjacent(p, n.selection)) n = { ...n, offer: p };
      else n = { ...n, selection: p, offer: null };
    }
  } else if (type === "move") {
    if (t?.id.startsWith("menu") && !n.pointer.down)
      n = { ...n, menuIndex: Number(t.id.slice(5)) };
    if (n.screen === "playing" && n.pointer.down && n.selection) {
      const p = hitCell(n, x, y);
      if (p && idx(p) === idx(n.selection)) n = { ...n, offer: null };
      else if (p && adjacent(p, n.selection)) n = { ...n, offer: p };
    }
  } else {
    const armed = n.armedTarget;
    n = { ...n, armedTarget: null };
    if (t && t.id === armed) {
      if (t.id === "pause") n = changeScreen(n, "paused");
      else if (t.id === "back")
        n = { ...changeScreen(n, "title"), menuIndex: 1 };
      else n = choose({ ...n, menuIndex: Number(t.id.slice(5)) });
    } else if (n.screen === "playing" && n.selection && n.offer)
      n = { ...request(n, n.selection, n.offer), selection: null, offer: null };
  }
  return n;
}
export function snapshot(s: ReadState) {
  return {
    version: C.FACET_DEBUG_VERSION,
    screen: s.screen,
    menuIndex: s.menuIndex,
    score: s.score,
    level: s.level,
    levelScore: s.levelScore,
    levelTarget: C.LEVEL_TARGET_STEP * s.level,
    phase: s.phase,
    chainStep: s.chainStep,
    multiplier: Math.min(s.chainStep, C.MAX_MULTIPLIER),
    swapTimer: s.swapTimer,
    stepTimer: s.stepTimer,
    stepHold: stepHold(s),
    board: {
      ...s.board,
      cells: s.board.cells.map((g) => ({
        ...g,
        x: cellX(g.col),
        y: cellY(g.row),
      })),
    },
    selection: s.selection,
    offer: s.offer,
    refusal: s.refusal ? { a: s.refusal.a, b: s.refusal.b } : null,
    lastCleared: s.lastCleared,
    lastPoints: s.lastPoints,
    lastWaves: s.lastWaves,
    lastFall: lastFall(s),
    moveScore: s.moveScore,
    bestMove: s.bestMove,
    bestChain: s.bestChain,
    legalSwap: legal(s),
    refillKinds: [...s.refillKinds],
    pointer: { ...s.pointer },
    armedTarget: s.armedTarget,
    targets: targets(s),
    muted: s.muted,
    simTime: s.simTime,
  };
}
export const debug = {
  version: C.FACET_DEBUG_VERSION,
  reset: (s: ReadState) => ({
    ...initial(s.muted),
    images: s.images,
    effects: s.effects,
  }),
  reconcile: (s: ReadState): FacetState => ({ ...s }),
  snapshot,
  setScreen: (s: ReadState, screen: Screen): FacetState => {
    if (
      ![
        "title",
        "howto",
        "playing",
        "paused",
        "levelclear",
        "gameover",
      ].includes(screen)
    )
      throw new Error("Facet: invalid screen");
    return { ...s, screen };
  },
  setMenuIndex: (s: ReadState, index: number): FacetState => ({
    ...s,
    menuIndex: integer(index),
  }),
  loadBoard: (s: ReadState, rows: readonly string[]): FacetState => {
    if (rows.length !== C.GRID_ROWS) throw new Error("Facet: invalid rows");
    const cells = rows.flatMap((r, row) => {
      const ts = r.trim().split(/\s+/);
      if (ts.length !== C.GRID_COLS) throw new Error("Facet: invalid columns");
      return ts.map((t, col) => token(t, { col, row }));
    });
    return { ...s, board: { cols: C.GRID_COLS, rows: C.GRID_ROWS, cells } };
  },
  dealBoard: deal,
  clearBoard: (s: ReadState): FacetState => ({
    ...s,
    board: { cols: 0, rows: 0, cells: [] },
  }),
  setGem: (s: ReadState, col: number, row: number, t: string): FacetState => {
    const p = cell(col, row);
    if (!s.board.cells[idx(p)]) throw new Error("Facet: no gem");
    return {
      ...s,
      board: {
        ...s.board,
        cells: s.board.cells.map((g, i) => (i === idx(p) ? token(t, p) : g)),
      },
    };
  },
  setRefillKinds: (s: ReadState, col: number, kinds: string): FacetState => {
    integer(col, 0, C.GRID_COLS - 1);
    if (!/^[RACJBSM]*$/.test(kinds)) throw new Error("Facet: invalid kinds");
    return {
      ...s,
      refillKinds: s.refillKinds.map((k, i) => (i === col ? kinds : k)),
    };
  },
  clearRefillKinds: (s: ReadState): FacetState => ({
    ...s,
    refillKinds: Array<string>(C.GRID_COLS).fill(""),
  }),
  setScore: (s: ReadState, points: number): FacetState => ({
    ...s,
    score: integer(points),
  }),
  setLevel: (s: ReadState, level: number): FacetState => ({
    ...s,
    level: integer(level, 1),
  }),
  setLevelScore: (s: ReadState, points: number): FacetState => ({
    ...s,
    levelScore: integer(points),
  }),
  setBestChain: (s: ReadState, chainStep: number): FacetState => ({
    ...s,
    bestChain: integer(chainStep),
  }),
  setBestMove: (s: ReadState, points: number): FacetState => ({
    ...s,
    bestMove: integer(points),
  }),
  setMoveScore: (s: ReadState, points: number): FacetState => ({
    ...s,
    moveScore: integer(points),
  }),
  setSelection: (s: ReadState, col: number, row: number): FacetState => ({
    ...s,
    selection: cell(col, row),
  }),
  clearSelection: (s: ReadState): FacetState => ({ ...s, selection: null }),
  setOffer: (s: ReadState, col: number, row: number): FacetState => ({
    ...s,
    offer: cell(col, row),
  }),
  clearOffer: (s: ReadState): FacetState => ({ ...s, offer: null }),
  clearRefusal: (s: ReadState): FacetState => ({ ...s, refusal: null }),
  clearChain: (s: ReadState): FacetState => ({
    ...s,
    phase: "idle",
    chainStep: 0,
    swapTimer: 0,
    stepTimer: 0,
    visualStep: null,
  }),
  requestSwap: (s: ReadState, ca: number, ra: number, cb: number, rb: number) =>
    request(s, cell(ca, ra), cell(cb, rb)),
  pointerDown: (
    s: ReadState,
    x: number,
    y: number,
    d: PointerDevice = "mouse",
  ) => pointerEvent(s, "down", x, y, d),
  pointerMove: (
    s: ReadState,
    x: number,
    y: number,
    d: PointerDevice = "mouse",
  ) => pointerEvent(s, "move", x, y, d),
  pointerUp: (s: ReadState, d: PointerDevice = "mouse") =>
    pointerEvent(s, "up", s.pointer.x, s.pointer.y, d),
};
