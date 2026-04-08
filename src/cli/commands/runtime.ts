import { runApiServer } from '../../api/server';
import { startMcpHttpServer, startMcpServer } from '../../mcp/server';
import type { MindStore } from '../../store/mind-store';
import { ArgParser } from '../arg-parser';
import { getSupportedAgents } from '../capabilities';
import { runUpdateCommand } from '../self-update';
import {
  listAgents,
  runSetup,
  startMcpDetached,
  startServeDetached,
  statusServers,
  stopMcp,
  stopServe,
} from '../setup';

import type { CommandGroup } from './types';

const p = ArgParser.param.bind(ArgParser);

const SERVER_STATUS = new ArgParser(['server-status'], 'Shows server status (MCP and web)');

const MCP_STDIO = new ArgParser(['mcp'], 'Starts MCP server (stdio mode)');
const MCP_START = new ArgParser(['mcp', 'start'], 'Starts MCP server', [
  { name: 'detached', hasValue: false, description: 'run in background' },
  { name: 'port', hasValue: true, description: 'custom port (HTTP mode)' },
  { name: 'http', hasValue: false, description: 'run MCP over HTTP' },
]);
const MCP_STOP = new ArgParser(['mcp', 'stop'], 'Stops MCP server');

const SERVE_START = new ArgParser(['serve|server|web', 'start'], 'Starts web HTTP server', [
  { name: 'detached', hasValue: false, description: 'run in background' },
  { name: 'port', hasValue: true, description: 'custom port' },
]);
const SERVE_STOP = new ArgParser(['serve|server|web', 'stop'], 'Stops web HTTP server');

const SETUP = new ArgParser(['setup|install'], 'Lists supported agents for setup');
const SETUP_AGENT = new ArgParser(
  ['setup|install', p('agent')],
  `Setup agent MCP integration.\n\tSupported agents: ${getSupportedAgents().join(', ')}`
);

const UPDATE = new ArgParser(['update'], 'Updates mind from GitHub releases', [
  { name: 'check', hasValue: false, description: 'check if update is available' },
  { name: 'version', hasValue: true, description: 'install a specific release tag' },
  { name: 'repo', hasValue: true, description: 'override GitHub repo' },
]);

async function runMcpForeground(
  flags: Record<string, string | boolean>,
  store: MindStore
): Promise<void> {
  const http = !!flags.http;
  const port = flags.port ? Number(flags.port) : Number(process.env.MCP_PORT ?? 7438);

  if (http) {
    await startMcpHttpServer(store, port);
    await new Promise(() => {});
    return;
  }

  await startMcpServer(store);
  await new Promise(() => {});
}

export const runtimeGroup: CommandGroup = {
  name: 'Server',
  helpEntries: [
    SERVER_STATUS,
    MCP_STDIO,
    MCP_START,
    MCP_STOP,
    SERVE_START,
    SERVE_STOP,
    SETUP_AGENT,
    UPDATE,
  ],
  commands: [
    {
      matches: args => SERVER_STATUS.matches(args),
      execute: async () => {
        await statusServers();
      },
    },
    {
      matches: args => MCP_START.matches(args),
      execute: async (args, store) => {
        const flags = MCP_START.getFlags(args);
        if (flags.detached) {
          await startMcpDetached();
          return;
        }
        await runMcpForeground(flags, store);
      },
    },
    {
      matches: args => MCP_STOP.matches(args),
      execute: async () => {
        await stopMcp();
      },
    },
    {
      matches: args => MCP_STDIO.matches(args),
      execute: async (_args, store) => {
        await runMcpForeground({}, store);
      },
    },
    {
      matches: args => SERVE_START.matches(args),
      execute: async (args, store) => {
        const flags = SERVE_START.getFlags(args);
        const port = flags.port ? Number(flags.port) : undefined;
        if (flags.detached) {
          await startServeDetached(port);
          return;
        }
        await runApiServer(port, store);
      },
    },
    {
      matches: args => SERVE_STOP.matches(args),
      execute: async () => {
        await stopServe();
      },
    },
    {
      matches: args => SETUP_AGENT.matches(args),
      execute: async args => {
        const { agent } = SETUP_AGENT.getParams(args);
        await runSetup(agent);
      },
    },
    {
      matches: args => SETUP.matches(args),
      execute: async () => {
        console.log('mind setup <agent>  Setup MCP for an agent');
        console.log('');
        listAgents();
      },
    },
    {
      matches: args => UPDATE.matches(args),
      execute: async args => {
        await runUpdateCommand(args.slice(1));
      },
    },
  ],
};
