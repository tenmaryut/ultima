import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join, delimiter } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';

/**
 * Apps started from Finder/Dock/desktop launchers do not inherit the PATH from the
 * user's shell profile, so tools installed with npm, Homebrew, nvm, bun or pipx are
 * invisible. We ask the login shell for its PATH once and merge in well known folders.
 */
export async function fixPathEnv(): Promise<void> {
  const parts = new Set((process.env.PATH ?? '').split(delimiter).filter(Boolean));

  if (process.platform !== 'win32') {
    const shellPath = await readLoginShellPath();
    shellPath?.split(':').forEach((p) => p && parts.add(p));
  }

  for (const dir of extraToolDirs()) {
    if (existsSync(dir)) parts.add(dir);
  }
  process.env.PATH = [...parts].join(delimiter);
}

function readLoginShellPath(): Promise<string | null> {
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  const marker = '__ULTIMA_PATH__';
  return new Promise((resolve) => {
    execFile(
      shell,
      ['-ilc', `printf "${marker}%s${marker}" "$PATH"`],
      { timeout: 4000, env: { ...process.env, DISABLE_AUTO_UPDATE: 'true' } },
      (_error, stdout) => {
        const match = typeof stdout === 'string' ? stdout.split(marker) : [];
        resolve(match.length >= 3 ? match[1] : null);
      },
    );
  });
}

function extraToolDirs(): string[] {
  const home = homedir();
  const dirs: string[] = [];
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
    dirs.push(
      join(appData, 'npm'),
      join(home, '.local', 'bin'),
      join(home, '.bun', 'bin'),
      join(localAppData, 'Programs', 'Ollama'),
      join(localAppData, 'Microsoft', 'WinGet', 'Links'),
      join(home, 'scoop', 'shims'),
      join(home, '.cargo', 'bin'),
    );
  } else {
    dirs.push(
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/snap/bin',
      join(home, '.local', 'bin'),
      join(home, '.npm-global', 'bin'),
      join(home, '.bun', 'bin'),
      join(home, '.volta', 'bin'),
      join(home, '.claude', 'local'),
      join(home, '.cargo', 'bin'),
      join(home, '.opencode', 'bin'),
      join(home, 'bin'),
    );
    // nvm / fnm managed node versions: add every installed version's bin folder.
    for (const base of [join(home, '.nvm', 'versions', 'node'), join(home, '.local', 'share', 'fnm', 'node-versions')]) {
      try {
        for (const v of readdirSync(base)) {
          dirs.push(join(base, v, 'bin'), join(base, v, 'installation', 'bin'));
        }
      } catch {
        // not installed
      }
    }
  }
  return dirs;
}
