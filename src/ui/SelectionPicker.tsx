import { Icon, IconName } from './Icons';
import { PickEntry, SelectionItem } from '../state/store';
import * as S from '../state/store';

/**
 * Stacked-selection list, as in Shapr3D: a tap that lands on several items at
 * once (an edge on a face, a body behind it, a sketch profile in front) opens
 * this list so the exact target can be picked in one move. Hovering a row
 * highlights that item in the viewport before committing.
 */

const keyOf = (item?: SelectionItem | null): string =>
  item
    ? [
        item.kind,
        item.bodyId ?? '',
        item.faceIndex ?? '',
        item.edgeKey ?? '',
        item.sketchId ?? '',
        item.regionIndex ?? '',
      ].join('|')
    : '';

const ICON: Record<string, IconName> = {
  Edge: 'line',
  Face: 'layers',
  Body: 'cube',
  Profile: 'sketch',
};

export function SelectionPicker() {
  const s = S.useApp();
  const picker = s.picker;
  if (!picker) return null;

  const width = 236;
  const height = 34 + picker.entries.length * 36;
  const left = Math.max(10, Math.min(window.innerWidth - width - 10, picker.x + 14));
  const top = Math.max(10, Math.min(window.innerHeight - height - 10, picker.y + 16));

  const choose = (entry: PickEntry) => {
    S.selectItem(entry.item);
    S.setHover(null);
    S.store.set({ picker: null });
  };

  const dismiss = () => {
    S.setHover(null);
    S.store.set({ picker: null });
  };

  return (
    <div
      className="picker"
      style={{ left, top, width }}
      onPointerDown={(ev) => ev.stopPropagation()}
    >
      <div className="picker-head">
        <span>Select</span>
        <button className="picker-dismiss" title="Dismiss" onClick={dismiss}>
          <Icon name="close" size={13} />
        </button>
      </div>
      {picker.entries.map((entry) => (
        <button
          key={entry.id}
          className={`picker-row ${keyOf(s.hover) === keyOf(entry.item) ? 'is-hover' : ''} ${
            keyOf(s.selection[0]) === keyOf(entry.item) ? 'is-active' : ''
          }`}
          onPointerEnter={() => S.setHover(entry.item)}
          onPointerLeave={() => S.setHover(null)}
          onClick={() => choose(entry)}
        >
          <Icon name={ICON[entry.label] ?? 'select'} size={14} />
          <span className="picker-label">{entry.label}</span>
          {entry.hint ? <span className="picker-hint">{entry.hint}</span> : null}
          {keyOf(s.selection[0]) === keyOf(entry.item) ? (
            <Icon name="check" size={12} />
          ) : null}
        </button>
      ))}
    </div>
  );
}
