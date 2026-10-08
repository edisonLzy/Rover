import { Type, type Static } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { SkillService } from './service.js';

export const ReadSkillParams = Type.Object({
  name: Type.String({
    description: "The name of the skill to load (e.g. 'dispatch-agent').",
  }),
});

export type ReadSkillParamsType = Static<typeof ReadSkillParams>;

export function createReadSkillTool(skillService: SkillService): AgentTool<typeof ReadSkillParams> {
  return {
    name: 'read_skill',
    label: 'Read Skill',
    description:
      'Load the full standard operating procedure (SOP) and instructions for a specific skill from available skills.',
    parameters: ReadSkillParams,
    async execute(toolCallId: string, params: ReadSkillParamsType) {
      const skillName = params.name.trim();
      const body = skillService.readSkillBody(skillName);

      if (!body) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: Skill "${skillName}" not found. Please choose from the <available_skills> list.`,
            },
          ],
          details: { error: 'skill_not_found', skillName },
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `<skill name="${skillName}">\n${body}\n</skill>`,
          },
        ],
        details: { skillName, loaded: true },
      };
    },
  };
}
