/**
 * Skills Module Facade (ADR-0020 & AGENTS.md)
 * 严格对外导出该模块公开的 Service、Router 和契约类型。
 */

export { SkillService, BuiltinSkillService, type SkillServiceOptions } from './service.js';
export { skillsRouter } from './router.js';

export type {
  SkillFrontmatter,
  SkillDefinition,
  DiscoveredSkill,
  SkillListItem,
  SystemPromptBuilder,
} from './types.js';
