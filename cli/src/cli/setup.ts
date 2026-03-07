import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';

type Agent = 'claude-code' | 'opencode' | 'codex' | 'cursor' | 'windsurf' | 'gemini-cli';

interface AgentConfig {
    name: string;
    configPath: string;
    format: 'json' | 'toml';
    build: (mcpUrl: string, mindPath: string) => string | Record<string, unknown>;
}

const DEFAULT_MCP_PORT = 7438;
const DEFAULT_WEB_PORT = 3000;

function ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function getMindScriptPath(): string {
    const script = path.resolve(__dirname, '..', '..', '..', 'mind');
    if (fs.existsSync(script)) {
        return script;
    }
    return 'mind';
}

function getMindEntryPath(): string {
    return path.resolve(__dirname, '..', 'mind.ts');
}

function getPidDir(): string {
    return path.join(homedir(), '.mind');
}

function getPidPath(name: 'mcp' | 'serve'): string {
    return path.join(getPidDir(), `${name}.pid`);
}

function writePid(name: 'mcp' | 'serve', pid: number): void {
    ensureDir(getPidDir());
    fs.writeFileSync(getPidPath(name), String(pid));
}

function readPid(name: 'mcp' | 'serve'): number | null {
    const pidPath = getPidPath(name);
    if (!fs.existsSync(pidPath)) return null;
    const pid = Number(fs.readFileSync(pidPath, 'utf-8').trim());
    return Number.isFinite(pid) ? pid : null;
}

function clearPid(name: 'mcp' | 'serve'): void {
    const pidPath = getPidPath(name);
    if (fs.existsSync(pidPath)) {
        fs.unlinkSync(pidPath);
    }
}

function isProcessRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function readJson(filePath: string): Record<string, unknown> {
    if (!fs.existsSync(filePath)) return {};
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    } catch {
        return {};
    }
}

function writeJson(filePath: string, value: Record<string, unknown>): void {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function readText(filePath: string): string {
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf-8');
}

function writeText(filePath: string, content: string): void {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, content);
}

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(patch)) {
        const existing = out[k];
        if (
            existing &&
            typeof existing === 'object' &&
            !Array.isArray(existing) &&
            v &&
            typeof v === 'object' &&
            !Array.isArray(v)
        ) {
            out[k] = deepMerge(existing as Record<string, unknown>, v as Record<string, unknown>);
        } else {
            out[k] = v;
        }
    }
    return out;
}

function getMcpPort(): number {
    return Number(process.env.MCP_PORT ?? DEFAULT_MCP_PORT);
}

function getWebPort(): number {
    return Number(process.env.PORT ?? DEFAULT_WEB_PORT);
}

export async function startMcpDetached(): Promise<void> {
    const existingPid = readPid('mcp');
    if (existingPid && isProcessRunning(existingPid)) {
        console.log(`MCP server already running (pid: ${existingPid})`);
        return;
    }

    const bunPath = process.execPath;
    const mindEntry = getMindEntryPath();
    const port = String(getMcpPort());
    const child = spawn(bunPath, ['run', mindEntry, 'mcp', 'start', '--http', '--port', port], {
        detached: true,
        stdio: 'ignore',
    });
    child.unref();

    if (!child.pid) {
        console.log('Failed to start MCP server');
        return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
    if (!isProcessRunning(child.pid)) {
        console.log('Failed to start MCP server (process exited immediately). Check port availability.');
        return;
    }

    writePid('mcp', child.pid);
    console.log(`✅ MCP server started (pid: ${child.pid}) on http://localhost:${port}/mcp`);
}

export async function stopMcp(): Promise<void> {
    const pid = readPid('mcp');
    if (!pid) {
        console.log('MCP server not running');
        return;
    }

    if (!isProcessRunning(pid)) {
        clearPid('mcp');
        console.log('MCP server not running');
        return;
    }

    process.kill(pid, 'SIGTERM');
    clearPid('mcp');
    console.log(`✅ MCP server stopped (pid: ${pid})`);
}

export async function startServeDetached(port?: number): Promise<void> {
    const existingPid = readPid('serve');
    if (existingPid && isProcessRunning(existingPid)) {
        console.log(`Web server already running (pid: ${existingPid})`);
        return;
    }

    const bunPath = process.execPath;
    const mindEntry = getMindEntryPath();
    const finalPort = String(port ?? getWebPort());
    const child = spawn(bunPath, ['run', mindEntry, 'serve', 'start', '--port', finalPort], {
        detached: true,
        stdio: 'ignore',
    });
    child.unref();

    if (!child.pid) {
        console.log('Failed to start web server');
        return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
    if (!isProcessRunning(child.pid)) {
        console.log('Failed to start web server (process exited immediately). Check port availability.');
        return;
    }

    writePid('serve', child.pid);
    console.log(`✅ Web server started (pid: ${child.pid}) on http://localhost:${finalPort}`);
}

export async function stopServe(): Promise<void> {
    const pid = readPid('serve');
    if (!pid) {
        console.log('Web server not running');
        return;
    }

    if (!isProcessRunning(pid)) {
        clearPid('serve');
        console.log('Web server not running');
        return;
    }

    process.kill(pid, 'SIGTERM');
    clearPid('serve');
    console.log(`✅ Web server stopped (pid: ${pid})`);
}

export async function statusServers(): Promise<void> {
    const mcpPid = readPid('mcp');
    const servePid = readPid('serve');
    const mcpStatus = mcpPid && isProcessRunning(mcpPid) ? `running (pid: ${mcpPid})` : 'stopped';
    const serveStatus = servePid && isProcessRunning(servePid) ? `running (pid: ${servePid})` : 'stopped';

    console.log('Mind Servers Status:');
    console.log(`  MCP:  ${mcpStatus}  -> http://localhost:${getMcpPort()}/mcp`);
    console.log(`  Web:  ${serveStatus}  -> http://localhost:${getWebPort()}`);
}

function getAgentConfig(agent: Agent): AgentConfig {
    const mcpUrl = `http://localhost:${getMcpPort()}/mcp`;

    const map: Record<Agent, AgentConfig> = {
        'claude-code': {
            name: 'Claude Code',
            configPath: path.join(homedir(), '.claude', 'settings.json'),
            format: 'json',
            build: () => ({
                mcpServers: {
                    mind: {
                        url: mcpUrl,
                    },
                },
            }),
        },
        opencode: {
            name: 'OpenCode',
            configPath: path.join(homedir(), '.config', 'opencode', 'opencode.json'),
            format: 'json',
            build: () => ({
                mcp: {
                    mind: {
                        type: 'http',
                        url: mcpUrl,
                        enabled: true,
                    },
                },
            }),
        },
        codex: {
            name: 'Codex',
            configPath: path.join(homedir(), '.codex', 'config.toml'),
            format: 'toml',
            build: (_url, mindPath) => {
                return `\n[mcp_servers.mind]\ncommand = "${mindPath}"\nargs = ["mcp", "start", "--http"]\n`;
            },
        },
        cursor: {
            name: 'Cursor',
            configPath: path.join(homedir(), '.cursor', 'mcp.json'),
            format: 'json',
            build: () => ({
                mcpServers: {
                    mind: { url: mcpUrl },
                },
            }),
        },
        windsurf: {
            name: 'Windsurf',
            configPath: path.join(homedir(), '.windsurf', 'mcp.json'),
            format: 'json',
            build: () => ({
                mcpServers: {
                    mind: { url: mcpUrl },
                },
            }),
        },
        'gemini-cli': {
            name: 'Gemini CLI',
            configPath: path.join(homedir(), '.gemini', 'settings.json'),
            format: 'json',
            build: () => ({
                mcpServers: {
                    mind: { url: mcpUrl },
                },
            }),
        },
    };

    return map[agent];
}

export async function runSetup(agent: Agent): Promise<void> {
    const cfg = getAgentConfig(agent);
    if (!cfg) {
        throw new Error(`Unsupported agent: ${agent}`);
    }
    const mcpUrl = `http://localhost:${getMcpPort()}/mcp`;
    const mindPath = getMindScriptPath();

    if (cfg.format === 'json') {
        const current = readJson(cfg.configPath);
        const patch = cfg.build(mcpUrl, mindPath) as Record<string, unknown>;
        const merged = deepMerge(current, patch);
        writeJson(cfg.configPath, merged);
    } else {
        const current = readText(cfg.configPath);
        const snippet = cfg.build(mcpUrl, mindPath) as string;
        const merged = current.includes('[mcp_servers.mind]') ? current : `${current}${snippet}`;
        writeText(cfg.configPath, merged);
    }

    console.log(`✅ Setup complete for ${cfg.name}`);
    console.log(`- Config updated: ${cfg.configPath}`);
    console.log('- Start MCP server with: `mind mcp start --detached`');
}

export function listAgents(): void {
    console.log('Supported agents:');
    console.log('  claude-code');
    console.log('  opencode');
    console.log('  codex');
    console.log('  cursor');
    console.log('  windsurf');
    console.log('  gemini-cli');
}
