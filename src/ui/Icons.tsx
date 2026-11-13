// Small line icons. Deliberately understated: 1.6px strokes, 18px default.

export type IconName =
  | 'select'
  | 'sketch'
  | 'measure'
  | 'undo'
  | 'redo'
  | 'fit'
  | 'grid'
  | 'layers'
  | 'help'
  | 'plus'
  | 'save'
  | 'export'
  | 'folder'
  | 'close'
  | 'check'
  | 'trash'
  | 'eye'
  | 'eyeOff'
  | 'cube'
  | 'fillet'
  | 'chamfer'
  | 'extrude'
  | 'cut'
  | 'revolve'
  | 'mirror'
  | 'pattern'
  | 'line'
  | 'polyline'
  | 'rect'
  | 'circle'
  | 'arc'
  | 'spline'
  | 'auto'
  | 'dimension'
  | 'snap'
  | 'chevron'
  | 'minus'
  | 'rollback'
  | 'warning'
  | 'home'
  | 'chevronDown'
  | 'more'
  | 'settings'
  | 'history'
  | 'plane';

const P: Record<IconName, JSX.Element> = {
  select: <path d="M5.5 3.5l13 7.2-5.6 1.6-2 5.4z" />,
  sketch: (
    <>
      <path d="M4 20l1-4 10.5-10.5 3 3L8 19z" />
      <path d="M14 6l3 3" />
    </>
  ),
  measure: (
    <>
      <path d="M3 16.5l13.5-13.5 4.5 4.5L7.5 21z" />
      <path d="M7 12.5l1.8 1.8M10 9.5l1.8 1.8M13 6.5l1.8 1.8" />
    </>
  ),
  undo: (
    <>
      <path d="M9 7H4.5v4.5" />
      <path d="M4.8 11.5A7.5 7.5 0 1 1 7 17" />
    </>
  ),
  redo: (
    <>
      <path d="M15 7h4.5v4.5" />
      <path d="M19.2 11.5A7.5 7.5 0 1 0 17 17" />
    </>
  ),
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  grid: <path d="M4 4h16v16H4z M4 9.3h16 M4 14.7h16 M9.3 4v16 M14.7 4v16" />,
  layers: <path d="M12 3l8 4.2-8 4.2-8-4.2z M4 12.2l8 4.2 8-4.2 M4 16.4l8 4.2 8-4.2" />,
  help: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .9-1 1.6v.4" />
      <path d="M12 17h.01" />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  minus: <path d="M5.5 12h13" />,
  save: <path d="M5 4h11l3 3v13H5z M8.5 4v5h7 M8 20v-5h8v5" />,
  export: <path d="M12 15V4 M8.5 8L12 4.4 15.5 8 M4.5 15v4.5h15V15" />,
  folder: <path d="M4 6.5h6l2 2h8v11H4z" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.8 4.8L19 7" />,
  trash: <path d="M5 7h14 M9.5 7V4.5h5V7 M7 7l1 13h8l1-13" />,
  eye: (
    <>
      <path d="M2.5 12S6 6.2 12 6.2 21.5 12 21.5 12 18 17.8 12 17.8 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M4 12s3.2-5 8-5 8 5 8 5-3.2 5-8 5-8-5-8-5z" />
      <path d="M4.5 4.5l15 15" />
    </>
  ),
  cube: <path d="M12 3.2l8 4.4v8.8L12 20.8l-8-4.4V7.6z M12 12l8-4.4 M12 12v8.8 M12 12L4 7.6" />,
  fillet: <path d="M4 20V10.5A6.5 6.5 0 0 1 10.5 4H20" />,
  chamfer: <path d="M4 20v-8l8-8h8" />,
  extrude: (
    <>
      <path d="M5 14.5v5h14v-5" />
      <path d="M12 15.5V3.5 M8.4 7.2L12 3.4l3.6 3.8" />
    </>
  ),
  cut: <path d="M4.5 4.5h15v15h-15z M8.5 12h7" />,
  revolve: (
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20.5 4.2v4.6h-4.6" />
    </>
  ),
  mirror: <path d="M12 3v18 M8.5 7L4 12l4.5 5 M15.5 7L20 12l-4.5 5" />,
  pattern: (
    <>
      <circle cx="6" cy="6" r="1.6" />
      <circle cx="12" cy="6" r="1.6" />
      <circle cx="18" cy="6" r="1.6" />
      <circle cx="6" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18" cy="12" r="1.6" />
      <circle cx="6" cy="18" r="1.6" />
      <circle cx="12" cy="18" r="1.6" />
      <circle cx="18" cy="18" r="1.6" />
    </>
  ),
  line: <path d="M4 20L20 4" />,
  polyline: <path d="M3 18l5-6 4 4 6-10" />,
  rect: <path d="M4 6.5h16v11H4z" />,
  circle: <circle cx="12" cy="12" r="8" />,
  arc: <path d="M4 19A15 15 0 0 1 19 4" />,
  spline: <path d="M3.5 17.5c4-11 8 5.5 12-4.5" />,
  auto: (
    <>
      <path d="M4 20l9.5-9.5" />
      <path d="M16 4.5l1.4 2.6 2.6 1.4-2.6 1.4L16 12.5l-1.4-2.6L12 8.5l2.6-1.4z" />
    </>
  ),
  dimension: <path d="M4 12h16 M4 8.8v6.4 M20 8.8v6.4" />,
  snap: <path d="M7 4.5v6.8a5 5 0 0 0 10 0V4.5h-4v6.8a1 1 0 0 1-2 0V4.5z" />,
  chevron: <path d="M9.5 6l6 6-6 6" />,
  rollback: <path d="M4 8h9.5a5.5 5.5 0 0 1 0 11H8 M4 8l3.5-3.5 M4 8l3.5 3.5" />,
  warning: (
    <>
      <path d="M12 4l8.5 15.5h-17z" />
      <path d="M12 9.5v4.5M12 17h.01" />
    </>
  ),
  home: (
    <>
      <path d="M4.2 10.6L12 4.3l7.8 6.3V19.4a.6.6 0 0 1-.6.6H4.8a.6.6 0 0 1-.6-.6z" />
      <path d="M9.7 20v-5.2h4.6V20" />
    </>
  ),
  chevronDown: <path d="M6.5 9.75l5.5 5.4 5.5-5.4" />,
  more: (
    <>
      <circle cx="5.6" cy="12" r="1.25" />
      <circle cx="12" cy="12" r="1.25" />
      <circle cx="18.4" cy="12" r="1.25" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 3.4v2.2M12 18.4v2.2M3.4 12h2.2M18.4 12h2.2M5.9 5.9l1.6 1.6M16.5 16.5l1.6 1.6M18.1 5.9l-1.6 1.6M7.5 16.5l-1.6 1.6" />
    </>
  ),
  history: (
    <>
      <path d="M12 7.4V12l3 1.8" />
      <path d="M3.9 11.4A8.2 8.2 0 1 1 6.4 17" />
      <path d="M3.6 7.7v3.9h3.9" />
    </>
  ),
  plane: (
    <>
      <path d="M3.6 15.2L12 10.6l8.4 4.6-8.4 4.6z" />
      <path d="M3.6 15.2V9.6L12 5l8.4 4.6v5.6" />
    </>
  ),
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.55}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {P[name]}
    </svg>
  );
}
