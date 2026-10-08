import React from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { Bot, Wrench, Bell } from 'lucide-react';
import type { MentionKind } from '../types.js';

export function ReferencePill({ node }: NodeViewProps) {
  const rawKind = (node.attrs.kind as MentionKind) || 'agent';
  const kind: 'agent' | 'skill' | 'inbox' =
    rawKind === 'agent' || rawKind === 'skill' || rawKind === 'inbox' ? rawKind : 'agent';
  const label = (node.attrs.label as string) || node.attrs.id || '';

  const pillConfigs = {
    agent: {
      icon: Bot,
      prefix: '@',
      className: 'bg-[#edf3ff] text-[#3266ba] border-[#dce8fa] hover:bg-[#dfebff]',
    },
    skill: {
      icon: Wrench,
      prefix: '/',
      className: 'bg-amber-500/15 text-amber-700 border-amber-500/30 hover:bg-amber-500/25',
    },
    inbox: {
      icon: Bell,
      prefix: '#',
      className: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30 hover:bg-emerald-500/25',
    },
  };
  const config = pillConfigs[kind];

  const Icon = config.icon;
  const displayLabel = label.startsWith(config.prefix) ? label : `${config.prefix}${label}`;

  return (
    <NodeViewWrapper
      as="span"
      className="inline-flex items-baseline mx-0.5 select-none align-baseline"
      contentEditable={false}
    >
      <span
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-xs font-semibold tracking-tight transition-colors cursor-default ${config.className}`}
        data-reference-kind={kind}
        data-reference-id={node.attrs.id}
      >
        <Icon className="w-3 h-3 stroke-[2.2] shrink-0" />
        <span className="truncate max-w-[140px]">{displayLabel}</span>
      </span>
    </NodeViewWrapper>
  );
}
