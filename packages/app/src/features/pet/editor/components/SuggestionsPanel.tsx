import React, { useEffect, useRef } from 'react';
import { Bot, Wrench, Bell } from 'lucide-react';
import { usePetPreferences } from '../../../../shared/preferences/pet.js';
import type { SuggestionItemData } from '../types.js';

export interface SuggestionItemProps {
  item: SuggestionItemData;
  isSelected: boolean;
  onSelect: () => void;
  onMouseEnter: () => void;
}

export function SuggestionItem({ item, isSelected, onSelect, onMouseEnter }: SuggestionItemProps) {
  const Icon = item.kind === 'agent' ? Bot : item.kind === 'skill' ? Wrench : Bell;

  return (
    <button
      type="button"
      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-left transition-colors text-xs ${
        isSelected
          ? 'bg-[#edf3ff] text-[#3266ba] font-medium shadow-xs'
          : 'text-[#485e85] hover:bg-[#edf3ff]'
      }`}
      onClick={(e) => {
        e.preventDefault();
        onSelect();
      }}
      onMouseEnter={onMouseEnter}
      data-suggestion-item={item.id}
      data-selected={isSelected}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="w-3.5 h-3.5 shrink-0 text-[#657993]" />
        <span className="truncate font-medium">{item.label}</span>
        {item.description && (
          <span className="truncate text-[#657993] text-[11px] max-w-[160px]">
            {item.description}
          </span>
        )}
      </div>
      {item.detail && (
        <span className="text-[10px] text-[#657993] uppercase tracking-wider shrink-0 ml-2">
          {item.detail}
        </span>
      )}
    </button>
  );
}

export interface SuggestionsPanelProps {
  items: SuggestionItemData[];
  selectedIndex: number;
  onSelect: (item: SuggestionItemData) => void;
  onHighlight: (index: number) => void;
  title?: string;
  emptyText?: string;
}

export function SuggestionsPanel({
  items,
  selectedIndex,
  onSelect,
  onHighlight,
  title,
  emptyText = '无匹配项',
}: SuggestionsPanelProps) {
  const { size: petSize } = usePetPreferences();
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const selectedElement = container.querySelector<HTMLElement>(
      `[data-suggestion-item="${items[selectedIndex]?.id}"]`
    );
    selectedElement?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, items]);

  if (items.length === 0) {
    return (
      <div
        style={{ zoom: petSize / 100 }}
        className="pet-suggestions z-50 min-w-[200px] max-w-[320px] rounded-[18px] border border-[#dce8fa] bg-[#fffffff7] p-2.5 text-xs text-[#657993] shadow-xl backdrop-blur-md"
      >
        {emptyText}
      </div>
    );
  }

  return (
    <div
      ref={scrollContainerRef}
      style={{ zoom: petSize / 100 }}
      className="pet-suggestions z-50 min-w-[240px] max-w-[340px] max-h-[220px] overflow-y-auto rounded-[18px] border border-[#dce8fa] bg-[#fffffff7] p-1 shadow-2xl backdrop-blur-md flex flex-col gap-0.5 animate-in fade-in-0 zoom-in-95 duration-100"
    >
      {title && (
        <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#657993] border-b border-[#dce8fa] mb-0.5">
          {title}
        </div>
      )}
      <div className="flex flex-col gap-0.5">
        {items.map((item, index) => (
          <SuggestionItem
            key={`${item.kind}_${item.id}`}
            item={item}
            isSelected={index === selectedIndex}
            onSelect={() => onSelect(item)}
            onMouseEnter={() => onHighlight(index)}
          />
        ))}
      </div>
      <div className="mt-1 flex items-center justify-between border-t border-[#dce8fa] px-2 pt-1 text-[9px] text-[#657993]">
        <span>↑↓ 选择</span>
        <span>Enter 确认 / Esc 关闭</span>
      </div>
    </div>
  );
}
