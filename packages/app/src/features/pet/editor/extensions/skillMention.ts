import { Extension } from '@tiptap/core';
import { ReactRenderer } from '@tiptap/react';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { SuggestionsPanel } from '../components/SuggestionsPanel.js';
import { insertReferenceNode } from './mentionNode.js';
import { filterSuggestions } from './agentMention.js';
import type { SuggestionItemData } from '../types.js';

export const skillSuggestionPluginKey = new PluginKey('skillSuggestion');

export interface CreateSkillMentionOptions {
  getSkills: () => SuggestionItemData[];
}

export function createSkillMentionExtension(options: CreateSkillMentionOptions) {
  return Extension.create({
    name: 'skillMention',

    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          char: '/',
          pluginKey: skillSuggestionPluginKey,
          items: ({ query }) => filterSuggestions(options.getSkills(), query),
          command: ({ editor, range, props }) => {
            insertReferenceNode({
              editor,
              range,
              item: props,
              trailingSpace: true,
            });
          },
          render: () => {
            let component: ReactRenderer<any> | null = null;
            let popup: HTMLDivElement | null = null;
            let selectedIndex = 0;
            let currentItems: SuggestionItemData[] = [];
            let currentCommand: ((item: SuggestionItemData) => void) | null = null;

            const updatePosition = (clientRect?: DOMRect | null) => {
              if (!popup || !clientRect) return;
              popup.style.position = 'fixed';
              popup.style.left = `${clientRect.left}px`;
              popup.style.bottom = `${window.innerHeight - clientRect.top + 8}px`;
              popup.style.zIndex = '9999';
            };

            return {
              onStart: (props) => {
                currentItems = props.items;
                selectedIndex = 0;
                currentCommand = props.command;

                popup = document.createElement('div');
                document.body.appendChild(popup);

                component = new ReactRenderer(SuggestionsPanel, {
                  props: {
                    items: currentItems,
                    selectedIndex,
                    title: '可用 Skill 候选',
                    onSelect: (item: SuggestionItemData) => props.command(item),
                    onHighlight: (index: number) => {
                      selectedIndex = index;
                      component?.updateProps({ selectedIndex });
                    },
                  },
                  editor: props.editor,
                });

                popup.appendChild(component.element);
                updatePosition(props.clientRect?.());
              },

              onUpdate: (props) => {
                currentItems = props.items;
                selectedIndex = Math.min(selectedIndex, Math.max(0, currentItems.length - 1));
                currentCommand = props.command;

                component?.updateProps({
                  items: currentItems,
                  selectedIndex,
                });

                updatePosition(props.clientRect?.());
              },

              onKeyDown: (props) => {
                if (props.event.key === 'Escape') {
                  return true;
                }

                if (props.event.key === 'ArrowUp') {
                  selectedIndex =
                    (selectedIndex + currentItems.length - 1) % (currentItems.length || 1);
                  component?.updateProps({ selectedIndex });
                  return true;
                }

                if (props.event.key === 'ArrowDown') {
                  selectedIndex = (selectedIndex + 1) % (currentItems.length || 1);
                  component?.updateProps({ selectedIndex });
                  return true;
                }

                if (props.event.key === 'Enter' || props.event.key === 'Tab') {
                  const item = currentItems[selectedIndex];
                  if (item && currentCommand) {
                    currentCommand(item);
                    return true;
                  }
                  return false;
                }

                return false;
              },

              onExit: () => {
                popup?.remove();
                component?.destroy();
                popup = null;
                component = null;
                currentCommand = null;
              },
            };
          },
        }),
      ];
    },
  });
}
