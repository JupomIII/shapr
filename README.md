# SHAPR

A touch-first, pencil-first parametric CAD workspace that runs entirely in the browser as a
static site. No backend, no accounts, no paid services, no CAD licence.

Open it on an iPad, pick up the Apple Pencil, sketch on a plane, and drag the profile into a solid.
Everything below runs locally: the geometry kernel, the constraint solver, the feature tree and
project storage.

## The modelling workflow

Modelled on Shapr3D and SolidWorks, so the next action is always at the geometry:

1. **Sketch** → tap a plane or a flat face. The camera turns to meet the plane.
2. Draw a closed shape, then **Finish sketch**.
3. The finished profile stays selected and grows an **arrow on the profile**.
4. **Drag the arrow** for a live extrusion, or **tap it** to open the value field and type a number.
   The dimension chip next to it edits the same feature semantically (−, value, +, ✓, ✕).
5. **Tap empty space** to confirm — the feature lands in the history and stays editable.

A selected **face** gets the same arrow for offset / push-pull, a selected **edge** gets a fillet
handle, and the left dock mirrors those actions for anyone who prefers buttons.

## What is implemented

**Workspace / interaction**

- Three.js (WebGL2) viewport with a dark graphite workspace, perspective and orthographic cameras,
  grid, axes, view cube and animated view presets.
- Explicit input split: Apple Pencil / mouse build geometry, fingers navigate. A pen stroke can
  never turn into a camera gesture and a finger drag never creates geometry.
- **Finger-only fallback**: until a pen is used in the session, a single finger draws in a sketch and
  drags profiles and faces directly; empty space still orbits and two fingers still pan, zoom and
  twist. As soon as a Pencil touches the screen, fingers go back to navigation only.
- Gestures: 1-finger orbit, 2-finger pan / pinch zoom / twist, long-press drag box selection,
  double tap to focus (finger) or select a body (pencil), 3-finger swipe undo / redo.
- Palm rejection: while a pen is down, single touch contacts are ignored; intentional two-finger
  navigation still works, so you can orbit with your free hand while drawing.
- Pointer Events with pen pressure / tilt fields captured, coalesced events used for smooth
  strokes, pointer capture, and `touch-action: none` to stop scrolling, text selection and callouts.
- Pre-selection hover highlighting, face / edge / body selection, contextual action bar.

**Sketching**

- Sketch on XY / XZ / YZ or any planar face. Entering a sketch turns the camera to face the plane.
- Tools: line, connected polyline, rectangle, circle, three-point arc, spline, and freehand
  automatic shape recognition (rectangle / circle / line / arc / spline).
- Automatic Line/Arc: a quick side-to-side wrist shake while drawing switches the segment to an arc.
- Snapping to endpoints, midpoints, centres, the grid, plus horizontal / vertical / parallel /
  perpendicular inference.
- Automatic constraints on creation (H/V, dimensions for rectangles and circles).
- A real constraint solver (Levenberg–Marquardt on numeric Jacobians) that moves geometry:
  coincident, horizontal, vertical, parallel, perpendicular, tangent, equal, concentric, fixed,
  distance, length, angle, radius, diameter. Degree-of-freedom counting reports constrained state.
- Dimension chips edit the *actual* geometry: tap an edge or circle, type 50, and the profile
  becomes exactly 50 mm.

**Solid modelling (real B-rep, not mesh dressing)**

- Planar B-rep kernel: faces with outer and inner loops in world space, exact volume / area /
  centroid / bounding box computed from topology.
- Extrude (new body, join, cut, intersect, through-all), revolve, push/pull (offset face),
  chamfer and fillet, mirror, linear and circular patterns.
- Booleans via BSP CSG with coplanar-face merging and T-junction removal, so result bodies have
  clean faces with holes rather than triangle soup.
- Chamfer is an exact single planar cut; fillet approximates the true cylinder with tangent planes
  (8 facets by default, adjustable) and is validated: a 2 mm fillet on a 50×30×20 box yields
  29983.03 mm³ against an analytic 29982.83 mm³.
- Half-space cuts are restricted to the edge neighbourhood, so a fillet cannot eat unrelated
  features elsewhere in the body.
- Direct manipulation: drag a profile to extrude, drag a face to offset it, drag while a fillet is
  pending to change the radius. Every operation shows a live preview and an editable numeric chip.

**Parametric history**

- Ordered feature tree with per-feature errors (missing sketch, edge no longer exists, empty result),
  visibility, suppression, rename, delete, parameter editing and rollback.
- Features reference geometry by position (edge midpoint, face plane + point) and re-resolve it on
  every evaluation, so editing an earlier sketch or dimension rebuilds everything downstream.
- Command history: every edit is a reversible document snapshot (undo / redo via buttons, keyboard
  and three-finger swipe).

**Storage, import / export**

- Projects in IndexedDB (autosave, manual save, rename, duplicate, delete, recent list, thumbnails).
  The document is serialized as parametric data — never as a Three.js scene.
- Export: STL (binary), OBJ, STEP (AP214 faceted B-rep), DXF and SVG of sketches.
- Import: STL and OBJ meshes as dumb bodies.

**Deployment**

- Vite build with a relative base, so it works from any GitHub Pages sub-path.
- PWA manifest, generated PNG icons, service worker caching the app shell and assets for offline use
  after the first visit.

## Interface design

The visual language follows Shapr3D's iPad app rather than a generic dark web UI: a graphite
workspace, compact floating controls, and a single restrained blue accent.

- **Design tokens** in `src/styles.css`: workspace and surface values (`--vp`, `--s1…--s3`), line
  weights, three text levels, accent/soft-accent, radii and one motion curve. Every component reads
  from them, so the palette can be retuned in one place.
- **Layout is docks, not bars.** The viewport is full-bleed. A centred top cluster holds the project
  name, overflow menu and the one primary action; the left dock is a list of circular tool buttons
  with quiet labels (tools in modelling mode, sketch tools while sketching, contextual actions for a
  selected face / edge / body / profile); the right dock has the view cube, unit switcher, settings
  and History; the bottom holds undo/redo, fit, grid and a centred measurement line
  (`1 body · 17 672 mm² · 131 040 mm³`).
- **Panels float** beside the view cube instead of reserving viewport width, and close with `Esc`.
  The project sheet is a centred overlay in the same style.
- **Motion** is 130–180 ms with one ease-out curve, used only for panels, popovers, chips and the
  active-tool label. Nothing bounces; `prefers-reduced-motion` collapses every transition.
- **Typography** is the system sans (SF Pro on Apple platforms) at 11–13.5 px, with tabular numerals
  in every numeric field, dimension chip and measurement so values don't jitter while dragging.
- **Viewport look**: light neutral bodies with thin dark edges, crease-filtered edge rendering (so
  tessellated cylinders and fillets read as smooth silhouettes instead of a wireframe mess), a
  restrained two-weight grid with quiet axes, and blue face/edge/body selection overlays.

## Architecture

```
src/
  kernel/        geometry kernel (no rendering, no React)
    vec.ts       vector math
    csg.ts       BSP CSG + half-space clipping
    solid.ts     planar B-rep, triangle<->B-rep rebuild, edges, measurement
    ops.ts       extrude, revolve, booleans, chamfer, fillet, push/pull, patterns
    exporters.ts STL / OBJ / STEP / DXF / SVG writers, STL / OBJ readers
  sketch/
    types.ts     points + entities + constraints
    geometry.ts  sampling, loop detection, regions, hit testing, snapping
    solver.ts    constraint solver (LM + numeric Jacobian, DOF analysis)
    create.ts    authoring helpers and freehand shape recognition
  model/
    types.ts     serializable document (sketches + features)
    evaluate.ts  deterministic feature evaluation, geometry re-resolution
  state/         store, history, pending operations, high-level commands
  input/         gesture state machine + interaction controller
  render/        Three.js viewport (rendering, picking, camera)
  ui/            floating bars, panels, chips, icons
  storage/       IndexedDB
```

The kernel is deliberately independent of the renderer: only the viewport turns solids into
meshes, and interaction geometry (screen-space edge picking, plane projection) stays in the
interaction layer.

## Key trade-offs

- **No OCCT / opencascade.js.** OCCT is the right answer for production-grade B-rep, but its WASM
  build is tens of megabytes, needs careful MIME/caching handling on GitHub Pages, and its API
  surface would dominate a personal project. Instead this implements a focused planar B-rep with
  BSP booleans: exact for prismatic parts, tessellated for revolves and fillets. The trade-off is
  honest: curved surfaces are facet approximations and STEP output is a faceted B-rep.
- **No WebAssembly yet.** Sketches and feature evaluation are small enough that the JS kernel stays
  interactive; CSG is the expensive part and is throttled during drags. A WASM worker for booleans
  is the natural next step for large models.
- **Snapshot history.** Undo stores document snapshots (cheap, parametric) rather than inverse
  commands; it is fully reversible and simple to reason about.
- **Fillet as tangent planes.** It is a tessellation of the real fillet cylinder, not a bevel: every
  facet is tangent to the true surface, so volume and silhouette converge as facets increase.

## Limitations (visible in the UI as unavailable)

- Loft, sweep, shell, draft, split body / split face, 3MF export and STEP/DXF import are **not**
  implemented. Buttons for these are disabled and labelled as unavailable; nothing pretends to work.
- Fillets require a convex edge between two planar faces; concave and freeform edges are rejected
  with a feature error instead of producing bad geometry.
- Revolve and fillet surfaces are tessellated, so exported STEP files describe facets.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
node scripts/kernel-check.ts   # (bundled with esbuild) kernel numeric checks
```

The kernel self-check prints analytic-vs-computed volumes for extrusion, booleans, chamfer, fillet,
revolve, push/pull and STEP size:

```bash
npx esbuild scripts/kernel-check.ts --bundle --platform=node --format=esm --outfile=tmp/k.mjs
node tmp/k.mjs
```

### GitHub Pages

Live at **https://jupomiii.github.io/shapr/** — open it in Safari on the iPad and use Share →
“Add to Home Screen” to install it as a standalone, offline-capable app.

`.github/workflows/deploy.yml` builds on push to `main` and deploys `dist` via the Pages actions
(Pages → Source: GitHub Actions). The build uses `base: './'`, so no repository-name configuration
is needed.

## Verification performed

Automated (kernel, node):

- Extrude 50×30×20 box: volume 30000.000, area 6200.000, 6 faces.
- Boolean cut of a 64-facet cylinder: 28431.73 mm³ against 28429.20 analytic; faces merge to 70.
- Chamfer 2 mm: 29960.00 (analytic 29960.00). Fillet 2 mm: 29983.03 (analytic 29982.83).
- Localized fillet on a two-body solid: 47983.03 (analytic 47982.83) — the far body is untouched.
- Revolve: 9409.6 vs 9424.8 analytic (facet error). Push/pull face: 35000 as expected.
- STEP/STL writers produce non-empty, structurally valid files.

In the running app (Chromium, synthetic pointer input through the real input pipeline):

- Sketch on XY via the rail, draw a rectangle by press-drag-release: shared points, H/V constraints.
- Tap a profile selects the region; drag creates a live extrusion preview; the numeric chip shows the
  value and Apply commits a 6-face body with the exact volume.
- Dimension edit rebuilt geometry: setting the bottom edge to 60 mm produced a 60 mm wide body.
- Fillet from the contextual bar: 2 mm applied with preview, feature tree shows no error.
- Extrude of a selected region only builds that region (not every profile in the sketch).
- Save / reload: project list, features and thumbnails restored from IndexedDB.
- No console errors during the flows.

Visual review: the redesigned interface was rendered in Chromium at desktop and tablet sizes and
inspected in the modelling, selection, sketch and history-panel states (`shots/`, git-ignored). This
is a layout check, not a hardware check.

**Not verified:** real iPad / Apple Pencil hardware, Safari-specific palm rejection and Pencil Pro
behaviours, offline installation via Add to Home Screen, and the GitHub Pages deployed URL. Those
require physical hardware and a published repository and are not claimed to work.
