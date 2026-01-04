/**
 * Shared utilities for Automaker launcher scripts (dev.mjs and start.mjs)
 *
 * This module contains cross-platform utilities for:
 * - Process management (ports, killing processes)
 * - Terminal output (colors, logging)
 * - npm/npx command execution
 * - User prompts
 * - Health checks
 *
 * SECURITY NOTE: Uses a restricted fs wrapper that only allows
 * operations within a specified base directory.
 */

import { execSync } from 'child_process';
import fsNative from 'fs';
import http from 'http';
import path from 'path';
import readline from 'readline';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const treeKill = require('tree-kill');
const crossSpawn = require('cross-spawn');

// =============================================================================
// Terminal Colors
// =============================================================================

export const colors = {
  green: '\x1b[0;32m',
  blue: '\x1b[0;34m',
  yellow: '\x1b[1;33m',
  red: '\x1b[0;31m',
  reset: '\x1b[0m',
};

export const isWindows = process.platform === 'win32';

// =============================================================================
// Restricted fs wrapper - only allows operations within a base directory
// =============================================================================

/**
 * Create a restricted fs wrapper for a given base directory
 * @param {string} baseDir - The base directory to restrict operations to
 * @param {string} scriptName - Name of the calling script for error messages
 * @returns {object} - Restricted fs operations
 */
export function createRestrictedFs(baseDir, scriptName = 'launcher') {
  const normalizedBase = path.resolve(baseDir);

  function validatePath(targetPath) {
    const resolved = path.resolve(baseDir, targetPath);
    if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
      throw new Error(
        `[${scriptName}] Security: Path access denied outside script directory: ${targetPath}`
      );
    }
    return resolved;
  }

  return {
    existsSync(targetPath) {
      const validated = validatePath(targetPath);
      return fsNative.existsSync(validated);
    },
    mkdirSync(targetPath, options) {
      const validated = validatePath(targetPath);
      return fsNative.mkdirSync(validated, options);
    },
    createWriteStream(targetPath) {
      const validated = validatePath(targetPath);
      return fsNative.createWriteStream(validated);
    },
  };
}

// =============================================================================
// Logging
// =============================================================================

/**
 * Print colored output
 * @param {string} message - Message to print
 * @param {string} color - Color name (green, blue, yellow, red, reset)
 */
export function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// =============================================================================
// Command Execution
// =============================================================================

/**
 * Execute a command synchronously and return stdout
 * @param {string} command - Command to execute
 * @param {object} options - execSync options
 * @returns {string|null} - Command output or null on error
 */
export function execCommand(command, options = {}) {
  try {
    return execSync(command, {
      encoding: 'utf8',
      stdio: 'pipe',
      ...options,
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Run npm command using cross-spawn for Windows compatibility
 * @param {string[]} args - npm command arguments
 * @param {object} options - spawn options
 * @param {string} cwd - Working directory
 * @returns {ChildProcess} - Spawned process
 */
export function runNpm(args, options = {}, cwd = process.cwd()) {
  const { env, ...restOptions } = options;
  const spawnOptions = {
    stdio: 'inherit',
    cwd,
    ...restOptions,
    env: {
      ...process.env,
      ...(env || {}),
    },
  };
  return crossSpawn('npm', args, spawnOptions);
}

/**
 * Run an npm command and wait for completion
 * @param {string[]} args - npm command arguments
 * @param {object} options - spawn options
 * @param {string} cwd - Working directory
 * @returns {Promise<void>}
 */
export function runNpmAndWait(args, options = {}, cwd = process.cwd()) {
  const child = runNpm(args, options, cwd);
  return new Promise((resolve, reject) => {
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm ${args.join(' ')} failed with code ${code}`));
    });
    child.on('error', (err) => reject(err));
  });
}

/**
 * Run npx command using cross-spawn for Windows compatibility
 * @param {string[]} args - npx command arguments
 * @param {object} options - spawn options
 * @param {string} cwd - Working directory
 * @returns {ChildProcess} - Spawned process
 */
export function runNpx(args, options = {}, cwd = process.cwd()) {
  const { env, ...restOptions } = options;
  const spawnOptions = {
    stdio: 'inherit',
    cwd,
    ...restOptions,
    env: {
      ...process.env,
      ...(env || {}),
    },
  };
  return crossSpawn('npx', args, spawnOptions);
}

// =============================================================================
// Process Management
// =============================================================================

/**
 * Get process IDs using a specific port (cross-platform)
 * @param {number} port - Port number to check
 * @returns {number[]} - Array of PIDs using the port
 */
export function getProcessesOnPort(port) {
  const pids = new Set();

  if (isWindows) {
    try {
      const output = execCommand(`netstat -ano | findstr :${port}`);
      if (output) {
        const lines = output.split('\n');
        for (const line of lines) {
          const match = line.match(/:\d+\s+.*?(\d+)\s*$/);
          if (match) {
            const pid = parseInt(match[1], 10);
            if (pid > 0) pids.add(pid);
          }
        }
      }
    } catch {
      // Ignore errors
    }
  } else {
    try {
      const output = execCommand(`lsof -ti:${port}`);
      if (output) {
        output.split('\n').forEach((pid) => {
          const parsed = parseInt(pid.trim(), 10);
          if (parsed > 0) pids.add(parsed);
        });
      }
    } catch {
      // Ignore errors
    }
  }

  return Array.from(pids);
}

/**
 * Kill a process by PID (cross-platform)
 * @param {number} pid - Process ID to kill
 * @returns {boolean} - Whether the kill succeeded
 */
export function killProcess(pid) {
  try {
    if (isWindows) {
      execCommand(`taskkill /F /PID ${pid}`);
    } else {
      process.kill(pid, 'SIGKILL');
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a port is in use (without killing)
 * @param {number} port - Port number to check
 * @returns {boolean} - Whether the port is in use
 */
export function isPortInUse(port) {
  const pids = getProcessesOnPort(port);
  return pids.length > 0;
}

/**
 * Kill processes on a port and wait for it to be freed
 * @param {number} port - Port number to free
 * @returns {Promise<boolean>} - Whether the port was freed
 */
export async function killPort(port) {
  const pids = getProcessesOnPort(port);

  if (pids.length === 0) {
    log(`✓ Port ${port} is available`, 'green');
    return true;
  }

  log(`Killing process(es) on port ${port}: ${pids.join(', ')}`, 'yellow');

  for (const pid of pids) {
    killProcess(pid);
  }

  // Wait for port to be freed (max 5 seconds)
  for (let i = 0; i < 10; i++) {
    await sleep(500);
    const remainingPids = getProcessesOnPort(port);
    if (remainingPids.length === 0) {
      log(`✓ Port ${port} is now free`, 'green');
      return true;
    }
  }

  log(`Warning: Port ${port} may still be in use`, 'red');
  return false;
}

/**
 * Kill a process tree using tree-kill
 * @param {number} pid - Root process ID
 * @returns {Promise<void>}
 */
export function killProcessTree(pid) {
  return new Promise((resolve) => {
    if (!pid) {
      resolve();
      return;
    }
    treeKill(pid, 'SIGTERM', (err) => {
      if (err) {
        treeKill(pid, 'SIGKILL', () => resolve());
      } else {
        resolve();
      }
    });
  });
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Sleep for a given number of milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if the server health endpoint is responding
 * @param {number} port - Server port (default 3008)
 * @returns {Promise<boolean>} - Whether the server is healthy
 */
export function checkHealth(port = 3008) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/health`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Prompt the user for input
 * @param {string} question - Question to ask
 * @returns {Promise<string>} - User's answer
 */
export function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// =============================================================================
// Port Configuration Flow
// =============================================================================

/**
 * Check ports and prompt user for resolution if in use
 * @param {object} options - Configuration options
 * @param {number} options.defaultWebPort - Default web port (3007)
 * @param {number} options.defaultServerPort - Default server port (3008)
 * @returns {Promise<{webPort: number, serverPort: number, corsOriginEnv: string}>}
 */
export async function resolvePortConfiguration({
  defaultWebPort = 3007,
  defaultServerPort = 3008,
} = {}) {
  log(`Checking for processes on ports ${defaultWebPort} and ${defaultServerPort}...`, 'yellow');

  const webPortInUse = isPortInUse(defaultWebPort);
  const serverPortInUse = isPortInUse(defaultServerPort);

  let webPort = defaultWebPort;
  let serverPort = defaultServerPort;

  if (webPortInUse || serverPortInUse) {
    console.log('');
    if (webPortInUse) {
      const pids = getProcessesOnPort(defaultWebPort);
      log(`⚠ Port ${defaultWebPort} is in use by process(es): ${pids.join(', ')}`, 'yellow');
    }
    if (serverPortInUse) {
      const pids = getProcessesOnPort(defaultServerPort);
      log(`⚠ Port ${defaultServerPort} is in use by process(es): ${pids.join(', ')}`, 'yellow');
    }
    console.log('');

    while (true) {
      const choice = await prompt(
        'What would you like to do? (k)ill processes, (u)se different ports, or (c)ancel: '
      );
      const lowerChoice = choice.toLowerCase();

      if (lowerChoice === 'k' || lowerChoice === 'kill') {
        if (webPortInUse) {
          await killPort(defaultWebPort);
        } else {
          log(`✓ Port ${defaultWebPort} is available`, 'green');
        }
        if (serverPortInUse) {
          await killPort(defaultServerPort);
        } else {
          log(`✓ Port ${defaultServerPort} is available`, 'green');
        }
        break;
      } else if (lowerChoice === 'u' || lowerChoice === 'use') {
        webPort = await promptForPort('web', defaultWebPort);
        serverPort = await promptForPort('server', defaultServerPort, webPort);
        log(`Using ports: Web=${webPort}, Server=${serverPort}`, 'blue');
        break;
      } else if (lowerChoice === 'c' || lowerChoice === 'cancel') {
        log('Cancelled.', 'yellow');
        process.exit(0);
      } else {
        log(
          'Invalid choice. Please enter k (kill), u (use different ports), or c (cancel).',
          'red'
        );
      }
    }
  } else {
    log(`✓ Port ${defaultWebPort} is available`, 'green');
    log(`✓ Port ${defaultServerPort} is available`, 'green');
  }

  // Build CORS origin env
  const existing = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
    .filter((o) => o !== '*');
  const origins = new Set(existing);
  origins.add(`http://localhost:${webPort}`);
  origins.add(`http://127.0.0.1:${webPort}`);
  const corsOriginEnv = Array.from(origins).join(',');

  console.log('');

  return { webPort, serverPort, corsOriginEnv };
}

/**
 * Prompt for a specific port with validation
 * @param {string} name - Port name (web/server)
 * @param {number} defaultPort - Default port value
 * @param {number} excludePort - Port to exclude (optional)
 * @returns {Promise<number>}
 */
async function promptForPort(name, defaultPort, excludePort = null) {
  while (true) {
    const input = await prompt(`Enter ${name} port (default ${defaultPort}): `);
    const parsed = input.trim() ? parseInt(input.trim(), 10) : defaultPort;

    if (isNaN(parsed) || parsed < 1024 || parsed > 65535) {
      log('Invalid port. Please enter a number between 1024 and 65535.', 'red');
      continue;
    }

    if (excludePort && parsed === excludePort) {
      log(`${name} port cannot be the same as the other port.`, 'red');
      continue;
    }

    if (isPortInUse(parsed)) {
      const pids = getProcessesOnPort(parsed);
      log(`Port ${parsed} is already in use by process(es): ${pids.join(', ')}`, 'red');
      const useAnyway = await prompt('Use this port anyway? (y/n): ');
      if (useAnyway.toLowerCase() !== 'y' && useAnyway.toLowerCase() !== 'yes') {
        continue;
      }
    }

    return parsed;
  }
}

// =============================================================================
// UI Components
// =============================================================================

/**
 * Print the application header banner
 * @param {string} title - Header title
 */
export function printHeader(title) {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log(`║        ${title.padEnd(45)}║`);
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log('');
}

/**
 * Print the application mode menu
 */
export function printModeMenu() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Select Application Mode:');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  1) Web Application (Browser)');
  console.log('  2) Desktop Application (Electron)');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
}

// =============================================================================
// Process Cleanup
// =============================================================================

/**
 * Create a cleanup handler for spawned processes
 * @param {object} processes - Object with process references {server, web, electron}
 * @returns {Function} - Cleanup function
 */
export function createCleanupHandler(processes) {
  return async function cleanup() {
    console.log('\nCleaning up...');

    const killPromises = [];

    if (processes.server && !processes.server.killed && processes.server.pid) {
      killPromises.push(killProcessTree(processes.server.pid));
    }

    if (processes.web && !processes.web.killed && processes.web.pid) {
      killPromises.push(killProcessTree(processes.web.pid));
    }

    if (processes.electron && !processes.electron.killed && processes.electron.pid) {
      killPromises.push(killProcessTree(processes.electron.pid));
    }

    await Promise.all(killPromises);
  };
}

/**
 * Setup signal handlers for graceful shutdown
 * @param {Function} cleanup - Cleanup function
 */
export function setupSignalHandlers(cleanup) {
  let cleaningUp = false;

  const handleExit = async () => {
    if (cleaningUp) return;
    cleaningUp = true;
    await cleanup();
    process.exit(0);
  };

  process.on('SIGINT', () => handleExit());
  process.on('SIGTERM', () => handleExit());
}

// =============================================================================
// Server Startup
// =============================================================================

/**
 * Start the backend server and wait for it to be ready
 * @param {object} options - Configuration options
 * @returns {Promise<ChildProcess>} - Server process
 */
export async function startServerAndWait({ serverPort, corsOriginEnv, npmArgs, cwd, fs, baseDir }) {
  log(`Starting backend server on port ${serverPort}...`, 'blue');

  // Create logs directory
  const logsDir = path.join(baseDir, 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const logStream = fs.createWriteStream(path.join(baseDir, 'logs', 'server.log'));
  const serverProcess = runNpm(
    npmArgs,
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PORT: String(serverPort),
        CORS_ORIGIN: corsOriginEnv,
      },
    },
    cwd
  );

  // Pipe to both log file and console
  serverProcess.stdout?.on('data', (data) => {
    process.stdout.write(data);
    logStream.write(data);
  });
  serverProcess.stderr?.on('data', (data) => {
    process.stderr.write(data);
    logStream.write(data);
  });

  log('Waiting for server to be ready...', 'yellow');

  // Wait for server health check
  const maxRetries = 30;
  let serverReady = false;

  for (let i = 0; i < maxRetries; i++) {
    if (await checkHealth(serverPort)) {
      serverReady = true;
      break;
    }
    process.stdout.write('.');
    await sleep(1000);
  }

  console.log('');

  if (!serverReady) {
    log('Error: Server failed to start', 'red');
    console.log('Check logs/server.log for details');
    return null;
  }

  log('✓ Server is ready!', 'green');
  return serverProcess;
}

// =============================================================================
// Dependencies
// =============================================================================

/**
 * Ensure node_modules exists, install if not
 * @param {object} fs - Restricted fs object
 * @param {string} baseDir - Base directory
 */
export async function ensureDependencies(fs, baseDir) {
  if (!fs.existsSync(path.join(baseDir, 'node_modules'))) {
    log('Installing dependencies...', 'blue');
    const install = runNpm(['install'], { stdio: 'inherit' }, baseDir);
    await new Promise((resolve, reject) => {
      install.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`npm install failed with code ${code}`));
      });
    });
  }
}
