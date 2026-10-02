import React from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { Bot, Wrench, Bell } from 'lucide-react';
import type { MentionKind } from '../types.js';

export function ReferencePill({ node }: NodeViewProps) {
  const kind = (node.attrs.kind as MentionKind) || 'agent';
  const label = (node.attrs.label as string) || node.attrs.id || '';

  const config = {
    agent: {
      icon: Bot,
      prefix: '@',
      className:
        'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30 hover:bg-indigo-500/25',
    },
    skill: {
      icon: Wrench,
      prefix: '/',
      className:
        'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 hover:bg-amber-500/25',
    },
    inbox: {
      icon: Bell,
      prefix: '#',
      className:
        'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25',
    },
  }[kind];

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
