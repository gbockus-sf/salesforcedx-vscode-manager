import * as fs from 'fs';
import { homedir } from 'os';
import * as vscode from 'vscode';
import { ProcessService } from '../services/processService';
import type { CheckDefinition, DependencyStatus } from './types';
import { compare } from './versionCompare';

/**
 * Expands `${HOME}` and `${workspaceFolder}` placeholders in a path string,
 * plus a leading `~` for convenience.
 */
export const expandPath = (raw: string): string => {
  if (!raw) return raw;
  let p = raw;
  const home = homedir();
  p = p.replace(/\$\{HOME\}/g, home);
  if (p.startsWith('~/') || p === '~') {
    p = p === '~' ? home : `${home}${p.slice(1)}`;
  }
  const folders = vscode.workspace.workspaceFolders;
  const first = folders && folders.length > 0 ? folders[0].uri.fsPath : '';
  p = p.replace(/\$\{workspaceFolder\}/g, first);
  return p;
};

const DEFAULT_VERSION_REGEX = /(\d+\.\d+\.\d+)/;

const extractVersion = (combined: string, customRegex?: string): string | undefined => {
  if (customRegex) {
    try {
      const re = new RegExp(customRegex);
      const m = re.exec(combined);
      if (m) return m[1] ?? m[0];
    } catch {
      // Fall through to default regex if the provided pattern is malformed.
    }
  }
  const m = DEFAULT_VERSION_REGEX.exec(combined);
  return m ? m[1] : undefined;
};

export class DependencyRunners {
  constructor(private readonly process: ProcessService) {}

  run(check: CheckDefinition): Promise<DependencyStatus> {
    switch (check.type) {
      case 'exec':
        return this.runExec(check);
      case 'env':
        return this.runEnv(check);
      case 'file':
        return this.runFile(check);
      case 'nodeVersion':
        return this.runNodeVersion(check);
      case 'extensionInstalled':
        return this.runExtensionInstalled(check);
      default: {
        // Exhaustiveness guard — if a new check type is added and not handled,
        // TypeScript will flag this assignment at compile time.
        const exhaustive: never = check;
        return Promise.resolve({
          state: 'unknown',
          detail: `Unsupported check type: ${JSON.stringify(exhaustive)}`
        });
      }
    }
  }

  private async runExec(
    check: Extract<CheckDefinition, { type: 'exec' }>
  ): Promise<DependencyStatus> {
    try {
      const result = await this.process.run(check.command, check.args ?? []);
      const combined = `${result.stdout}\n${result.stderr}`;
      if (result.exitCode !== 0 && !combined.trim()) {
        return {
          state: 'fail',
          detail: `Command "${check.command}" exited with ${result.exitCode}.`
        };
      }
      const version = extractVersion(combined, check.versionRegex);
      if (check.minVersion) {
        if (!version) {
          return {
            state: 'warn',
            detail: `Could not parse a version from "${check.command}" output.`
          };
        }
        const cmp = compare(version, check.minVersion);
        if (cmp < 0) {
          return {
            state: 'fail',
            version,
            detail: `Installed ${version}; need >= ${check.minVersion}.`
          };
        }
        return { state: 'ok', version };
      }
      if (result.exitCode !== 0) {
        return {
          state: 'warn',
          version,
          detail: `Command exited ${result.exitCode} but produced output.`
        };
      }
      return { state: 'ok', version };
    } catch (err) {
      return {
        state: 'fail',
        detail: err instanceof Error ? err.message : String(err)
      };
    }
  }

  private async runEnv(
    check: Extract<CheckDefinition, { type: 'env' }>
  ): Promise<DependencyStatus> {
    const value = process.env[check.env];
    if (value && value.trim().length > 0) {
      return { state: 'ok', detail: `${check.env}=${value}` };
    }
    if (check.fallback) {
      const fb = await this.run(check.fallback);
      if (fb.state === 'ok') return fb;
      return {
        state: fb.state,
        version: fb.version,
        detail: `$${check.env} not set; fallback: ${fb.detail ?? 'failed'}`
      };
    }
    return {
      state: 'fail',
      detail: `Environment variable ${check.env} is not set.`
    };
  }

  private async runFile(
    check: Extract<CheckDefinition, { type: 'file' }>
  ): Promise<DependencyStatus> {
    const expanded = expandPath(check.path);
    const exists = fs.existsSync(expanded);
    if (exists) return { state: 'ok', detail: expanded };
    return { state: 'fail', detail: `File not found: ${expanded}` };
  }

  private async runNodeVersion(
    check: Extract<CheckDefinition, { type: 'nodeVersion' }>
  ): Promise<DependencyStatus> {
    const version = process.versions.node;
    const cmp = compare(version, check.minVersion);
    if (cmp < 0) {
      return {
        state: 'fail',
        version,
        detail: `Node ${version}; need >= ${check.minVersion}.`
      };
    }
    return { state: 'ok', version };
  }

  private async runExtensionInstalled(
    check: Extract<CheckDefinition, { type: 'extensionInstalled' }>
  ): Promise<DependencyStatus> {
    const installed = vscode.extensions.getExtension(check.extensionId) !== undefined;
    if (installed) return { state: 'ok', detail: check.extensionId };
    return {
      state: 'fail',
      detail: `Extension ${check.extensionId} is not installed.`
    };
  }
}
