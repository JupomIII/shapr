import { useEffect, useMemo, useRef } from 'react';
import { Viewport } from '../render/Viewport';
import { viewportRef } from '../render/viewportRef';
import { InteractionController } from '../input/controller';
import * as S from '../state/store';
import * as OPS from '../state/ops';
import { EmptyHint, Rail, StatusRight, Toast, TopBar, ViewCubeOverlay } from './Bars';
import { PendingChip, SketchDimensionChip } from './Chips';
import { SelectionGizmo } from './Gizmos';
import { SketchBadges } from './SketchBadges';
import { sketchDiagnostics } from '../sketch/diagnostics';
import { FeaturePanel, HelpPanel, MeasurePanel, ProjectsPanel } from './Panels';

export default function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<InteractionController | null>(null);
  const fittedRef = useRef(false);
  const s = S.useApp();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const vp = new Viewport(host);
    viewportRef.current = vp;
    const controller = new InteractionController(vp);
    controllerRef.current = controller;
    S.setThumbnailProvider(() => vp.captureThumbnail());
    vp.setView('iso');
    vp.fitAll([]);
    void S.refreshProjects();

    const onUnload = () => {
      void S.persist(false);
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      controller.dispose();
      vp.dispose();
      viewportRef.current = null;
      controllerRef.current = null;
    };
  }, []);

  /* ------------------------------ renderer sync ----------------------------- */

  useEffect(() => {
    viewportRef.current?.setBodies(s.evalResult.bodies, s.geometryVersion);
    if (!fittedRef.current && s.evalResult.bodies.length) {
      fittedRef.current = true;
      viewportRef.current?.fitAll(s.evalResult.bodies);
    }
  }, [s.evalResult, s.geometryVersion]);

  useEffect(() => {
    viewportRef.current?.setSelection(s.selection, s.hover);
  }, [s.selection, s.hover, s.evalResult]);

  useEffect(() => {
    viewportRef.current?.setPreview(s.pending?.preview ?? []);
  }, [s.pending?.preview, s.pending?.value, s.pending?.kind]);

  const visibleSketches = s.doc.sketches.filter(
    (sk) => s.visibleSketchIds.includes(sk.id) || sk.id === s.activeSketchId,
  );

  // Constraint state of the sketch being edited: drives the colour of the
  // geometry, the open-end markers and the status readout.
  const activeSketch = s.doc.sketches.find((sk) => sk.id === s.activeSketchId) ?? null;
  const diag = useMemo(
    () => (activeSketch ? sketchDiagnostics(activeSketch) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeSketch?.id, s.geometryVersion],
  );

  useEffect(() => {
    const selectedEntity = s.selection.find((x) => x.kind === 'sketchEntity')?.entityId ?? null;
    viewportRef.current?.setSketch(
      visibleSketches,
      s.activeSketchId,
      selectedEntity,
      diag ? { fullyDefined: diag.fullyDefined, open: diag.open.map((o) => o.p) } : null,
    );
  }, [s.doc.sketches, s.activeSketchId, s.visibleSketchIds, s.selection, diag]);

  useEffect(() => {
    viewportRef.current?.setGridVisible(s.showGrid);
  }, [s.showGrid]);

  // Entering a sketch turns the camera to face the sketch plane.
  const lastSketchRef = useRef<string | null>(null);
  useEffect(() => {
    if (!s.activeSketchId || s.activeSketchId === lastSketchRef.current) return;
    lastSketchRef.current = s.activeSketchId;
    const sk = s.doc.sketches.find((x) => x.id === s.activeSketchId);
    if (sk) {
      viewportRef.current?.lookAtPlane(
        sk.plane.n as [number, number, number],
        sk.plane.origin as [number, number, number],
      );
    }
  }, [s.activeSketchId, s.doc.sketches]);

  /* -------------------------------- keyboard -------------------------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) return;
      const meta = e.metaKey || e.ctrlKey;
      const state = S.store.state;

      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) S.redo();
        else S.undo();
        return;
      }
      if (meta && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        S.redo();
        return;
      }
      if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void S.persist(true);
        return;
      }
      if (e.key === 'Escape') {
        // Escape unwinds one level at a time, the way Shapr3D does: cancel the
        // operation, then the panel, then the drawing tool, then the selection.
        controllerRef.current?.cancel();
        if (state.pending) {
          S.cancelPending();
          return;
        }
        if (state.panel !== 'none') {
          S.store.set({ panel: 'none' });
          return;
        }
        if (state.mode === 'sketch' && state.sketchTool !== 'select') {
          S.store.set({ sketchTool: 'select', selection: [] });
          return;
        }
        if (state.selection.length) {
          S.setSelection([]);
          return;
        }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        OPS.deleteSelection();
        return;
      }
      if (meta) return;

      // Typing a number right after drawing sets that dimension (Onshape).
      if (state.mode === 'sketch' && /^[0-9.,]$/.test(e.key)) {
        const hasEntity = state.selection.some((x) => x.kind === 'sketchEntity');
        if (hasEntity) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('shapr:dimension', { detail: { seed: e.key } }));
          return;
        }
      }

      switch (e.key.toLowerCase()) {
        case 'v':
          if (state.mode === 'sketch') S.store.set({ sketchTool: 'select' });
          else S.store.set({ mode: 'select', activeSketchId: null });
          break;
        case 's':
          if (state.mode === 'sketch') S.store.set({ sketchTool: 'spline' });
          else S.beginSketch('XY');
          break;
        case 'l':
          if (state.mode === 'sketch') S.store.set({ sketchTool: 'line' });
          break;
        case 'r':
          if (state.mode === 'sketch') S.store.set({ sketchTool: 'rect' });
          break;
        case 'c':
          if (state.mode === 'sketch') S.store.set({ sketchTool: 'circle' });
          break;
        case 'a':
          if (state.mode === 'sketch') S.store.set({ sketchTool: 'arc' });
          break;
        case 'p':
          if (state.mode === 'sketch') S.store.set({ sketchTool: 'auto' });
          break;
        case 'f':
          viewportRef.current?.fitAll(state.evalResult.bodies);
          break;
        case 'g':
          S.store.set({ showGrid: !state.showGrid });
          break;
        case 'h':
          S.store.set({ panel: state.panel === 'features' ? 'none' : 'features' });
          break;
        case '1':
          viewportRef.current?.setView('front', state.evalResult.bodies);
          break;
        case '2':
          viewportRef.current?.setView('back', state.evalResult.bodies);
          break;
        case '3':
          viewportRef.current?.setView('left', state.evalResult.bodies);
          break;
        case '4':
          viewportRef.current?.setView('right', state.evalResult.bodies);
          break;
        case '5':
          viewportRef.current?.setView('top', state.evalResult.bodies);
          break;
        case '6':
          viewportRef.current?.setView('bottom', state.evalResult.bodies);
          break;
        case '7':
          viewportRef.current?.setView('iso', state.evalResult.bodies);
          break;
        case 'enter':
          if (state.pending) S.confirmPending();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <div className="canvas-host" ref={hostRef} />
      <div className="hud">
        <TopBar />
        <Rail />
        <ViewCubeOverlay />
        <StatusRight diag={diag} />
        <EmptyHint />
        <SelectionGizmo />
        <SketchBadges />
        <PendingChip />
        <SketchDimensionChip />
        <Toast />
        {s.panel === 'features' && <FeaturePanel />}
        {s.panel === 'projects' && <ProjectsPanel />}
        {s.panel === 'measure' && <MeasurePanel />}
        {s.panel === 'help' && <HelpPanel />}
      </div>
    </div>
  );
}
