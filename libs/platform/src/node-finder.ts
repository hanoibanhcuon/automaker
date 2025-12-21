/**
 * Cross-platform Node.js executable finder
 *
 * Handles finding Node.js when the app is launched from desktop environments
 * (macOS Finder, Windows Explorer, Linux desktop) where PATH may be limited.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Pattern to match version directories (e.g., "v18.17.0", "18.17.0", "v18")
 * Intentionally permissive to match pre-release versions (v18.17.0-beta, v18.17.0-rc1)
 * since localeCompare with numeric:true handles sorting correctly
 */
const VERSION_DIR_PATTERN = /^v?\d+/;

/** Result of finding Node.js executable */
export interface NodeFinderResult {
  /** Path to the Node.js executable */
  nodePath: string;
  /** How Node.js was found */
  source:
    | 'homebrew'
    | 'system'
    | 'nvm'
    | 'fnm'
    | 'nvm-windows'
    | 'program-files'
    | 'scoop'
    | 'chocolatey'
    | 'which'
    | 'where'
    | 'fallback';
}

/** Options for finding Node.js */
export interface NodeFinderOptions {
  /** Skip the search and return 'node' immediately (useful for dev mode) */
  skipSearch?: boolean;
  /** Custom logger function */
  logger?: (message: string) => void;
}

/**
 * Check if a file exists and is executable
 * On Windows, only checks existence (X_OK is not meaningful)
 */
function isExecutable(filePath: string): boolean {
  try {
    if (process.platform === 'win32') {
      // On Windows, fs.constants.X_OK is not meaningful - just check existence
      fs.accessSync(filePath, fs.constants.F_OK);
    } else {
      // On Unix-like systems, check for execute permission
      fs.accessSync(filePath, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Find Node.js executable from version manager directories (NVM, fnm)
 * Uses semantic version sorting to prefer the latest version
 *
 * Note: Version sorting uses localeCompare with numeric:true which handles most cases
 * correctly (e.g., v18.17.0 > v18.9.0) but may not perfectly sort pre-release versions
 * (e.g., v20.0.0-beta vs v19.9.9). This is acceptable as we prefer the latest stable.
 */
function findNodeFromVersionManager(
  basePath: string,
  binSubpath: string = 'bin/node'
): string | null {
  if (!fs.existsSync(basePath)) return null;

  try {
    const versions = fs
      .readdirSync(basePath)
      .filter((v) => VERSION_DIR_PATTERN.test(v))
      // Semantic version sort - newest first using localeCompare with numeric option
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));

    for (const version of versions) {
      const nodePath = path.join(basePath, version, binSubpath);
      if (isExecutable(nodePath)) {
        return nodePath;
      }
    }
  } catch {
    // Directory read failed, skip this location
  }

  return null;
}

/**
 * Find Node.js on macOS
 */
function findNodeMacOS(homeDir: string): NodeFinderResult | null {
  // Check Homebrew paths in order of preference
  const homebrewPaths = [
    // Apple Silicon
    '/opt/homebrew/bin/node',
    // Intel
    '/usr/local/bin/node',
  ];

  for (const nodePath of homebrewPaths) {
    if (isExecutable(nodePath)) {
      return { nodePath, source: 'homebrew' };
    }
  }

  // System Node
  if (isExecutable('/usr/bin/node')) {
    return { nodePath: '/usr/bin/node', source: 'system' };
  }

  // NVM installation
  const nvmPath = path.join(homeDir, '.nvm', 'versions', 'node');
  const nvmNode = findNodeFromVersionManager(nvmPath);
  if (nvmNode) {
    return { nodePath: nvmNode, source: 'nvm' };
  }

  // fnm installation (multiple possible locations)
  const fnmPaths = [
    path.join(homeDir, '.local', 'share', 'fnm', 'node-versions'),
    path.join(homeDir, 'Library', 'Application Support', 'fnm', 'node-versions'),
  ];

  for (const fnmBasePath of fnmPaths) {
    const fnmNode = findNodeFromVersionManager(fnmBasePath);
    if (fnmNode) {
      return { nodePath: fnmNode, source: 'fnm' };
    }
  }

  return null;
}

/**
 * Find Node.js on Linux
 */
function findNodeLinux(homeDir: string): NodeFinderResult | null {
  // Common Linux paths
  const systemPaths = [
    '/usr/bin/node',
    '/usr/local/bin/node',
    // Snap installation
    '/snap/bin/node',
  ];

  for (const nodePath of systemPaths) {
    if (isExecutable(nodePath)) {
      return { nodePath, source: 'system' };
    }
  }

  // NVM installation
  const nvmPath = path.join(homeDir, '.nvm', 'versions', 'node');
  const nvmNode = findNodeFromVersionManager(nvmPath);
  if (nvmNode) {
    return { nodePath: nvmNode, source: 'nvm' };
  }

  // fnm installation
  const fnmPaths = [
    path.join(homeDir, '.local', 'share', 'fnm', 'node-versions'),
    path.join(homeDir, '.fnm', 'node-versions'),
  ];

  for (const fnmBasePath of fnmPaths) {
    const fnmNode = findNodeFromVersionManager(fnmBasePath);
    if (fnmNode) {
      return { nodePath: fnmNode, source: 'fnm' };
    }
  }

  return null;
}

/**
 * Find Node.js on Windows
 */
function findNodeWindows(homeDir: string): NodeFinderResult | null {
  // Program Files paths
  const programFilesPaths = [
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'nodejs', 'node.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'nodejs', 'node.exe'),
  ];

  for (const nodePath of programFilesPaths) {
    if (isExecutable(nodePath)) {
      return { nodePath, source: 'program-files' };
    }
  }

  // NVM for Windows
  const nvmWindowsPath = path.join(
    process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'),
    'nvm'
  );
  const nvmNode = findNodeFromVersionManager(nvmWindowsPath, 'node.exe');
  if (nvmNode) {
    return { nodePath: nvmNode, source: 'nvm-windows' };
  }

  // fnm on Windows (prioritize canonical installation path over shell shims)
  const fnmWindowsPaths = [
    path.join(homeDir, '.fnm', 'node-versions'),
    path.join(
      process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local'),
      'fnm',
      'node-versions'
    ),
  ];

  for (const fnmBasePath of fnmWindowsPaths) {
    const fnmNode = findNodeFromVersionManager(fnmBasePath, 'node.exe');
    if (fnmNode) {
      return { nodePath: fnmNode, source: 'fnm' };
    }
  }

  // Scoop installation
  const scoopPath = path.join(homeDir, 'scoop', 'apps', 'nodejs', 'current', 'node.exe');
  if (isExecutable(scoopPath)) {
    return { nodePath: scoopPath, source: 'scoop' };
  }

  // Chocolatey installation
  const chocoPath = path.join(
    process.env.ChocolateyInstall || 'C:\\ProgramData\\chocolatey',
    'bin',
    'node.exe'
  );
  if (isExecutable(chocoPath)) {
    return { nodePath: chocoPath, source: 'chocolatey' };
  }

  return null;
}

/**
 * Try to find Node.js using shell commands (which/where)
 */
function findNodeViaShell(
  platform: NodeJS.Platform,
  logger: (message: string) => void = () => {}
): NodeFinderResult | null {
  try {
    const command = platform === 'win32' ? 'where node' : 'which node';
    const result = execSync(command, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // 'where' on Windows can return multiple lines, take the first
    const nodePath = result.split(/\r?\n/)[0];

    // Validate path: check for null bytes (security) and executable permission
    if (nodePath && !nodePath.includes('\x00') && isExecutable(nodePath)) {
      return {
        nodePath,
        source: platform === 'win32' ? 'where' : 'which',
      };
    }
  } catch {
    // Shell command failed (likely when launched from desktop without PATH)
    logger('Shell command failed to find Node.js (expected when launched from desktop)');
  }

  return null;
}

/**
 * Find Node.js executable - handles desktop launcher scenarios where PATH is limited
 *
 * @param options - Configuration options
 * @returns Result with path and source information
 *
 * @example
 * ```typescript
 * import { findNodeExecutable } from '@automaker/platform';
 *
 * // In development, skip the search
 * const result = findNodeExecutable({ skipSearch: isDev });
 * console.log(`Using Node.js from ${result.source}: ${result.nodePath}`);
 *
 * // Spawn a process with the found Node.js
 * spawn(result.nodePath, ['script.js']);
 * ```
 */
export function findNodeExecutable(options: NodeFinderOptions = {}): NodeFinderResult {
  const { skipSearch = false, logger = () => {} } = options;

  // Skip search if requested (e.g., in development mode)
  if (skipSearch) {
    return { nodePath: 'node', source: 'fallback' };
  }

  const platform = process.platform;
  const homeDir = os.homedir();

  // Platform-specific search
  let result: NodeFinderResult | null = null;

  switch (platform) {
    case 'darwin':
      result = findNodeMacOS(homeDir);
      break;
    case 'linux':
      result = findNodeLinux(homeDir);
      break;
    case 'win32':
      result = findNodeWindows(homeDir);
      break;
  }

  if (result) {
    logger(`Found Node.js via ${result.source} at: ${result.nodePath}`);
    return result;
  }

  // Fallback - try shell resolution (works when launched from terminal)
  result = findNodeViaShell(platform, logger);
  if (result) {
    logger(`Found Node.js via ${result.source} at: ${result.nodePath}`);
    return result;
  }

  // Ultimate fallback
  logger('Could not find Node.js, falling back to "node"');
  return { nodePath: 'node', source: 'fallback' };
}

/**
 * Build an enhanced PATH that includes the Node.js directory
 * Useful for ensuring child processes can find Node.js
 *
 * @param nodePath - Path to the Node.js executable
 * @param currentPath - Current PATH environment variable
 * @returns Enhanced PATH with Node.js directory prepended if not already present
 *
 * @example
 * ```typescript
 * import { findNodeExecutable, buildEnhancedPath } from '@automaker/platform';
 *
 * const { nodePath } = findNodeExecutable();
 * const enhancedPath = buildEnhancedPath(nodePath, process.env.PATH);
 *
 * spawn(nodePath, ['script.js'], {
 *   env: { ...process.env, PATH: enhancedPath }
 * });
 * ```
 */
export function buildEnhancedPath(nodePath: string, currentPath: string = ''): string {
  // If using fallback 'node', don't modify PATH
  if (nodePath === 'node') {
    return currentPath;
  }

  const nodeDir = path.dirname(nodePath);

  // Don't add if already present or if it's just '.'
  // Use path segment matching to avoid false positives (e.g., /opt/node vs /opt/node-v18)
  // Normalize paths for comparison to handle mixed separators on Windows
  const normalizedNodeDir = path.normalize(nodeDir);
  const pathSegments = currentPath.split(path.delimiter).map((s) => path.normalize(s));
  if (normalizedNodeDir === '.' || pathSegments.includes(normalizedNodeDir)) {
    return currentPath;
  }

  // Use platform-appropriate path separator
  // Handle empty currentPath without adding trailing delimiter
  if (!currentPath) {
    return nodeDir;
  }
  return `${nodeDir}${path.delimiter}${currentPath}`;
}
