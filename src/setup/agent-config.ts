// Data-driven agent configuration for setup.ts
// Replaces the ~400-line inline object map with a config array

import { homedir } from 'os';
import * as path from 'path';

import type { CapabilityMap, SupportedAgent } from '../cli/capabilities';
import { getAgentCapabilities, getSupportedAgentDefinition } from '../cli/capabilities';

export interface AgentConfigEntry {
  name: string;
  configPath: string;
  format: 'json' | 'toml';
  build: (_mcpUrl: string, _mindPath: string) => string | Record<string, unknown>;
  capabilities: CapabilityMap;
}

// VSCode config path resolver (must be a function since it depends on platform)
function getVSCodeUserConfigPath(): string {
  const platform = process.platform;
  if (platform === 'win32') {
    return path.join(process.env.APPDATA || '', 'Code', 'User', 'mcp.json');
  } else if (platform === 'darwin') {
    return path.join(
      process.env.HOME ?? homedir(),
      'Library',
      'Application Support',
      'Code',
      'User',
      'mcp.json'
    );
  } else {
    return path.join(process.env.HOME ?? homedir(), '.config', 'Code', 'User', 'mcp.json');
  }
}

function getHomeDir(): string {
  return process.env.HOME ?? homedir();
}

// JSON config builders for each agent
// Note: build functions receive (_mcpUrl, mindPath) but ignore the first param
function buildJsonMcpConfig(_mcpUrl: string, mindPath: string): Record<string, unknown> {
  return {
    mcpServers: {
      mind: {
        type: 'stdio',
        command: mindPath,
        args: ['mcp'],
        env: {},
      },
    },
  };
}

function buildOpenCodeMcpConfig(_mcpUrl: string, mindPath: string): Record<string, unknown> {
  return {
    mcp: {
      mind: {
        type: 'local',
        command: [mindPath, 'mcp'],
        enabled: true,
      },
    },
  };
}

function buildTomlMcpConfig(_mcpUrl: string, mindPath: string): string {
  return `\n[mcp_servers.mind]\ncommand = "${mindPath}"\nargs = ["mcp"]\n`;
}

// Internal config entry with path components (not yet resolved)
interface AgentConfigInternal {
  agent: SupportedAgent;
  name: string;
  pathComponents: string[]; // Relative path components from home dir
  format: 'json' | 'toml';
  build: (_mcpUrl: string, _mindPath: string) => string | Record<string, unknown>;
  capabilities: CapabilityMap;
}

// Data-driven agent configuration array - keyed by SupportedAgent
// Paths are stored as components, resolved at call time (not module load time)
const AGENT_CONFIGS: AgentConfigInternal[] = [
  {
    agent: 'claude-code',
    name: getSupportedAgentDefinition('claude-code').name,
    pathComponents: ['.claude', 'settings.json'],
    format: 'json',
    build: buildJsonMcpConfig,
    capabilities: getAgentCapabilities('claude-code'),
  },
  {
    agent: 'opencode',
    name: getSupportedAgentDefinition('opencode').name,
    pathComponents: ['.config', 'opencode', 'opencode.json'],
    format: 'json',
    build: buildOpenCodeMcpConfig,
    capabilities: getAgentCapabilities('opencode'),
  },
  {
    agent: 'codex',
    name: getSupportedAgentDefinition('codex').name,
    pathComponents: ['.codex', 'config.toml'],
    format: 'toml',
    build: buildTomlMcpConfig,
    capabilities: getAgentCapabilities('codex'),
  },
  {
    agent: 'cursor',
    name: getSupportedAgentDefinition('cursor').name,
    pathComponents: ['.cursor', 'mcp.json'],
    format: 'json',
    build: buildJsonMcpConfig,
    capabilities: getAgentCapabilities('cursor'),
  },
  {
    agent: 'windsurf',
    name: getSupportedAgentDefinition('windsurf').name,
    pathComponents: ['.windsurf', 'mcp.json'],
    format: 'json',
    build: buildJsonMcpConfig,
    capabilities: getAgentCapabilities('windsurf'),
  },
  {
    agent: 'gemini-cli',
    name: getSupportedAgentDefinition('gemini-cli').name,
    pathComponents: ['.gemini', 'settings.json'],
    format: 'json',
    build: buildJsonMcpConfig,
    capabilities: getAgentCapabilities('gemini-cli'),
  },
  {
    agent: 'vscode',
    name: getSupportedAgentDefinition('vscode').name,
    pathComponents: [], // Platform-dependent, computed dynamically
    format: 'json',
    build: buildJsonMcpConfig,
    capabilities: getAgentCapabilities('vscode'),
  },
  {
    agent: 'antigravity',
    name: getSupportedAgentDefinition('antigravity').name,
    pathComponents: ['.gemini', 'antigravity', 'mcp_config.json'],
    format: 'json',
    build: buildJsonMcpConfig,
    capabilities: getAgentCapabilities('antigravity'),
  },
];

// Lookup map for O(1) access by agent type
const AGENT_CONFIG_MAP = new Map<SupportedAgent, AgentConfigInternal>(
  AGENT_CONFIGS.map(cfg => [cfg.agent, cfg])
);

// Returns the agent config for a given agent type, with configPath resolved at call time
export function getAgentConfig(agent: SupportedAgent): AgentConfigEntry {
  const config = AGENT_CONFIG_MAP.get(agent);
  if (!config) {
    throw new Error(`Unsupported agent: ${agent}`);
  }

  // Compute configPath dynamically at call time (not module load time)
  const configPath =
    config.pathComponents.length > 0
      ? path.join(getHomeDir(), ...config.pathComponents)
      : getVSCodeUserConfigPath(); // VSCode uses platform-specific path

  return {
    name: config.name,
    configPath,
    format: config.format,
    build: config.build,
    capabilities: config.capabilities,
  };
}

// Returns all agent configs (for iteration), with configPath resolved at call time
export function getAllAgentConfigs(): AgentConfigEntry[] {
  return AGENT_CONFIGS.map(config => ({
    name: config.name,
    configPath:
      config.pathComponents.length > 0
        ? path.join(getHomeDir(), ...config.pathComponents)
        : getVSCodeUserConfigPath(),
    format: config.format,
    build: config.build,
    capabilities: config.capabilities,
  }));
}
