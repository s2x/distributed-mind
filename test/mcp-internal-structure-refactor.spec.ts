import { describe, expect, test } from 'bun:test';

import { zodToJsonSchema as serverZodToJsonSchema } from '../src/mcp/server';
import { createCheckpointTools } from '../src/mcp/tools/checkpoint';
import { createLinkTools } from '../src/mcp/tools/links';
import { createMemoryTools } from '../src/mcp/tools/memories';
import { createSpaceTools } from '../src/mcp/tools/spaces';
import { createStatusTools } from '../src/mcp/tools/status';
import { createSystemTools } from '../src/mcp/tools/system';

const PROJECT_ROOT = '/home/gabriel/Git/mind';

describe('MCP internal structure refactor', () => {
  test('tool modules stay as declarations and wiring only', async () => {
    const toolFiles = [
      'src/mcp/tools/spaces.ts',
      'src/mcp/tools/memories.ts',
      'src/mcp/tools/links.ts',
      'src/mcp/tools/checkpoint.ts',
      'src/mcp/tools/status.ts',
      'src/mcp/tools/system.ts',
    ];

    for (const relativePath of toolFiles) {
      const content = await Bun.file(`${PROJECT_ROOT}/${relativePath}`).text();

      expect(content).not.toContain('handler: async');
      expect(content).not.toContain('buildYamlContent');
      expect(content).not.toContain('z.object(');
    }

    expect(await Bun.file(`${PROJECT_ROOT}/src/mcp/tools/yaml-response.ts`).exists()).toBe(false);
  });

  test('new helper and endpoint modules are present at semantic paths', async () => {
    const requiredFiles = [
      'src/helpers/memory-ref-resolver.ts',
      'src/mcp/helpers/json-schema.ts',
      'src/mcp/helpers/yaml-response.ts',
      'src/mcp/handlers/spaces/create-space.ts',
      'src/mcp/handlers/spaces/list-spaces.ts',
      'src/mcp/handlers/spaces/get-space.ts',
      'src/mcp/handlers/spaces/update-space.ts',
      'src/mcp/handlers/spaces/delete-space.ts',
      'src/mcp/handlers/memories/add-memory.ts',
      'src/mcp/handlers/memories/read-memory.ts',
      'src/mcp/handlers/memories/update-memory.ts',
      'src/mcp/handlers/memories/delete-memory.ts',
      'src/mcp/handlers/memories/query-memories.ts',
      'src/mcp/handlers/links/create-link.ts',
      'src/mcp/handlers/links/delete-link.ts',
      'src/mcp/handlers/checkpoint/save-checkpoint.ts',
      'src/mcp/handlers/checkpoint/done-checkpoint.ts',
      'src/mcp/handlers/checkpoint/load-checkpoint.ts',
      'src/mcp/handlers/checkpoint/query-checkpoints.ts',
      'src/mcp/handlers/status/get-status.ts',
      'src/mcp/handlers/system/get-system-instructions.ts',
      'src/mcp/schemas/spaces/create-space.ts',
      'src/mcp/schemas/spaces/list-spaces.ts',
      'src/mcp/schemas/spaces/get-space.ts',
      'src/mcp/schemas/spaces/update-space.ts',
      'src/mcp/schemas/spaces/delete-space.ts',
      'src/mcp/schemas/memories/add-memory.ts',
      'src/mcp/schemas/memories/read-memory.ts',
      'src/mcp/schemas/memories/update-memory.ts',
      'src/mcp/schemas/memories/delete-memory.ts',
      'src/mcp/schemas/memories/query-memories.ts',
      'src/mcp/schemas/links/create-link.ts',
      'src/mcp/schemas/links/delete-link.ts',
      'src/mcp/schemas/checkpoint/save-checkpoint.ts',
      'src/mcp/schemas/checkpoint/done-checkpoint.ts',
      'src/mcp/schemas/checkpoint/load-checkpoint.ts',
      'src/mcp/schemas/checkpoint/query-checkpoints.ts',
      'src/mcp/schemas/status/get-status.ts',
      'src/mcp/schemas/system/get-system-instructions.ts',
    ];

    for (const relativePath of requiredFiles) {
      expect(await Bun.file(`${PROJECT_ROOT}/${relativePath}`).exists()).toBe(true);
    }
  });

  test('import stability is preserved for tool factories and zodToJsonSchema', async () => {
    const jsonSchemaHelpers = await import('../src/mcp/helpers/json-schema');
    const refResolver = await import('../src/helpers/memory-ref-resolver');

    expect(typeof createSpaceTools).toBe('function');
    expect(typeof createMemoryTools).toBe('function');
    expect(typeof createLinkTools).toBe('function');
    expect(typeof createCheckpointTools).toBe('function');
    expect(typeof createStatusTools).toBe('function');
    expect(typeof createSystemTools).toBe('function');
    expect(serverZodToJsonSchema).toBe(jsonSchemaHelpers.zodToJsonSchema);
    expect(typeof refResolver.resolveRefWithFallback).toBe('function');
  });
});
