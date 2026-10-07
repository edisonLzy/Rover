export interface SkillFrontmatter {
  name?: string;
  description?: string;
  [key: string]: unknown;
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  body: string;
}

export interface DiscoveredSkill extends SkillDefinition {
  filePath: string;
  rootDir: string;
}

export interface SkillListItem {
  id: string;
  name: string;
  description: string;
  source: 'builtin';
  isEnabled: boolean;
}

export interface SystemPromptBuilder {
  buildSystemPrompt(raw: string): string;
}
