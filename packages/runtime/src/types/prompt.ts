import { z } from 'zod';

export const PromptTextPartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

export const PromptReferencePartSchema = z.object({
  type: z.literal('reference'),
  kind: z.enum(['agent', 'skill', 'inbox']),
  id: z.string().min(1),
  label: z.string().min(1),
});

export const PromptPartSchema = z.discriminatedUnion('type', [
  PromptTextPartSchema,
  PromptReferencePartSchema,
]);

export const PromptDocumentV1Schema = z.object({
  v: z.literal(1),
  parts: z.array(PromptPartSchema).min(1),
});

export type PromptTextPart = z.infer<typeof PromptTextPartSchema>;
export type PromptReferencePart = z.infer<typeof PromptReferencePartSchema>;
export type PromptReferenceKind = PromptReferencePart['kind'];
export type PromptPart = z.infer<typeof PromptPartSchema>;
export type PromptDocumentV1 = z.infer<typeof PromptDocumentV1Schema>;

/**
 * Validates and parses an unknown payload as PromptDocumentV1.
 * Throws ZodError if invalid.
 */
export function parsePromptDocument(input: unknown): PromptDocumentV1 {
  return PromptDocumentV1Schema.parse(input);
}

/**
 * Safe parser that returns a boolean success with data or error.
 */
export function safeParsePromptDocument(input: unknown) {
  return PromptDocumentV1Schema.safeParse(input);
}

/**
 * Converts a PromptDocumentV1 into a readable plain text string for display or fallback.
 */
export function promptDocumentToPlainText(doc: PromptDocumentV1): string {
  return doc.parts
    .map((part) => {
      if (part.type === 'text') {
        return part.text;
      }
      return part.label.startsWith('@') || part.label.startsWith('/') || part.label.startsWith('#')
        ? part.label
        : `@${part.label}`;
    })
    .join('');
}
