import { useRef, type PointerEvent } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriEnvironment } from '../../../utils/window.js';
import petImage from '../../../../../../docs/prototype/assets/rover-pet.png';

export type PetState = 'idle' | 'thinking' | 'talking' | 'alert' | 'success' | 'error';

export interface PetAvatarProps {
  isOnline: boolean;
  state: PetState;
  isExpanded: boolean;
  onToggleExpand: () => void;
  attentionCount?: number;
}

export function PetAvatar({
  isOnline,
  state,
  isExpanded,
  onToggleExpand,
  attentionCount = 0,
}: PetAvatarProps) {
  const pointerOrigin = useRef<{ x: number; y: number } | null>(null);
  const wasDragged = useRef(false);

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const origin = pointerOrigin.current;
    if (!origin || !event.buttons || !isTauriEnvironment()) return;
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 6) return;
    pointerOrigin.current = null;
    wasDragged.current = true;
    void getCurrentWindow().startDragging().catch(console.error);
  };

  return (
    <>
      <button
        type="button"
        className="pet-avatar h-[94px] touch-none border-0 bg-transparent p-0 !cursor-grab active:!cursor-grabbing"
        aria-label={isExpanded ? '收起 Rover' : '展开 Rover'}
        aria-expanded={isExpanded}
        title={`${isOnline ? 'Rover 随时待命' : 'Rover 离线'} · 拖动可移动`}
        data-pet-state={state}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          pointerOrigin.current = { x: event.clientX, y: event.clientY };
          wasDragged.current = false;
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={() => {
          pointerOrigin.current = null;
        }}
        onPointerCancel={() => {
          pointerOrigin.current = null;
        }}
        onClick={(event) => {
          if (event.detail === 0 || !wasDragged.current) onToggleExpand();
        }}
      >
        <img
          src={petImage}
          alt="Rover 桌面宠物"
          draggable={false}
          className="pointer-events-none h-[94px] w-auto object-contain drop-shadow-[0_8px_7px_#263b5470] motion-safe:animate-pet-bob"
        />
      </button>
      {attentionCount > 0 && (
        <span
          className="pet-attention absolute top-0 left-[calc(50%+29px)] grid h-[22px] min-w-[22px] place-items-center rounded-full border-[3px] border-white bg-[#42be75] text-[10px] font-extrabold text-white shadow-[0_3px_10px_#315a5673]"
          aria-label={`${attentionCount} 个任务需要关注`}
        >
          {attentionCount}
        </span>
      )}
    </>
  );
}
