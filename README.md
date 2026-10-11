# Facet

A browser puzzle about cut gems and accumulated pressure. Swap neighboring stones into lines, build strain around each clear, and set off flawed stones for double points. Earn brilliants, stars, and prisms to carry a move across the board. Reach each level's target; the round ends when no productive swap remains.

## Run

Requires Node.js 22 or newer.

```sh
npm ci
npm run dev
```

For a self-contained static release:

```sh
npm run build
npm run preview
```

Serve `dist/` on any static server, at the root or a sub-path. All graphics, particle systems, sounds, and music are committed under `public/assets/`; building requires no asset authoring tools or external services.

## Controls

Use a mouse, pen, or finger. Press a stone, drag it onto an orthogonal neighbor, and release to swap. You can also press a stone, release, then press and release its neighbor. Drag back to the selected stone to cancel the offer.

Menus work by pressing and releasing their buttons, or with ↑ / ↓ and Enter / Space. P or Escape pauses and resumes. Escape returns from the instructions and the end of a round. M toggles all sound.

## Checks

```sh
npm run typecheck
npm run lint
npm run format
npm test
```

The immutable simulation, immediate debug poses, and rendering are separated into `src/logic.ts`, `src/game.ts`, and `src/visual.ts`. The supplied Simple 2D engine owns timing, input, assets, audio, canvas fitting, diagnostics, and recording. Tests cover board generation, swap acceptance, chain expansion, scoring, special cuts, refills, menus, and pause timing.

The original pixel sprites were rasterized with `draw`, and the fracture and prism sequences with `draw-sheet`. The four live effects were authored with `particle-2d`. Event sounds and the ascending chain tones were produced with `sfx-synth`, the glass shatter with `sfx-sample`, and both music pieces with `music` using the gm-lite bank. The MIDI scores ship beside their WAV mixes. Canvas code supplies the interface and composites the live particle simulator.

`showcase/` contains captured screens and an engine-recorded chain replay, together with the player-facing description and carousel manifest.
