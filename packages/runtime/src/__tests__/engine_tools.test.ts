import { describe, it, expect } from 'vitest';
import { openDatabase } from '../storage/db.js';
import { runMigrations } from '../storage/migrator.js';
import { RoverTurnEngine } from '../agent/engine.js';
import { fileURLToPath } from 'node:url';

describe('RoverTurnEngine Controlled Tools & Skills Integration', () => {
  it('automatically equips BuiltinSkillService and controlled tools', () => {
    const db = openDatabase({ path: ':memory:' });
    runMigrations(db.raw);

    const engine = new RoverTurnEngine({
      db,
      skillsDir: fileURLToPath(new URL('../../../app/resources/skills/', import.meta.url)),
    });

    // 1. Verify skill service
    const skillService = engine.getSkillService();
    expect(skillService).toBeDefined();
    const skills = skillService.getSkills();
    expect(skills.some((s) => s.name === 'dispatch-agent')).toBe(true);

    // 2. Verify controlled tools
    const tools = engine.getTools();
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain('read_skill');
    expect(toolNames).toContain('dispatch_agent');

    // 3. Verify read_skill can be executed directly from engine tool registry
    const readSkillTool = tools.find((t) => t.name === 'read_skill');
    expect(readSkillTool).toBeDefined();
    db.close();
  });
});
