export type SupportedAgent = 'claude-code' | 'opencode' | 'codex' | 'cursor' | 'windsurf' | 'gemini-cli';
export type RoadmapAgent = 'vscode' | 'antigravity' | 'kiro';
export type ExperimentalAgent = 'openclaw';
export type Agent = SupportedAgent | RoadmapAgent | ExperimentalAgent;

export type CapabilityLevel = 'L1_MCP' | 'L2_INSTRUCTIONS' | 'L3_HOOKS';
export type CapabilityStatus = 'supported' | 'unsupported' | 'unverified';

export interface CapabilityDeclaration {
    status: CapabilityStatus;
    confidence: 'high' | 'medium' | 'low';
    evidence: string;
    fallback: string;
}

export type CapabilityMap = Record<CapabilityLevel, CapabilityDeclaration>;

export interface CapabilityMatrixEntry {
    agent: Agent | ExperimentalAgent;
    name: string;
    capabilities: CapabilityMap;
}

export interface SupportedAgentDefinition {
    agent: SupportedAgent;
    name: string;
    capabilities: CapabilityMap;
}

const CLAUDE_HOOKS_OPT_IN_ENV = 'MIND_SETUP_CLAUDE_ENABLE_HOOKS';

export const CAPABILITY_LABELS: Record<CapabilityLevel, string> = {
    L1_MCP: 'L1 MCP transport',
    L2_INSTRUCTIONS: 'L2 instruction/protocol injection',
    L3_HOOKS: 'L3 hooks/session/compaction automation',
};

const SUPPORTED_AGENT_CAPABILITIES: SupportedAgentDefinition[] = [
    {
        agent: 'claude-code',
        name: 'Claude Code',
        capabilities: {
            L1_MCP: {
                status: 'supported',
                confidence: 'high',
                evidence: 'Writes ~/.claude/settings.json mcpServers.mind URL.',
                fallback: 'N/A',
            },
            L2_INSTRUCTIONS: {
                status: 'supported',
                confidence: 'high',
                evidence:
                    'Writes managed protocol markdown and injects/refreshes a managed section in ~/.claude/CLAUDE.md.',
                fallback: 'If file writes fail, use AGENTS.md and MCP system_instructions manually.',
            },
            L3_HOOKS: {
                status: 'supported',
                confidence: 'medium',
                evidence: `Opt-in hook automation available via ${CLAUDE_HOOKS_OPT_IN_ENV}=true; setup writes a managed hook script and non-destructively appends a Stop hook entry.`,
                fallback: `Default remains non-hook mode; run session/compaction protocol manually if opt-in is disabled or unsupported by local Claude tooling.`,
            },
        },
    },
    {
        agent: 'opencode',
        name: 'OpenCode',
        capabilities: {
            L1_MCP: {
                status: 'supported',
                confidence: 'high',
                evidence: 'Writes ~/.config/opencode/opencode.json mcp.mind local command transport configuration.',
                fallback: 'N/A',
            },
            L2_INSTRUCTIONS: {
                status: 'supported',
                confidence: 'high',
                evidence:
                    'Injects managed mind-memory-protocol.md path first, exact-once, with mind_system_instructions directive.',
                fallback: 'N/A',
            },
            L3_HOOKS: {
                status: 'supported',
                confidence: 'medium',
                evidence:
                    'OpenCode prudent automation is configured by default; setup writes a managed plugin with session.created/session.compacted handlers and experimental.session.compacting context injection.',
                fallback:
                    'If plugin write or hook execution fails, setup continues and the managed protocol file keeps the manual continuity workflow available.',
            },
        },
    },
    {
        agent: 'codex',
        name: 'Codex',
        capabilities: {
            L1_MCP: {
                status: 'supported',
                confidence: 'medium',
                evidence: 'Writes [mcp_servers.mind] stanza in ~/.codex/config.toml.',
                fallback: 'N/A',
            },
            L2_INSTRUCTIONS: {
                status: 'supported',
                confidence: 'high',
                evidence: 'Upserts a managed protocol block in ~/.codex/AGENTS.md non-destructively.',
                fallback:
                    'If AGENTS.md write fails, use repository protocol docs and MCP system instructions manually.',
            },
            L3_HOOKS: {
                status: 'unsupported',
                confidence: 'high',
                evidence: 'No automated session/compaction hooks implemented.',
                fallback: 'Run session closure protocol manually.',
            },
        },
    },
    {
        agent: 'cursor',
        name: 'Cursor',
        capabilities: {
            L1_MCP: {
                status: 'supported',
                confidence: 'high',
                evidence: 'Writes ~/.cursor/mcp.json mcpServers.mind URL.',
                fallback: 'N/A',
            },
            L2_INSTRUCTIONS: {
                status: 'unverified',
                confidence: 'low',
                evidence: 'No concrete instruction/protocol injection path implemented or validated for Cursor.',
                fallback: 'Use AGENTS.md / manual protocol guidance until verified.',
            },
            L3_HOOKS: {
                status: 'supported',
                confidence: 'medium',
                evidence:
                    'Writes ~/.cursor/hooks.json with managed global hook entries and managed executable hook script under ~/.cursor/hooks/.',
                fallback:
                    'If hook file/script writes fail, setup continues and manual checkpoint/session continuity workflow remains available.',
            },
        },
    },
    {
        agent: 'windsurf',
        name: 'Windsurf',
        capabilities: {
            L1_MCP: {
                status: 'supported',
                confidence: 'high',
                evidence: 'Writes ~/.windsurf/mcp.json mcpServers.mind URL.',
                fallback: 'N/A',
            },
            L2_INSTRUCTIONS: {
                status: 'unsupported',
                confidence: 'high',
                evidence: 'No instruction/protocol injection integration implemented for Windsurf.',
                fallback: 'Use manual protocol prompts.',
            },
            L3_HOOKS: {
                status: 'unsupported',
                confidence: 'high',
                evidence: 'No hooks/session automation code for Windsurf.',
                fallback: 'Execute workflow steps manually.',
            },
        },
    },
    {
        agent: 'gemini-cli',
        name: 'Gemini CLI',
        capabilities: {
            L1_MCP: {
                status: 'supported',
                confidence: 'high',
                evidence: 'Writes ~/.gemini/settings.json mcpServers.mind URL.',
                fallback: 'N/A',
            },
            L2_INSTRUCTIONS: {
                status: 'unsupported',
                confidence: 'high',
                evidence: 'No managed instruction/protocol injection is implemented for Gemini CLI.',
                fallback: 'Use project protocol docs manually.',
            },
            L3_HOOKS: {
                status: 'unsupported',
                confidence: 'high',
                evidence: 'No hook/session automation implemented for Gemini CLI.',
                fallback: 'Perform session and compaction actions manually.',
            },
        },
    },
];

const ROADMAP_AGENT_CAPABILITIES: Record<RoadmapAgent, CapabilityMatrixEntry> = {
    vscode: {
        agent: 'vscode',
        name: 'VSCode (roadmap)',
        capabilities: {
            L1_MCP: {
                status: 'unverified',
                confidence: 'low',
                evidence: 'Roadmap target only; no adapter implementation merged yet.',
                fallback: 'Use manual MCP wiring until adapter support is implemented and validated.',
            },
            L2_INSTRUCTIONS: {
                status: 'unsupported',
                confidence: 'high',
                evidence: 'No managed protocol injection integration implemented for VSCode yet.',
                fallback: 'Use repository protocol files manually.',
            },
            L3_HOOKS: {
                status: 'unsupported',
                confidence: 'high',
                evidence: 'No hooks/session automation implementation for VSCode yet.',
                fallback: 'Run session continuity steps manually.',
            },
        },
    },
    antigravity: {
        agent: 'antigravity',
        name: 'Antigravity (roadmap)',
        capabilities: {
            L1_MCP: {
                status: 'unverified',
                confidence: 'low',
                evidence: 'Roadmap target only; no adapter implementation merged yet.',
                fallback: 'Use manual MCP wiring until adapter support is implemented and validated.',
            },
            L2_INSTRUCTIONS: {
                status: 'unsupported',
                confidence: 'high',
                evidence: 'No managed protocol injection integration implemented for Antigravity yet.',
                fallback: 'Use repository protocol files manually.',
            },
            L3_HOOKS: {
                status: 'unsupported',
                confidence: 'high',
                evidence: 'No hooks/session automation implementation for Antigravity yet.',
                fallback: 'Run session continuity steps manually.',
            },
        },
    },
    kiro: {
        agent: 'kiro',
        name: 'Kiro (roadmap)',
        capabilities: {
            L1_MCP: {
                status: 'unverified',
                confidence: 'low',
                evidence: 'Roadmap target only; no adapter implementation merged yet.',
                fallback: 'Use manual MCP wiring until adapter support is implemented and validated.',
            },
            L2_INSTRUCTIONS: {
                status: 'unsupported',
                confidence: 'high',
                evidence: 'No managed protocol injection integration implemented for Kiro yet.',
                fallback: 'Use repository protocol files manually.',
            },
            L3_HOOKS: {
                status: 'unsupported',
                confidence: 'high',
                evidence: 'No hooks/session automation implementation for Kiro yet.',
                fallback: 'Run session continuity steps manually.',
            },
        },
    },
};

const EXPERIMENTAL_AGENT_CAPABILITIES: Record<ExperimentalAgent, CapabilityMatrixEntry> = {
    openclaw: {
        agent: 'openclaw',
        name: 'OpenClaw (experimental)',
        capabilities: {
            L1_MCP: {
                status: 'unverified',
                confidence: 'low',
                evidence: 'Experimental declaration only; no adapter implementation merged or validated yet.',
                fallback:
                    'Treat this experimental integration as unstable and keep using manual MCP wiring until implementation and validation are complete.',
            },
            L2_INSTRUCTIONS: {
                status: 'unsupported',
                confidence: 'high',
                evidence: 'No managed protocol injection integration implemented for OpenClaw experimental adapter.',
                fallback: 'Use repository protocol files manually; do not assume automated instruction injection.',
            },
            L3_HOOKS: {
                status: 'unsupported',
                confidence: 'high',
                evidence: 'No hooks/session automation implementation for OpenClaw experimental adapter.',
                fallback: 'Run session continuity steps manually; no experimental hook support is provided.',
            },
        },
    },
};

const SUPPORTED_AGENT_BY_ID = new Map(SUPPORTED_AGENT_CAPABILITIES.map((entry) => [entry.agent, entry]));

export function getSupportedAgentDefinition(agent: SupportedAgent): SupportedAgentDefinition {
    const definition = SUPPORTED_AGENT_BY_ID.get(agent);
    if (!definition) {
        throw new Error(`Unsupported agent: ${agent}`);
    }
    return definition;
}

export function formatCapabilityLine(level: CapabilityLevel, capability: CapabilityDeclaration): string {
    return `- ${CAPABILITY_LABELS[level]}: ${capability.status} (confidence: ${capability.confidence}, evidence: ${capability.evidence}, fallback: ${capability.fallback})`;
}

export function getAgentCapabilities(agent: Agent): CapabilityMap {
    const roadmap = ROADMAP_AGENT_CAPABILITIES[agent as RoadmapAgent];
    if (roadmap) {
        return roadmap.capabilities;
    }

    const experimental = EXPERIMENTAL_AGENT_CAPABILITIES[agent as ExperimentalAgent];
    if (experimental) {
        return experimental.capabilities;
    }

    return getSupportedAgentDefinition(agent as SupportedAgent).capabilities;
}

export function getAgentCapabilityMatrix(): CapabilityMatrixEntry[] {
    const configuredAgents = SUPPORTED_AGENT_CAPABILITIES.map((definition) => ({
        agent: definition.agent,
        name: definition.name,
        capabilities: definition.capabilities,
    }));

    return [
        ...configuredAgents,
        ...Object.values(EXPERIMENTAL_AGENT_CAPABILITIES),
        ...Object.values(ROADMAP_AGENT_CAPABILITIES),
    ];
}

export function isAgent(value: string): value is Agent {
    return (
        value === 'claude-code' ||
        value === 'opencode' ||
        value === 'codex' ||
        value === 'cursor' ||
        value === 'windsurf' ||
        value === 'gemini-cli' ||
        value === 'vscode' ||
        value === 'antigravity' ||
        value === 'kiro' ||
        value === 'openclaw'
    );
}
