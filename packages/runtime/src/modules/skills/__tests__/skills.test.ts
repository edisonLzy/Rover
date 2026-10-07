import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, it, expect, afterEach } from 'vitest';
import { SkillService, BuiltinSkillService } from '../service.js';
import { createReadSkillTool } from '../tool.js';
import { skillsRouter } from '../router.js';

const appSkillsDir = fileURLToPath(
  new URL('../../../../../app/resources/skills/', import.meta.url)
);
const tempDirs: string[] = [];

function createSkillsDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rover skills '));
  tempDirs.push(dir);
  return dir;
}

function writeSkill(dir: string, folder: string, content: string): string {
  const root = path.join(dir, folder);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'SKILL.md'), content);
  return root;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('SkillService and read_skill tool', () => {
  it('exports BuiltinSkillService as alias for SkillService', () => {
    expect(BuiltinSkillService).toBe(SkillService);
  });

  it('loads the dispatch-agent skill from App-owned resources', () => {
    const service = new SkillService({ skillsDir: appSkillsDir });
    const skills = service.getSkills();

    expect(skills.length).toBeGreaterThan(0);
    const dispatchSkill = service.getSkill('dispatch-agent');
    expect(dispatchSkill).toBeDefined();
    expect(dispatchSkill?.name).toBe('dispatch-agent');
    expect(dispatchSkill?.description).toContain('Dispatch coding tasks');
    expect(dispatchSkill?.body).toContain('# Dispatch Agent SOP');
  });

  it('builds Level 1 available_skills section into system prompt', () => {
    const service = new SkillService({ skillsDir: appSkillsDir });
    const prompt = service.buildSystemPrompt('You are Rover.');

    expect(prompt).toContain('You are Rover.');
    expect(prompt).toContain('<available_skills>');
    expect(prompt).toContain('<name>dispatch-agent</name>');
    expect(prompt).toContain("Use the read_skill tool to load a skill's full instructions");
    expect(prompt).toContain('</available_skills>');
  });

  it('read_skill tool returns Level 2 SOP body when skill exists', async () => {
    const service = new SkillService({ skillsDir: appSkillsDir });
    const tool = createReadSkillTool(service);

    const result = await tool.execute('call_1', { name: 'dispatch-agent' });
    expect(result.content[0].type).toBe('text');
    const text = (result.content[0] as { type: 'text'; text: string }).text;

    expect(text).toContain('<skill name="dispatch-agent">');
    expect(text).toContain('Dispatch Agent SOP');
    expect(text).toContain('Working Directory (`cwd`) is Mandatory');
    expect(text).toContain('</skill>');
    expect(result.details).toEqual({ skillName: 'dispatch-agent', loaded: true });
  });

  it('read_skill tool returns clear error message when skill does not exist', async () => {
    const service = new SkillService({ skillsDir: appSkillsDir });
    const tool = createReadSkillTool(service);

    const result = await tool.execute('call_2', { name: 'non-existent-skill' });
    expect(result.content[0].type).toBe('text');
    const text = (result.content[0] as { type: 'text'; text: string }).text;

    expect(text).toContain('Error: Skill "non-existent-skill" not found');
    expect(result.details).toEqual({
      error: 'skill_not_found',
      skillName: 'non-existent-skill',
    });
  });

  it('does not discover App or source resources without host configuration', () => {
    const service = new SkillService();
    expect(service.getSkills()).toEqual([]);
    expect(service.buildSystemPrompt('Base prompt')).toBe('Base prompt');
  });

  it('rejects missing, relative and empty configured directories instead of falling back', () => {
    expect(() => new SkillService({ skillsDir: 'resources/skills' })).toThrow(/absolute path/);
    const dir = createSkillsDir();
    expect(() => new SkillService({ skillsDir: path.join(dir, 'missing') })).toThrow();
    expect(() => new SkillService({ skillsDir: dir })).toThrow(/No builtin skills/);
  });

  it.each([
    '---\ndescription: A description\n---\nInstructions',
    '---\nname: example\n---\nInstructions',
    '---\nname: example\ndescription: A description\n---\n',
    '---\nname: example\ndescription: A description\nInstructions',
  ])('rejects malformed skill resources: %s', (content) => {
    const dir = createSkillsDir();
    writeSkill(dir, 'example', content);
    expect(() => new SkillService({ skillsDir: dir })).toThrow(/Invalid builtin skill/);
  });

  it('rejects duplicate skill names', () => {
    const dir = createSkillsDir();
    const content = '---\nname: example\ndescription: A description\n---\nInstructions';
    writeSkill(dir, 'first', content);
    writeSkill(dir, 'second', content);
    expect(() => new SkillService({ skillsDir: dir })).toThrow(/Duplicate builtin skill/);
  });

  it('retains the skill root for scripts and attachments and supports CRLF frontmatter', () => {
    const dir = createSkillsDir();
    const root = writeSkill(
      dir,
      'example',
      [
        '---',
        'name: example',
        'description: >',
        '  A folded',
        '  description.',
        '---',
        'Use scripts/collect.mjs and references/protocol.md.',
      ].join('\r\n')
    );
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.writeFileSync(
      path.join(root, 'scripts/collect.mjs'),
      'throw new Error("must not execute");'
    );
    const service = new SkillService({ skillsDir: dir });
    expect(service.getSkill('example')).toMatchObject({
      id: 'example',
      description: 'A folded description.',
      rootDir: root,
      filePath: path.join(root, 'SKILL.md'),
    });
  });

  it('loads the same skills and bodies after bundling and copying the resource tree', async () => {
    const dir = createSkillsDir();
    const copiedSkillsDir = path.join(dir, 'App resources', 'skills');
    fs.cpSync(appSkillsDir, copiedSkillsDir, { recursive: true });
    const bundle = path.join(dir, 'skill-loader.cjs');
    await build({
      entryPoints: [fileURLToPath(new URL('../service.ts', import.meta.url))],
      platform: 'node',
      format: 'cjs',
      bundle: true,
      outfile: bundle,
    });
    const { SkillService: BundledService } = createRequire(import.meta.url)(bundle) as {
      SkillService: typeof SkillService;
    };
    const source = new SkillService({ skillsDir: appSkillsDir });
    const bundled = new BundledService({ skillsDir: copiedSkillsDir });
    const definitions = (service: SkillService) =>
      service
        .getSkills()
        .map(({ id, name, description, body }) => ({ id, name, description, body }));
    expect(definitions(bundled)).toEqual(definitions(source));
    expect(new BundledService().getSkills()).toEqual([]);
  });

  describe('skillsRouter', () => {
    it('rejects unauthenticated calls', async () => {
      const service = new SkillService({ skillsDir: appSkillsDir });
      const caller = skillsRouter.createCaller({
        isAuthenticated: false,
        container: { skills: service },
      } as any);

      await expect(caller.list()).rejects.toThrow(/Unauthorized/);
    });

    it('lists skills correctly through router', async () => {
      const service = new SkillService({ skillsDir: appSkillsDir });
      const caller = skillsRouter.createCaller({
        isAuthenticated: true,
        container: { skills: service },
      } as any);

      const result = await caller.list();
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toMatchObject({
        source: 'builtin',
        isEnabled: true,
      });
    });

    it('reads skill body correctly through router', async () => {
      const service = new SkillService({ skillsDir: appSkillsDir });
      const caller = skillsRouter.createCaller({
        isAuthenticated: true,
        container: { skills: service },
      } as any);

      const result = await caller.read({ name: 'dispatch-agent' });
      expect(result.name).toBe('dispatch-agent');
      expect(result.body).toContain('Dispatch Agent SOP');
    });

    it('throws NOT_FOUND when reading non-existent skill', async () => {
      const service = new SkillService({ skillsDir: appSkillsDir });
      const caller = skillsRouter.createCaller({
        isAuthenticated: true,
        container: { skills: service },
      } as any);

      await expect(caller.read({ name: 'non-existent' })).rejects.toThrow(/Skill not found/);
    });
  });
});
