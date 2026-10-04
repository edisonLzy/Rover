import { useRef, useEffect } from 'react';
import { InboxList } from './inbox/index.js';
import { Tasks } from './tasks/index.js';
import type { ActivePanelProps } from './useActivePanel.js';

export function PetPanel({ activePanel, taskView, expandTask }: ActivePanelProps) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { panel.current?.scrollTo({ top: 0 }); }, [activePanel, taskView]);
  if (activePanel === 'none') return null;
  return <div ref={panel} className="pet-panel mt-[10px] min-h-0 overflow-y-auto overscroll-contain px-[5px] pt-[6px] pb-[14px] [scrollbar-width:thin] [scrollbar-color:#ffffff80_transparent]">
    {activePanel === 'inbox' ? <InboxList /> : <Tasks view={taskView} onExpand={expandTask} />}
  </div>;
}
