import type { PromptDocumentV1 } from '../../../types/prompt.js';

export interface ParsedPromptContent {
  plainText: string;
  references: {
    agents: string[];
    skills: string[];
    inboxes: string[];
  };
}

/**
 * Extracts plain text and categorized structured references (@agent, /skill, #inbox)
 * from a validated PromptDocumentV1.
 */
export function parsePromptDocumentContent(doc: PromptDocumentV1): ParsedPromptContent {
  const plainTextParts: string[] = [];
  const agents: string[] = [];
  const skills: string[] = [];
  const inboxes: string[] = [];

  for (const part of doc.parts) {
    if (part.type === 'text') {
      plainTextParts.push(part.text);
      continue;
    }

    const prefix = part.kind === 'agent' ? '@' : part.kind === 'skill' ? '/' : '#';
    const label = part.label.startsWith(prefix) ? part.label : `${prefix}${part.label}`;
    let rendered = label;

    if (part.kind === 'agent') {
      if (!agents.includes(part.id)) agents.push(part.id);
    } else if (part.kind === 'skill') {
      if (!skills.includes(part.id)) skills.push(part.id);
    } else {
      if (!inboxes.includes(part.id)) inboxes.push(part.id);
      rendered += ` [inboxMessageId=${JSON.stringify(part.id)}]`;
    }

    plainTextParts.push(rendered);
  }

  return {
    plainText: plainTextParts.join(''),
    references: {
      agents,
      skills,
      inboxes,
    },
  };
}

export interface SystemPromptOptions {
  workspacePath?: string;
  customInstructions?: string;
  tools?: Array<{ name: string; description: string }>;
}

/**
 * Builds the default system prompt for Rover Agent loop.
 */
export function buildRoverSystemPrompt(options: SystemPromptOptions = {}): string {
  const { workspacePath, customInstructions, tools = [] } = options;

  const sections: string[] = [
    `You are Rover, an intelligent, agile AI companion residing on macOS desktop.`,
    `Your role is to understand user intents, provide concise, accurate answers, clarify missing requirements, or coordinate coding agents to perform tasks.`,
  ];

  if (workspacePath) {
    sections.push(`Current Workspace: ${workspacePath}`);
  }

  if (tools.length > 0) {
    const toolsDesc = tools.map((t) => `- ${t.name}: ${t.description}`).join('\n');
    sections.push(`Available Controlled Tools:\n${toolsDesc}`);
  }

  sections.push(
    `Operational Guidelines:
1. Be helpful, concise, and structured in responses.
2. If critical information is missing to take safe action, politely ask a clarifying question.
3. When external actions or agent dispatching is required, invoke the appropriate controlled tool.`
  );

  if (customInstructions && customInstructions.trim().length > 0) {
    sections.push(`Custom Instructions:\n${customInstructions.trim()}`);
  }

  return sections.join('\n\n');
}

/**
 * Extensible System Prompt Builder interface (matches divisor-agent architecture).
 */
export interface SystemPromptBuilder {
  buildSystemPrompt(raw: string): string;
}

export class SystemPromptService implements SystemPromptBuilder {
  private builders: SystemPromptBuilder[] = [];

  constructor(initialBuilders: SystemPromptBuilder[] = []) {
    this.builders = [...initialBuilders];
  }

  addBuilder(builder: SystemPromptBuilder): void {
    this.builders.push(builder);
  }

  buildSystemPrompt(raw: string): string {
    return this.builders.reduce((prompt, builder) => builder.buildSystemPrompt(prompt), raw);
  }
}
