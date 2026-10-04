import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriEnvironment } from '../../utils/window.js';
import petImage from '../../../../../docs/prototype/assets/rover-pet.png';

interface PetProps {
  onHoverChange: (hovered: boolean) => void;
}

export function Pet({ onHoverChange }: PetProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuError, setMenuError] = useState<string | null>(null);

  const dragOriginRef = useRef<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 菜单打开时聚焦首项，点击外部或按 Escape 关闭。
  useEffect(() => {
    if (!menuOpen) return;

    menuRef.current?.querySelector('button')?.focus();

    const handleOutsidePointerDown = (event: globalThis.PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };

    document.addEventListener('pointerdown', handleOutsidePointerDown);
    document.addEventListener('keydown', handleEscapeKey);

    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointerDown);
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [menuOpen]);

  // 超过移动阈值后才启动原生窗口拖动。
  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!dragOriginRef.current || !event.buttons || !isTauriEnvironment()) return;

    const distance = Math.hypot(
      event.clientX - dragOriginRef.current.x,
      event.clientY - dragOriginRef.current.y
    );
    if (distance < 6) return;

    dragOriginRef.current = null;
    setMenuOpen(false);
    void getCurrentWindow().startDragging().catch(console.error);
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button === 0) {
      dragOriginRef.current = { x: event.clientX, y: event.clientY };
    }
  };

  const handlePointerEnd = () => {
    dragOriginRef.current = null;
  };

  const handleContextMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setMenuOpen(true);
    setMenuError(null);
  };

  const handleOpenDashboard = async () => {
    try {
      if (isTauriEnvironment()) {
        await invoke('show_window', { label: 'dashboard' });
      } else {
        window.open(`${window.location.origin}/?window=dashboard`, '_blank');
      }
      setMenuOpen(false);
    } catch (error: unknown) {
      setMenuError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label="Rover 宠物"
        title="拖动可移动 · 右键打开 Dashboard"
        className="pet-avatar h-[94px] touch-none border-0 bg-transparent p-0 !cursor-grab active:!cursor-grabbing"
        onMouseEnter={() => onHoverChange(true)}
        onMouseLeave={() => onHoverChange(false)}
        onFocus={() => onHoverChange(true)}
        onBlur={() => onHoverChange(false)}
        onContextMenu={handleContextMenu}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        <img
          src={petImage}
          alt="Rover 桌面宠物"
          draggable={false}
          className="pointer-events-none h-[94px] w-auto object-contain drop-shadow-[0_8px_7px_#263b5470] motion-safe:animate-pet-bob"
        />
      </button>

      {/* 宠物右键菜单 */}
      {menuOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="宠物菜单"
          className="absolute top-4 left-[calc(50%+45px)] z-30 rounded-[18px] border border-[#dce8fa] bg-white p-2 text-xs text-[#3266ba] shadow-xl"
        >
          <button
            type="button"
            role="menuitem"
            onClick={handleOpenDashboard}
            className="rounded-xl px-4 py-2 hover:bg-[#edf3ff]"
          >
            Dashboard
          </button>
          {menuError && (
            <p role="alert" className="max-w-[140px] text-[#a45535]">
              {menuError}
            </p>
          )}
        </div>
      )}
    </>
  );
}
