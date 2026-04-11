import { stringify } from 'yaml';

type TextContent = { type: 'text'; text: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function omitUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.filter(item => item !== undefined).map(item => omitUndefinedDeep(item)) as T;
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([key, entryValue]) => [key, omitUndefinedDeep(entryValue)])
    ) as T;
  }

  return value;
}

export function buildYamlContent<T extends object>(
  payload: T
): { content: TextContent[]; structuredContent: T } & T {
  const structuredContent = omitUndefinedDeep(payload);

  return {
    content: [{ type: 'text', text: stringify(structuredContent, { directives: false }) }],
    structuredContent,
    ...structuredContent,
  };
}

export type SoftError = {
  code: string;
  message: string;
};
