import * as path from 'node:path';

import { loadMarkdownResource } from '../helpers/markdown-resource';
import { renderTemplate } from '../helpers/template-renderer';

type SetupProtocolAgent = 'opencode' | 'claude-code' | 'codex';

const MEMORY_PROTOCOL_TEMPLATE_PATH = path.resolve(
  __dirname,
  '..',
  'resources',
  'protocols',
  'mind-memory-protocol.template.md'
);

function getProtocolContext(agent: SetupProtocolAgent): Record<string, string | boolean> {
  if (agent === 'opencode') {
    return {
      protocolLabel: 'mind',
      useWhenConnected: false,
      connectedAgentLabel: '',
      useBeforeToolsWording: true,
      useCallBeforeSessionWording: false,
    };
  }

  if (agent === 'claude-code') {
    return {
      protocolLabel: 'Claude Code',
      useWhenConnected: true,
      connectedAgentLabel: 'Claude Code',
      useBeforeToolsWording: false,
      useCallBeforeSessionWording: true,
    };
  }

  return {
    protocolLabel: 'Codex',
    useWhenConnected: true,
    connectedAgentLabel: 'Codex',
    useBeforeToolsWording: false,
    useCallBeforeSessionWording: true,
  };
}

export function renderMemoryProtocol(agent: SetupProtocolAgent): string {
  const template = loadMarkdownResource(MEMORY_PROTOCOL_TEMPLATE_PATH);
  return renderTemplate(template, getProtocolContext(agent));
}
