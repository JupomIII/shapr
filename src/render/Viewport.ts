// Three.js workspace. Rendering only: geometry comes from the B-rep kernel and
// is regenerated when the document changes.

import * as THREE from 'three';
import { Vec2, Vec3, add3, cross3, norm3, scale3, sub3 } from '../kernel/vec';
import {
  Edge,
  Solid,
  buildEdgeSegments,
  buildRenderData,
  faceTriangles,
  solidEdges,
  triangulateLoops,
} from '../kernel/solid';
import { Frame, to2D, to3D } from '../kernel/ops';
import { EvalBody } from '../model/evaluate';
import { SelectionItem } from '../state/store';
import { Sketch } from '../sketch/types';
import { regionContains, sampleEntity } from '../sketch/geometry';

export type ViewName =
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'iso'
  | 'fit';

export interface Hit {
  bodyId: string;
  faceIndex: number;
  point: Vec3;
  distance: number;
}

export interface DraftGeometry {
  plane: Frame;
  polylines?: Vec2[][];
  points?: Vec2[];
  snap?: { p: Vec2; label: string } | null;
  preview?: { loops: Vec2[][]; color?: string } | null;
  dims?: { a: Vec2; b: Vec2; text: string }[];
}

interface CameraState {
  target: THREE.Vector3;
  radius: number;
  theta: number;
  phi: number;
}

const COLORS = {
  bg: 0x17191d,
  body: 0xccd0d4,
  bodyEdge: 0x2b2f34,
  accent: 0x0a84ff,
  accentSoft: 0x2f8fdc,
  sketch: 0x6b737d,
  sketchActive: 0x35c7d8,
  grid: 0x23272d,
  gridMajor: 0x2e333b,
  axisX: 0x8f4a44,
  axisY: 0x4c7a50,
  axisZ: 0x44618c,
  preview: 0x0a84ff,
};

export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly persp: THREE.PerspectiveCamera;
  readonly ortho: THREE.OrthographicCamera;
  perspActive = true;
  up: Vec3 = [0, 0, 1];

  private container: HTMLElement;
  private bodyGroup = new THREE.Group();
  private highlightGroup = new THREE.Group();
  private sketchGroup = new THREE.Group();
  private draftGroup = new THREE.Group();
  private previewGroup = new THREE.Group();
  private helperGroup = new THREE.Group();
  private gridGroup = new THREE.Group();

  private bodyMeshes = new Map<string, { mesh: THREE.Mesh; edges: THREE.LineSegments; body: EvalBody }>();
  private edgeCache = new Map<string, Edge[]>();
  private cam: CameraState = {
    target: new THREE.Vector3(0, 0, 10),
    radius: 260,
    theta: -Math.PI * 0.28,
    phi: Math.PI * 0.32,
  };
  private anim: { from: CameraState; to: CameraState; start: number; duration: number } | null = null;
  private dirty = true;
  private raf = 0;
  private disposed = false;
  private resizeObs: ResizeObserver | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(COLORS.bg, 1);
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.bg);
    this.scene.add(this.gridGroup, this.bodyGroup, this.highlightGroup, this.sketchGroup, this.draftGroup, this.previewGroup, this.helperGroup);

    this.persp = new THREE.PerspectiveCamera(36, 1, 0.2, 12000);
    this.persp.up.set(0, 0, 1);
    this.ortho = new THREE.OrthographicCamera(-100, 100, 100, -100, -5000, 12000);
    this.ortho.up.set(0, 0, 1);

    const hemi = new THREE.HemisphereLight(0xdde5ee, 0x2a2f36, 1.25);
    const key = new THREE.DirectionalLight(0xffffff, 1.65);
    key.position.set(0.6, -1, 1.2);
    const fill = new THREE.DirectionalLight(0xc7d6e8, 0.6);
    fill.position.set(-1, 0.7, -0.6);
    this.scene.add(hemi, key, fill);

    this.buildGrid();
    this.resize();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.loop();
  }

  /* -------------------------------- lifecycle ------------------------------- */

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs?.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  get camera(): THREE.Camera {
    return this.perspActive ? this.persp : this.ortho;
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    const aspect = w / h;
    const height = 2 * this.cam.radius * Math.tan((this.persp.fov * Math.PI) / 360);
    this.ortho.left = (-height * aspect) / 2;
    this.ortho.right = (height * aspect) / 2;
    this.ortho.top = height / 2;
    this.ortho.bottom = -height / 2;
    this.ortho.updateProjectionMatrix();
    this.dirty = true;
  }

  private updateCamera() {
    const { target, radius, theta, phi } = this.cam;
    const sp = Math.sin(phi);
    const pos = new THREE.Vector3(
      target.x + radius * sp * Math.cos(theta),
      target.y + radius * sp * Math.sin(theta),
      target.z + radius * Math.cos(phi),
    );
    this.persp.position.copy(pos);
    this.persp.lookAt(target);
    this.ortho.position.copy(pos);
    this.ortho.lookAt(target);
    const h = this.container.clientHeight || 1;
    const w = this.container.clientWidth || 1;
    const height = 2 * radius * Math.tan((this.persp.fov * Math.PI) / 360);
    this.ortho.left = (-height * (w / h)) / 2;
    this.ortho.right = (height * (w / h)) / 2;
    this.ortho.top = height / 2;
    this.ortho.bottom = -height / 2;
    this.ortho.updateProjectionMatrix();
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.anim) {
      const t = Math.min(1, (performance.now() - this.anim.start) / this.anim.duration);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const a = this.anim.from;
      const b = this.anim.to;
      this.cam.target.lerpVectors(a.target, b.target, e);
      this.cam.radius = a.radius + (b.radius - a.radius) * e;
      let dTheta = b.theta - a.theta;
      while (dTheta > Math.PI) dTheta -= Math.PI * 2;
      while (dTheta < -Math.PI) dTheta += Math.PI * 2;
      this.cam.theta = a.theta + dTheta * e;
      this.cam.phi = a.phi + (b.phi - a.phi) * e;
      this.dirty = true;
      if (t >= 1) this.anim = null;
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
  };

  invalidate() {
    this.dirty = true;
  }

  /* ---------------------------------- grid --------------------------------- */

  private buildGrid() {
    this.gridGroup.clear();
    const size = 200;
    const step = 10;
    const positions: number[] = [];
    const major: number[] = [];
    for (let i = -size; i <= size; i += step) {
      const target = i % 50 === 0 ? major : positions;
      target.push(-size, i, 0, size, i, 0);
      target.push(i, -size, 0, i, size, 0);
    }
    const mk = (arr: number[], color: number, opacity: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
      return new THREE.LineSegments(g, m);
    };
    this.gridGroup.add(mk(positions, COLORS.grid, 0.7));
    this.gridGroup.add(mk(major, COLORS.gridMajor, 1));

    const axes: number[] = [
      -size, 0, 0, size, 0, 0,
      0, -size, 0, 0, size, 0,
    ];
    const axisGeo = new THREE.BufferGeometry();
    axisGeo.setAttribute('position', new THREE.Float32BufferAttribute(axes, 3));
    const axisColors: number[] = [];
    const addColor = (hex: number, times: number) => {
      const c = new THREE.Color(hex);
      for (let i = 0; i < times; i++) axisColors.push(c.r, c.g, c.b);
    };
    addColor(COLORS.axisX, 2);
    addColor(COLORS.axisY, 2);
    axisGeo.setAttribute('color', new THREE.Float32BufferAttribute(axisColors, 3));
    const axisLines = new THREE.LineSegments(
      axisGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }),
    );
    this.gridGroup.add(axisLines);
  }

  setGridVisible(visible: boolean) {
    this.gridGroup.visible = visible;
    this.invalidate();
  }

  /* --------------------------------- bodies -------------------------------- */

  private disposeGroup(group: THREE.Group) {
    for (const child of [...group.children]) {
      group.remove(child);
      child.traverse((obj) => {
        const any = obj as THREE.Mesh;
        if (any.geometry) any.geometry.dispose();
        const mat = (any as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
    }
  }

  setBodies(bodies: EvalBody[], version: number) {
    const keep = new Set(bodies.map((b) => `${b.id}:${version}`));
    for (const [key, entry] of this.bodyMeshes) {
      if (!keep.has(key.split('|')[0] + ':' + version) && !bodies.some((b) => b.id === entry.body.id)) {
        this.bodyMeshes.delete(key);
      }
    }
    this.disposeGroup(this.bodyGroup);
    this.bodyMeshes.clear();
    this.edgeCache.clear();

    for (const body of bodies) {
      if (body.hidden) continue;
      const data = buildRenderData(body.solid);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
      const mat = new THREE.MeshStandardMaterial({
        color: COLORS.body,
        metalness: 0.04,
        roughness: 0.55,
        flatShading: true,
        side: THREE.FrontSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.bodyId = body.id;
      mesh.userData.faceIds = data.faceIds;
      this.bodyGroup.add(mesh);

      const edgeGeo = new THREE.BufferGeometry();
      edgeGeo.setAttribute('position', new THREE.BufferAttribute(buildEdgeSegments(body.solid), 3));
      const edges = new THREE.LineSegments(
        edgeGeo,
        new THREE.LineBasicMaterial({ color: COLORS.bodyEdge, transparent: true, opacity: 0.7 }),
      );
      this.bodyGroup.add(edges);
      this.bodyMeshes.set(body.id, { mesh, edges, body });
      this.edgeCache.set(body.id, solidEdges(body.solid));
    }
    this.dirty = true;
  }

  private makeFaceMesh(solid: Solid, faceIndex: number, color: number, opacity: number): THREE.Mesh | null {
    const face = solid.faces[faceIndex];
    if (!face) return null;
    const tris = faceTriangles(face);
    if (!tris.length) return null;
    const positions = new Float32Array(tris.length * 9);
    tris.forEach((t, i) => {
      for (let k = 0; k < 3; k++) {
        positions[i * 9 + k * 3] = t[k][0];
        positions[i * 9 + k * 3 + 1] = t[k][1];
        positions[i * 9 + k * 3 + 2] = t[k][2];
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 3;
    return mesh;
  }

  private makeEdgeLine(edge: Edge, color: number, opacity = 1): THREE.Line {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([...edge.a, ...edge.b], 3));
    return new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: false }),
    );
  }

  setSelection(selection: SelectionItem[], hover: SelectionItem | null) {
    this.disposeGroup(this.highlightGroup);

    const bodyOf = (id?: string) => this.bodyMeshes.get(id ?? '')?.body;
    for (const sel of selection) {
      const body = bodyOf(sel.bodyId);
      if (!body) continue;
      if (sel.kind === 'face' && sel.faceIndex !== undefined) {
        const m = this.makeFaceMesh(body.solid, sel.faceIndex, COLORS.accent, 0.5);
        if (m) this.highlightGroup.add(m);
        // Outline the face boundary.
        const face = body.solid.faces[sel.faceIndex];
        if (face) {
          const pts: number[] = [];
          for (const loop of face.loops)
            for (let i = 0; i < loop.length; i++) {
              pts.push(...loop[i], ...loop[(i + 1) % loop.length]);
            }
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
          const line = new THREE.LineSegments(
            g,
            new THREE.LineBasicMaterial({ color: 0x8fc0ff, depthTest: false, transparent: true, opacity: 0.9 }),
          );
          line.renderOrder = 4;
          this.highlightGroup.add(line);
        }
      } else if (sel.kind === 'edge' && sel.edgeKey) {
        const edge = this.edgeCache.get(sel.bodyId ?? '')?.find((e) => e.key === sel.edgeKey);
        if (edge) {
          const line = this.makeEdgeLine(edge, 0x9ccbff);
          line.renderOrder = 5;
          this.highlightGroup.add(line);
        }
      } else if (sel.kind === 'body') {
        const mesh = this.bodyMeshes.get(sel.bodyId ?? '')?.mesh;
        if (mesh) {
          const clone = mesh.clone();
          clone.material = new THREE.MeshBasicMaterial({
            color: COLORS.accent,
            transparent: true,
            opacity: 0.22,
            depthWrite: false,
          });
          this.highlightGroup.add(clone);
        }
      }
    }

    if (hover && !selection.some((s) => s.kind === hover.kind && s.faceIndex === hover.faceIndex && s.edgeKey === hover.edgeKey && s.bodyId === hover.bodyId)) {
      const body = bodyOf(hover.bodyId);
      if (body) {
        if (hover.kind === 'edge' && hover.edgeKey) {
          const edge = this.edgeCache.get(hover.bodyId ?? '')?.find((e) => e.key === hover.edgeKey);
          if (edge) {
            const line = this.makeEdgeLine(edge, 0x6ea8e0, 0.9);
            line.renderOrder = 5;
            this.highlightGroup.add(line);
          }
        } else if (hover.kind === 'face' && hover.faceIndex !== undefined) {
          const m = this.makeFaceMesh(body.solid, hover.faceIndex, COLORS.accentSoft, 0.22);
          if (m) this.highlightGroup.add(m);
        }
      }
    }
    this.dirty = true;
  }

  setPreview(bodies: EvalBody[]) {
    this.disposeGroup(this.previewGroup);
    for (const body of bodies) {
      const data = buildRenderData(body.solid);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
      const mat = new THREE.MeshStandardMaterial({
        color: COLORS.preview,
        metalness: 0.1,
        roughness: 0.45,
        transparent: true,
        opacity: 0.62,
        flatShading: true,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 2;
      this.previewGroup.add(mesh);
      const edgeGeo = new THREE.BufferGeometry();
      edgeGeo.setAttribute('position', new THREE.BufferAttribute(buildEdgeSegments(body.solid), 3));
      this.previewGroup.add(
        new THREE.LineSegments(
          edgeGeo,
          new THREE.LineBasicMaterial({ color: 0xa9d2ff, transparent: true, opacity: 0.85 }),
        ),
      );
    }
    this.dirty = true;
  }

  /* --------------------------------- sketches ------------------------------- */

  setSketch(sketches: Sketch[], activeId: string | null, selectedEntityId?: string | null) {
    this.disposeGroup(this.sketchGroup);

    for (const sk of sketches) {
      const frame: Frame = {
        origin: sk.plane.origin as Vec3,
        u: sk.plane.u as Vec3,
        v: sk.plane.v as Vec3,
        n: sk.plane.n as Vec3,
      };
      const isActive = sk.id === activeId;
      const color = isActive ? COLORS.sketchActive : COLORS.sketch;

      // Faint plane fill for the active sketch.
      if (isActive) {
        const quad = [
          to3D(frame, [-120, -120]),
          to3D(frame, [120, -120]),
          to3D(frame, [120, 120]),
          to3D(frame, [-120, 120]),
        ];
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(quad.flat(), 3));
        g.setIndex([0, 1, 2, 0, 2, 3]);
        const mesh = new THREE.Mesh(
          g,
          new THREE.MeshBasicMaterial({
            color: 0x2b3a4d,
            transparent: true,
            opacity: 0.18,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        mesh.renderOrder = 1;
        this.sketchGroup.add(mesh);
      }

      const linePts: number[] = [];
      for (const e of sk.entities) {
        const poly = sampleEntity(sk, e, 0.3);
        for (let i = 0; i + 1 < poly.length; i++) {
          const a = to3D(frame, poly[i]);
          const b = to3D(frame, poly[i + 1]);
          linePts.push(...a, ...b);
        }
        if (e.kind === 'circle' && poly.length > 2) {
          linePts.push(...to3D(frame, poly[poly.length - 1]), ...to3D(frame, poly[0]));
        }
      }
      if (linePts.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(linePts, 3));
        const line = new THREE.LineSegments(
          g,
          new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: isActive ? 1 : 0.55,
            depthTest: false,
          }),
        );
        line.renderOrder = 4;
        this.sketchGroup.add(line);
      }

      // Sketch points.
      const pointPts: number[] = [];
      for (const id of Object.keys(sk.points)) {
        const p = sk.points[id];
        if (p) pointPts.push(...to3D(frame, p));
      }
      if (pointPts.length && isActive) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pointPts, 3));
        const pts = new THREE.Points(
          g,
          new THREE.PointsMaterial({ color: 0xdfe6ee, size: 3.5, sizeAttenuation: false }),
        );
        pts.renderOrder = 5;
        this.sketchGroup.add(pts);
      }

      if (selectedEntityId) {
        const e = sk.entities.find((x) => x.id === selectedEntityId);
        if (e) {
          const poly = sampleEntity(sk, e, 0.25);
          const pts: number[] = [];
          for (let i = 0; i + 1 < poly.length; i++) pts.push(...to3D(frame, poly[i]), ...to3D(frame, poly[i + 1]));
          if (e.kind === 'circle' && poly.length > 2) pts.push(...to3D(frame, poly[poly.length - 1]), ...to3D(frame, poly[0]));
          if (pts.length) {
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
            const line = new THREE.LineSegments(
              g,
              new THREE.LineBasicMaterial({ color: COLORS.accent, depthTest: false }),
            );
            line.renderOrder = 6;
            this.sketchGroup.add(line);
          }
        }
      }
    }

    this.dirty = true;
  }

  setDraft(draft: DraftGeometry | null) {
    this.disposeGroup(this.draftGroup);
    if (draft) {
      const frame = draft.plane;
      const mkLines = (polylines: Vec2[][], color: number, closed = false, opacity = 1) => {
        const pts: number[] = [];
        for (const poly of polylines) {
          const n = closed ? poly.length : poly.length - 1;
          for (let i = 0; i < n; i++) {
            pts.push(...to3D(frame, poly[i]), ...to3D(frame, poly[(i + 1) % poly.length]));
          }
        }
        if (!pts.length) return;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        const line = new THREE.LineSegments(
          g,
          new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: false }),
        );
        line.renderOrder = 7;
        this.draftGroup.add(line);
      };

      if (draft.polylines?.length) mkLines(draft.polylines, COLORS.accent);
      if (draft.preview?.loops?.length) mkLines(draft.preview.loops, 0x66a8ff, true, 0.9);

      if (draft.points?.length) {
        const pts: number[] = [];
        for (const p of draft.points) pts.push(...to3D(frame, p));
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        const points = new THREE.Points(
          g,
          new THREE.PointsMaterial({ color: 0xffd479, size: 6, sizeAttenuation: false }),
        );
        points.renderOrder = 8;
        this.draftGroup.add(points);
      }

      if (draft.snap) {
        const p = to3D(frame, draft.snap.p);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
        const dot = new THREE.Points(
          g,
          new THREE.PointsMaterial({ color: 0x56d364, size: 9, sizeAttenuation: false }),
        );
        dot.renderOrder = 9;
        this.draftGroup.add(dot);
      }
    }
    this.dirty = true;
  }

  /* ---------------------------------- camera -------------------------------- */

  orbit(dxPx: number, dyPx: number) {
    this.cam.theta -= dxPx * 0.007;
    this.cam.phi = Math.min(Math.PI - 0.02, Math.max(0.02, this.cam.phi - dyPx * 0.005));
    this.anim = null;
    this.dirty = true;
  }

  pan(dxPx: number, dyPx: number) {
    const cam = this.camera;
    const height = this.container.clientHeight || 1;
    const worldPerPx = this.perspActive
      ? (2 * this.cam.radius * Math.tan((this.persp.fov * Math.PI) / 360)) / height
      : (this.ortho.top - this.ortho.bottom) / height;
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    cam.matrixWorld.extractBasis(right, up, new THREE.Vector3());
    const delta = right.multiplyScalar(-dxPx * worldPerPx).add(up.multiplyScalar(dyPx * worldPerPx));
    this.cam.target.add(delta);
    this.anim = null;
    this.dirty = true;
  }

  zoom(factor: number) {
    this.cam.radius = Math.max(8, Math.min(4000, this.cam.radius * factor));
    this.anim = null;
    this.dirty = true;
  }

  setProjection(perspective: boolean) {
    this.perspActive = perspective;
    this.dirty = true;
  }

  animateTo(to: Partial<CameraState>, duration = 260) {
    const from: CameraState = {
      target: this.cam.target.clone(),
      radius: this.cam.radius,
      theta: this.cam.theta,
      phi: this.cam.phi,
    };
    const target: CameraState = {
      target: to.target ? to.target.clone() : from.target.clone(),
      radius: to.radius ?? from.radius,
      theta: to.theta ?? from.theta,
      phi: to.phi ?? from.phi,
    };
    this.anim = { from, to: target, start: performance.now(), duration };
    this.dirty = true;
  }

  setView(name: ViewName, bodies: EvalBody[] = []) {
    if (name === 'fit') {
      this.fitAll(bodies);
      return;
    }
    const presets: Record<Exclude<ViewName, 'fit'>, { theta: number; phi: number }> = {
      front: { theta: -Math.PI / 2, phi: Math.PI / 2 },
      back: { theta: Math.PI / 2, phi: Math.PI / 2 },
      right: { theta: 0, phi: Math.PI / 2 },
      left: { theta: Math.PI, phi: Math.PI / 2 },
      top: { theta: -Math.PI / 2, phi: 0.001 },
      bottom: { theta: -Math.PI / 2, phi: Math.PI - 0.001 },
      iso: { theta: -Math.PI * 0.28, phi: Math.PI * 0.32 },
    };
    const p = presets[name];
    this.animateTo({ theta: p.theta, phi: p.phi }, 320);
  }

  /** Turn the camera to look straight at a plane, like entering a sketch. */
  lookAtPlane(n: Vec3, origin: Vec3, radius?: number) {
    const nn = norm3(n);
    const phi = Math.acos(Math.max(-1, Math.min(1, nn[2])));
    const flat = Math.hypot(nn[0], nn[1]);
    // Horizontal planes (XY) have no meaningful azimuth; use a canonical one so the
    // top-down sketch view is never rolled.
    const theta = flat < 1e-3 ? -Math.PI / 2 : Math.atan2(nn[1], nn[0]);
    this.animateTo(
      {
        theta,
        phi: Math.max(0.06, Math.min(Math.PI - 0.06, phi)),
        target: new THREE.Vector3(origin[0], origin[1], origin[2]),
        radius: radius ?? Math.max(120, Math.min(this.cam.radius, 260)),
      },
      340,
    );
  }

  fitAll(bodies: EvalBody[] = []) {
    let min: Vec3 = [Infinity, Infinity, Infinity];
    let max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const b of bodies) {
      if (b.hidden) continue;
      const m = b.measure;
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], m.bboxMin[i]);
        max[i] = Math.max(max[i], m.bboxMax[i]);
      }
    }
    if (!isFinite(min[0])) {
      min = [-60, -60, 0];
      max = [60, 60, 40];
    }
    const center = new THREE.Vector3(
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      (min[2] + max[2]) / 2,
    );
    const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    this.animateTo({ target: center, radius: Math.max(40, diag * 1.7) }, 320);
  }

  focusPoint(point: Vec3, radius?: number) {
    this.animateTo({ target: new THREE.Vector3(point[0], point[1], point[2]), radius: radius ?? this.cam.radius * 0.7 }, 260);
  }

  get radius() {
    return this.cam.radius;
  }

  /* --------------------------------- picking -------------------------------- */

  private pointerToNdc(x: number, y: number): { x: number; y: number } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: ((x - rect.left) / rect.width) * 2 - 1,
      y: -((y - rect.top) / rect.height) * 2 + 1,
    };
  }

  private raycaster(x: number, y: number): THREE.Raycaster {
    const ndc = this.pointerToNdc(x, y);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.camera);
    return rc;
  }

  pickFace(x: number, y: number): Hit | null {
    const meshes: THREE.Mesh[] = [];
    this.bodyGroup.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    const rc = this.raycaster(x, y);
    const hits = rc.intersectObjects(meshes, false);
    for (const h of hits) {
      const mesh = h.object as THREE.Mesh;
      const bodyId = mesh.userData.bodyId as string;
      const faceIds = mesh.userData.faceIds as Uint32Array;
      if (!bodyId || !faceIds || h.faceIndex == null) continue;
      const faceIndex = faceIds[h.faceIndex];
      if (faceIndex === undefined) continue;
      const p = h.point;
      return {
        bodyId,
        faceIndex,
        point: [p.x, p.y, p.z],
        distance: h.distance,
      };
    }
    return null;
  }

  pickEdge(x: number, y: number, tolerancePx = 11): { bodyId: string; edge: Edge } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    let best: { bodyId: string; edge: Edge; d: number } | null = null;
    const v = new THREE.Vector3();
    const project = (p: Vec3) => {
      v.set(p[0], p[1], p[2]).project(this.camera);
      return {
        x: ((v.x + 1) / 2) * rect.width + rect.left,
        y: ((1 - v.y) / 2) * rect.height + rect.top,
      };
    };
    for (const [bodyId, edges] of this.edgeCache) {
      const body = this.bodyMeshes.get(bodyId)?.body;
      if (body?.hidden) continue;
      for (const e of edges) {
        const a = project(e.a);
        const b = project(e.b);
        const d = distToSegment2D({ x, y }, a, b);
        if (d < tolerancePx && (!best || d < best.d)) best = { bodyId, edge: e, d };
      }
    }
    return best ? { bodyId: best.bodyId, edge: best.edge } : null;
  }

  worldToScreen(p: Vec3): { x: number; y: number } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3(p[0], p[1], p[2]).project(this.camera);
    return {
      x: ((v.x + 1) / 2) * rect.width,
      y: ((1 - v.y) / 2) * rect.height,
    };
  }

  screenToPlane(x: number, y: number, frame: Frame): Vec2 | null {
    const rc = this.raycaster(x, y);
    const n = new THREE.Vector3(frame.n[0], frame.n[1], frame.n[2]);
    const o = new THREE.Vector3(frame.origin[0], frame.origin[1], frame.origin[2]);
    const plane = new THREE.Plane(n, -n.dot(o));
    const hit = new THREE.Vector3();
    const ok = rc.ray.intersectPlane(plane, hit);
    if (!ok) return null;
    return to2D(frame, [hit.x, hit.y, hit.z]);
  }

  screenToRay(x: number, y: number): { origin: Vec3; dir: Vec3 } {
    const rc = this.raycaster(x, y);
    return {
      origin: [rc.ray.origin.x, rc.ray.origin.y, rc.ray.origin.z],
      dir: [rc.ray.direction.x, rc.ray.direction.y, rc.ray.direction.z],
    };
  }

  /** Distance along a world direction for a given screen drag (for drag ops). */
  dragScale(anchor: Vec3, dir: Vec3): number {
    const worldPerPx =
      (2 * this.cam.radius * Math.tan((this.persp.fov * Math.PI) / 360)) /
      (this.container.clientHeight || 1);
    const cam = this.camera as THREE.Camera & { position: THREE.Vector3 };
    const toCam = new THREE.Vector3(
      cam.position.x - anchor[0],
      cam.position.y - anchor[1],
      cam.position.z - anchor[2],
    ).normalize();
    const d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
    // Screen-space speed of moving along `d` from `anchor`.
    const perp = new THREE.Vector3().crossVectors(d, toCam);
    const len = Math.max(0.15, Math.abs(Math.sin(Math.acos(Math.min(1, Math.abs(d.dot(toCam)))))));
    return (worldPerPx * len) / Math.max(0.15, perp.length());
  }

  captureThumbnail(): string | null {
    try {
      const size = 220;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = Math.round(size * 0.75);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#141518';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const src = this.renderer.domElement;
      ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.6);
    } catch {
      return null;
    }
  }
}

function distToSegment2D(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

export { COLORS };
