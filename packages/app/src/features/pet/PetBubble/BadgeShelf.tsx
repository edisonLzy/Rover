import { useEffect, useRef } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { FollowUpItem } from '../useFollowUps.js';

export interface BadgeShelfProps {
  items: FollowUpItem[];
  scale?: number;
  highlightedId?: string;
  disabled?: boolean;
  canAdvance?: boolean;
  onRemove: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onAdvance: (id: string) => void;
}

function preview(item: FollowUpItem) {
  const prefixes = { agent: '@', skill: '/', inbox: '#' };
  return item.promptDoc.parts
    .map((part) =>
      part.type === 'text'
        ? part.text
        : part.label.startsWith(prefixes[part.kind])
          ? part.label
          : `${prefixes[part.kind]}${part.label}`
    )
    .join('')
    .trim();
}

function Badge({ item, props }: { item: FollowUpItem; props: BadgeShelfProps }) {
  const sortable = useSortable({ id: item.id, disabled: props.disabled });
  const label = preview(item);
  const highlighted = props.highlightedId === item.id;
  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(
          sortable.transform
            ? {
                ...sortable.transform,
                x: sortable.transform.x / (props.scale ?? 1),
                y: sortable.transform.y / (props.scale ?? 1),
              }
            : null
        ),
        transition: sortable.transition,
      }}
      data-follow-up-id={item.id}
      role="listitem"
      className={`follow-up-pill flex h-[22px] min-w-0 items-center gap-0.5 rounded-full border px-1 text-[10px] ${highlighted ? 'border-[#99bcf6] bg-[#e3edff] text-[#285fb3]' : 'border-[#dce6f2] bg-[#edf3fa]/80 text-[#52708f]'} ${sortable.isDragging ? 'relative z-10 shadow-md' : ''}`}
    >
      <button
        type="button"
        {...sortable.attributes}
        {...sortable.listeners}
        className="shrink-0 touch-none rounded px-0.5"
        disabled={props.disabled}
        aria-label={`拖动排序：${label}`}
        title="拖动排序；空格开始，方向键移动，空格确认"
      >
        ⠿
      </button>
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left"
        disabled={!props.canAdvance || props.disabled}
        title={highlighted ? `${label} · 即将开始，点击立即执行` : label}
        aria-label={`立即执行：${label}`}
        onClick={() => props.onAdvance(item.id)}
      >
        {label}
      </button>
      <button
        type="button"
        className="shrink-0 rounded px-0.5 text-[#8493a7] hover:text-[#b45745]"
        disabled={props.disabled}
        aria-label={`删除待办：${label}`}
        onClick={() => props.onRemove(item.id)}
      >
        ×
      </button>
    </div>
  );
}

export function BadgeShelf(props: BadgeShelfProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = scrollRef.current;
    if (!row) return;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const unit = event.deltaMode === 1 ? 22 : event.deltaMode === 2 ? row.clientWidth : 1;
      const next = Math.max(
        0,
        Math.min(row.scrollWidth - row.clientWidth, row.scrollLeft + event.deltaY * unit)
      );
      if (next === row.scrollLeft) return;
      event.preventDefault();
      row.scrollLeft = next;
    };
    row.addEventListener('wheel', onWheel, { passive: false });
    return () => row.removeEventListener('wheel', onWheel);
  }, [props.items.length]);
  const keyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
    if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight')
      return sortableKeyboardCoordinates(event, args);
    event.preventDefault();
    const { active, over, droppableRects } = args.context;
    const index = props.items.findIndex((item) => item.id === (over?.id ?? active?.id));
    const target = props.items[index + (event.code === 'ArrowRight' ? 1 : -1)];
    const rect = target && droppableRects.get(target.id);
    return rect ? { x: rect.left, y: rect.top } : undefined;
  };
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates })
  );
  if (!props.items.length) return null;
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = props.items.findIndex((item) => item.id === active.id);
    const to = props.items.findIndex((item) => item.id === over.id);
    if (from >= 0 && to >= 0)
      props.onReorder(arrayMove(props.items, from, to).map((item) => item.id));
  };
  return (
    <div aria-label="接续队列" className="badge-shelf mt-2 border-t border-[#e5edf6] pt-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext
          items={props.items.map((item) => item.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div
            ref={scrollRef}
            role="list"
            aria-label="横向滚动待办"
            tabIndex={0}
            className="grid h-[22px] grid-flow-col gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ gridAutoColumns: 'calc((100% - 4px) / 2)' }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              const row = event.currentTarget;
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                row.scrollLeft += (row.clientWidth / 2 + 2) * (event.key === 'ArrowRight' ? 1 : -1);
              }
            }}
          >
            {props.items.map((item) => (
              <Badge key={item.id} item={item} props={props} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
