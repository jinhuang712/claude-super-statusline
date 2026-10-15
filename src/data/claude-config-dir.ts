import * as path from 'node:path';
import { adoptLegacyDir, APP_NAME, legacyPaths } from './app-name.js';

function expandHomeDirPrefix(inputPath: string, homeDir: string): string {
  if (inputPath === '~') {
    return homeDir;
  }
  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    return path.join(homeDir, inputPath.slice(2));
  }
  return inputPath;
}

export function getClaudeConfigDir(homeDir: string): string {
  const envConfigDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (!envConfigDir) {
    return path.join(homeDir, '.claude');
  }
  return path.resolve(expandHomeDirPrefix(envConfigDir, homeDir));
}

export function getClaudeConfigJsonPath(homeDir: string): string {
  return `${getClaudeConfigDir(homeDir)}.json`;
}

/**
 * Data/cache root (samples, counter resets, caches). Lives next to Claude Code's own config so
 * multi-account setups ($CLAUDE_CONFIG_DIR) get isolated caches automatically. A folder from an
 * earlier name (`plugins/claude-code-super-statusline`, `plugins/claude-code-ssp`) is moved here on
 * first use (see adoptLegacyDir).
 */
export function getHudPluginDir(homeDir: string): string {
  const plugins = path.join(getClaudeConfigDir(homeDir), 'plugins');
  return adoptLegacyDir(path.join(plugins, APP_NAME), ...legacyPaths(plugins));
}
