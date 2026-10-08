import fs from 'node:fs';
import path from 'node:path';
import type {
  DiscoveredSkill,
  SkillFrontmatter,
  SkillListItem,
  SystemPromptBuilder,
} from './types.js';

export interface SkillServiceOptions {
  skillsDir?: string;
}

export class SkillService implements SystemPromptBuilder {
  private skillsMap = new Map<string, DiscoveredSkill>();

  constructor(options: SkillServiceOptions = {}) {
    if (options.skillsDir !== undefined) {
      this.loadBuiltinSkills(options.skillsDir);
    }
  }

  /**
   * Loads only the resource directory supplied by the host application.
   * Skill scripts and attachments remain alongside SKILL.md; loading does not execute them.
   */
  private loadBuiltinSkills(skillsDir: string): void {
    if (!path.isAbsolute(skillsDir)) {
      throw new Error('Builtin skills directory must be an absolute path');
    }

    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        throw new Error(`Builtin skill must not be a symbolic link: ${entry.name}`);
      }
      if (!entry.isDirectory()) continue;

      const rootDir = path.join(skillsDir, entry.name);
      const filePath = path.join(rootDir, 'SKILL.md');
      if (!fs.lstatSync(filePath).isFile()) {
        throw new Error(`Builtin skill must have a regular SKILL.md file: ${filePath}`);
      }

      const content = fs.readFileSync(filePath, 'utf8');
      const frontmatter = parseFrontmatter(content);
      const name = frontmatter.name?.trim();
      const description = frontmatter.description?.trim();
      const body = stripFrontmatter(content).trim();
      if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || !description || !body) {
        throw new Error(
          `Invalid builtin skill (name, description and body are required): ${filePath}`
        );
      }
      if (this.skillsMap.has(name)) {
        throw new Error(`Duplicate builtin skill name: ${name}`);
      }

      this.skillsMap.set(name, { id: name, name, description, body, filePath, rootDir });
    }

    if (this.skillsMap.size === 0) {
      throw new Error(`No builtin skills found in ${skillsDir}`);
    }
  }

  public getSkills(): DiscoveredSkill[] {
    return Array.from(this.skillsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  public getSkill(name: string): DiscoveredSkill | undefined {
    return this.skillsMap.get(name);
  }

  public readSkillBody(name: string): string | null {
    const skill = this.skillsMap.get(name);
    return skill ? skill.body : null;
  }

  public list(): SkillListItem[] {
    return this.getSkills().map(({ id, name, description }) => ({
      id,
      name,
      description,
      source: 'builtin' as const,
      isEnabled: true,
    }));
  }

  public read(name: string): { name: string; body: string } | null {
    const body = this.readSkillBody(name);
    if (body === null) return null;
    return { name, body };
  }

  /**
   * Injects Level 1 available skills metadata into System Prompt.
   */
  public buildSystemPrompt(raw: string): string {
    const skills = this.getSkills();
    if (skills.length === 0) {
      return raw;
    }

    const lines: string[] = [
      'The following skills provide specialized instructions for specific tasks.',
      "Use the read_skill tool to load a skill's full instructions when the task matches its description.",
      '',
      '<available_skills>',
    ];

    for (const skill of skills) {
      lines.push('  <skill>');
      lines.push(`    <name>${escapeXml(skill.name)}</name>`);
      lines.push(`    <description>${escapeXml(skill.description)}</description>`);
      lines.push('  </skill>');
    }

    lines.push('</available_skills>');

    return [raw, lines.join('\n')].filter((s) => s.trim().length > 0).join('\n\n');
  }
}

// Backwards compatibility alias
export { SkillService as BuiltinSkillService };

export function parseFrontmatter(content: string): SkillFrontmatter {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return {};
  }

  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) {
    return {};
  }

  const frontmatter: SkillFrontmatter = {};
  const lines = match[1].split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    let value = rawValue.replace(/^["']|["']$/g, '');

    if (rawValue === '>' || rawValue === '|') {
      const blockLines: string[] = [];

      while (index + 1 < lines.length) {
        const nextLine = lines[index + 1];
        if (nextLine.trim().length === 0) {
          blockLines.push('');
          index += 1;
          continue;
        }

        if (!/^\s+/.test(nextLine)) {
          break;
        }

        blockLines.push(nextLine);
        index += 1;
      }

      value = parseBlockScalar(blockLines, rawValue);
    }

    if (key === 'name') frontmatter.name = value;
    if (key === 'description') frontmatter.description = value;
  }

  return frontmatter;
}

export function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
}

function parseBlockScalar(lines: string[], style: '>' | '|'): string {
  const normalizedLines = dedentBlockLines(lines);
  if (style === '|') {
    return normalizedLines.join('\n').trim();
  }

  const paragraphs: string[] = [];
  let currentParagraph: string[] = [];

  for (const line of normalizedLines) {
    if (line.trim().length === 0) {
      if (currentParagraph.length > 0) {
        paragraphs.push(currentParagraph.join(' '));
        currentParagraph = [];
      }
      continue;
    }

    currentParagraph.push(line.trim());
  }

  if (currentParagraph.length > 0) {
    paragraphs.push(currentParagraph.join(' '));
  }

  return paragraphs.join('\n\n').trim();
}

function dedentBlockLines(lines: string[]): string[] {
  let minIndent = Number.POSITIVE_INFINITY;

  for (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }

    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    minIndent = Math.min(minIndent, indent);
  }

  if (!Number.isFinite(minIndent)) {
    return [];
  }

  return lines.map((line) => {
    if (line.trim().length === 0) {
      return '';
    }

    return line.slice(minIndent);
  });
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
