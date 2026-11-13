// Minimal vector math on immutable tuples. Everything in the kernel uses mm.

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

export const v3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];
export const v2 = (x = 0, y = 0): Vec2 => [x, y];

export const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const neg3 = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];
export const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len3 = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const norm3 = (a: Vec3): Vec3 => {
  const l = len3(a);
  return l < 1e-12 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
};
export const dist3 = (a: Vec3, b: Vec3): number => len3(sub3(a, b));
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export const mid3 = (a: Vec3, b: Vec3): Vec3 => [
  (a[0] + b[0]) / 2,
  (a[1] + b[1]) / 2,
  (a[2] + b[2]) / 2,
];

export const add2 = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const sub2 = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const scale2 = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
export const dot2 = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
export const cross2 = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];
export const len2 = (a: Vec2): number => Math.hypot(a[0], a[1]);
export const norm2 = (a: Vec2): Vec2 => {
  const l = len2(a);
  return l < 1e-12 ? [0, 0] : [a[0] / l, a[1] / l];
};
export const dist2 = (a: Vec2, b: Vec2): number => len2(sub2(a, b));
export const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];

/** Rotate a vector about a unit axis using Rodrigues' formula. */
export const rotateAbout = (v: Vec3, axis: Vec3, angle: number): Vec3 => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = dot3(axis, v) * (1 - c);
  const cr = cross3(axis, v);
  return [
    v[0] * c + cr[0] * s + axis[0] * k,
    v[1] * c + cr[1] * s + axis[1] * k,
    v[2] * c + cr[2] * s + axis[2] * k,
  ];
};

export const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;
