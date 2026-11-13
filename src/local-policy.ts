/**
 * Local, deterministic policy checks that run before the sidecar call.
 *
 * The phoenix policy DSL only supports action prefix / scope / multi-party
 * conditions, so it cannot distinguish a sensitive file write from a normal
 * one. These checks cover the high-signal cases locally and leave everything
 * else to the sidecar.
 */

import { homedir } from "node:os";
import { basename, extname, normalize, resolve } from "node:path";

export interface LocalPolicyResult {
  deny: boolean;
  rule?: string;
  reason?: string;
}

const ALLOWED: LocalPolicyResult = { deny: false };

const SENSITIVE_EXTENSIONS = new Set([
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".jks",
  ".keystore",
]);

const SENSITIVE_BASENAMES = new Set([
  ".npmrc",
  ".netrc",
  ".pgpass",
  "credentials",
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
]);

const SENSITIVE_DIRS = [
  resolve(homedir(), ".ssh"),
  resolve(homedir(), ".gnupg"),
  resolve(homedir(), ".aws"),
  resolve(homedir(), ".config", "gh"),
  resolve(homedir(), "Library", "Keychains"),
];

function expandHome(input: string): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return resolve(homedir(), input.slice(2));
  return input;
}

function normalizePath(input: string): string {
  return normalize(expandHome(input));
}

function isEnvFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower === ".env") return true;
  if (!lower.startsWith(".env.")) return false;
  // .env.example / .env.sample / .env.template are documentation, not secrets.
  return !/\.(example|sample|template|md)$/.test(lower);
}

function isUnder(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

export function checkLocalWrite(filePath: string): LocalPolicyResult {
  if (!filePath) return ALLOWED;
  const abs = normalizePath(filePath);
  const name = basename(abs);

  if (SENSITIVE_EXTENSIONS.has(extname(abs).toLowerCase())) {
    return {
      deny: true,
      rule: "MAREF-LOCAL-SENSITIVE-FILE",
      reason: `sensitive extension: ${extname(abs)}`,
    };
  }

  if (isEnvFile(name)) {
    return {
      deny: true,
      rule: "MAREF-LOCAL-SENSITIVE-FILE",
      reason: "environment file may contain secrets",
    };
  }

  if (SENSITIVE_BASENAMES.has(name.toLowerCase())) {
    return {
      deny: true,
      rule: "MAREF-LOCAL-SENSITIVE-FILE",
      reason: `sensitive filename: ${name}`,
    };
  }

  for (const dir of SENSITIVE_DIRS) {
    if (isUnder(abs, dir)) {
      return {
        deny: true,
        rule: "MAREF-LOCAL-SENSITIVE-FILE",
        reason: `sensitive directory: ${dir}`,
      };
    }
  }

  return ALLOWED;
}

interface DangerousPattern {
  pattern: RegExp;
  reason: string;
}

const DANGEROUS_COMMANDS: DangerousPattern[] = [
  {
    pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f\s+\/(?:\s|$)/,
    reason: "recursive force delete of the filesystem root",
  },
  {
    pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f\s+(?:~|\$HOME)(?:\/|\s|$)/,
    reason: "recursive force delete of the home directory",
  },
  {
    pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f\s+\/(?:bin|etc|usr|var|System|Users|opt|home|Applications)(?:\/|\s|$)/,
    reason: "recursive force delete of a system directory",
  },
  {
    pattern: /\bmkfs(?:\.[a-z0-9]+)?\s/,
    reason: "filesystem format",
  },
  {
    pattern: /\bdd\b[^\n|;]*\bof=\/dev\//,
    reason: "raw write to block device",
  },
  {
    pattern: /:\s*\(\s*\)\s*\{[^}]*:\s*\|\s*:/,
    reason: "fork bomb",
  },
  {
    pattern: /\bchmod\s+(?:-R\s+)?777\s+\/(?:\s|$)/,
    reason: "world-writable root",
  },
  {
    pattern: /\b(?:curl|wget)\b[^\n|;]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/,
    reason: "piping remote content into a shell",
  },
  {
    pattern: /\bsudo\s+rm\s+-[a-zA-Z]*r/,
    reason: "recursive delete with sudo",
  },
];

export function checkLocalExecute(command: string): LocalPolicyResult {
  if (!command) return ALLOWED;
  for (const { pattern, reason } of DANGEROUS_COMMANDS) {
    if (pattern.test(command)) {
      return {
        deny: true,
        rule: "MAREF-LOCAL-DANGEROUS-COMMAND",
        reason,
      };
    }
  }
  return ALLOWED;
}
