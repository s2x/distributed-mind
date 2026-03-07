import * as fs from 'fs';
import * as path from 'path';

interface ReleaseInfo {
  tag_name: string;
}

const DEFAULT_REPO = 'Gentleman-Programming/mind';

function getRootPath(): string {
  return path.resolve(import.meta.dir, '..', '..', '..');
}

function getInstallerPath(): string {
  return path.join(getRootPath(), 'scripts', 'install.sh');
}

function getCurrentVersion(): string {
  const packageJsonPath = path.join(getRootPath(), 'package.json');
  const raw = fs.readFileSync(packageJsonPath, 'utf-8');
  const pkg = JSON.parse(raw) as { version?: string };
  return pkg.version ?? '0.0.0';
}

async function getLatestTag(repo: string): Promise<string> {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'mind-cli',
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`No releases found for ${repo}. Publish a release first or pass --version <tag>.`);
    }
    throw new Error(`Failed to fetch latest release: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as ReleaseInfo;
  if (!data.tag_name) {
    throw new Error('Latest release has no tag_name');
  }
  return data.tag_name;
}

function parseArgs(args: string[]): { check: boolean; version?: string; repo: string } {
  let check = false;
  let version: string | undefined;
  let repo = DEFAULT_REPO;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--check') {
      check = true;
      continue;
    }
    if (arg === '--version') {
      version = args[i + 1];
      i++;
      continue;
    }
    if (arg === '--repo') {
      repo = args[i + 1] ?? repo;
      i++;
      continue;
    }
  }

  return { check, version, repo };
}

export async function runUpdateCommand(args: string[]): Promise<void> {
  const { check, version, repo } = parseArgs(args);

  const current = getCurrentVersion();
  const target = version ?? await getLatestTag(repo);

  console.log(`Current version: ${current}`);
  console.log(`Target version:  ${target}`);

  if (check) {
    if (current === target.replace(/^v/, '')) {
      console.log('mind is up to date.');
    } else {
      console.log('A newer version is available. Run `mind update` to install it.');
    }
    return;
  }

  const installerPath = getInstallerPath();
  if (!fs.existsSync(installerPath)) {
    throw new Error(`Installer not found at ${installerPath}`);
  }

  console.log('Running installer...');

  const proc = Bun.spawn(['bash', installerPath], {
    env: {
      ...process.env,
      MIND_INSTALL_REF: target,
      MIND_INSTALL_REPO: repo,
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`Update failed (installer exit code: ${code})`);
  }

  console.log('Update complete.');
}
