import { useEffect, useRef, type RefObject } from 'react';
import {
  currentMonitor,
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
} from '@tauri-apps/api/window';
import { isTauriEnvironment } from '../../utils/window.js';

export function usePetWindowLayout(
  shellRef: RefObject<HTMLDivElement | null>,
  expanded: boolean,
  scale: number
) {
  const geometry = useRef<{ x: number; y: number } | null>(null);
  const dimensions = useRef({ width: 0, height: 0 });
  const queue = useRef(Promise.resolve());
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || !isTauriEnvironment()) return;
    const nativeWindow = getCurrentWindow();
    let disposed = false;
    const resize = () => {
      queue.current = queue.current
        .then(async () => {
          if (disposed) return;
          const [monitor, position] = await Promise.all([
            currentMonitor(),
            nativeWindow.outerPosition(),
          ]);
          if (disposed) return;
          const dpr = monitor?.scaleFactor ?? window.devicePixelRatio ?? 1;
          const availableWidth = monitor ? monitor.workArea.size.width / dpr / scale - 24 : 420;
          const availableHeight = monitor ? monitor.workArea.size.height / dpr / scale - 24 : 640;
          const panelWidth = Math.max(240, Math.min(420, availableWidth));
          const panelHeight = Math.max(240, Math.min(640, availableHeight));
          shell.style.setProperty('--panel-width', `${panelWidth}px`);
          shell.style.setProperty('--panel-height', `${panelHeight}px`);
          const width = Math.ceil(((expanded ? panelWidth : 72) + 24) * scale);
          const height = Math.ceil(((expanded ? panelHeight : 72) + 24) * scale);
          // Keep the avatar's screen coordinate; only clamp when the panel cannot fit around it.
          const offset = {
            x: ((expanded ? panelWidth - 42 : 36) + 12) * scale * dpr,
            y: ((expanded ? 38 : 36) + 12) * scale * dpr,
          };
          const previous = geometry.current ?? offset;
          let x = position.x + previous.x - offset.x;
          let y = position.y + previous.y - offset.y;
          if (monitor) {
            const area = monitor.workArea;
            x = Math.max(
              area.position.x,
              Math.min(x, area.position.x + area.size.width - width * dpr)
            );
            y = Math.max(
              area.position.y,
              Math.min(y, area.position.y + area.size.height - height * dpr)
            );
          }
          if (dimensions.current.width !== width || dimensions.current.height !== height) {
            await nativeWindow.setSize(new LogicalSize(width, height));
            dimensions.current = { width, height };
          }
          if (position.x !== Math.round(x) || position.y !== Math.round(y)) {
            await nativeWindow.setPosition(new PhysicalPosition(Math.round(x), Math.round(y)));
          }
          geometry.current = offset;
        })
        .catch(console.error);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(shell);
    const unlisteners: Array<() => void> = [];
    for (const subscribe of [
      nativeWindow.onMoved.bind(nativeWindow),
      nativeWindow.onScaleChanged.bind(nativeWindow),
    ]) {
      void subscribe(resize)
        .then((unlisten) => {
          if (disposed) unlisten();
          else unlisteners.push(unlisten);
        })
        .catch(console.error);
    }
    resize();
    return () => {
      disposed = true;
      observer.disconnect();
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [shellRef, expanded, scale]);
}
