// Computer use computer-use launcher (macOS arm64, self-contained DSH plugin).
// Spawned by the DSH plugin on the ChatGPT app's own Node. It resolves the installed ChatGPT.app,
// builds the original CUA REPL's environment, starts the macOS lifecycle host, then runs the
// original CUA REPL as a child with inherited stdio (so the MCP client talks to it directly),
// stopping the host when the child exits. A trimmed macOS-only `runtime/runtime.mjs`.
// Builtins come from process.getBuiltinModule, like the rest of the launch path.
const { userInfo } = process.getBuiltinModule('node:os');
const { basename, dirname, isAbsolute, join, posix } = process.getBuiltinModule('node:path');
const { fileURLToPath } = process.getBuiltinModule('node:url');

import { locateCodexTools } from './app_layout.mjs';
import { isFile, real } from './fsutil.mjs';
import { MAC_SOCKET_ENV, macSocketPath, resolveInstalledMacApp } from './platforms.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// The bundle root (the directory that holds `runtime/`).
const ROOT = dirname(HERE);
const SKY_SERVICE = '@oai/sky/service';

const surfaces = (env) => new Set((env.CUA_REPL_ENABLED_SURFACES ?? '').split(',').map((surface) => surface.trim()));
const unique = (values) => [...new Set(values)];

/** The directory the original runtime uses when CODEX_HOME is not set. */
export function defaultCodexHome(env) {
  return posix.join('HOME' in env ? env.HOME : userInfo().homedir, '.codex');
}

// The original runtime's own variable families; private between the adapter and this launcher.
const RUNTIME_FAMILY = /^(NODE_REPL|CUA_REPL|BROWSER_USE)_/i;
const ADAPTER_PRIVATE = 'CSU_MAC_CONTROL_SOCKET';
const LEGACY_SIGNS = ['CSU_MAC_LIFETIME_SOCKET', 'CSU_WRE_LIFETIME_PIPE', 'CSU_SANDBOX_SHIM', 'CSU_LINUX_SKY_SERVICE_PATH'];
const LEGACY_DERIVED = [...LEGACY_SIGNS, 'CSU_MAC_SERVICE_LOCK', 'CSU_MAC_SKY_SERVICE_PATH', 'CSU_MAC_SKY_CLIENT_PATH',
  'CSU_LINUX_INPUT_TOOLKITS', 'CSU_WRE_SKY_SERVICE_PATH', 'SKY_CUA_SERVICE_PATH', 'SKY_CUA_NATIVE_PIPE',
  'SKY_CUA_NATIVE_PIPE_DIRECTORY', 'CODEX_CLI_PATH'];

// Claude Code's own variables and Anthropic credentials: neither Computer use nor the original runtime reads them.
const HOST_PRIVATE = /^(CLAUDECODE|CLAUDE_PROJECT_DIR|CLAUDE_(CODE|AGENT_SDK|PREVIEW)_\w*|ANTHROPIC_(API_KEY|AUTH_TOKEN))$/i;

// A short fingerprint, not a secret: it only tells whether a value is still the one this launcher derived.
function digest(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  return `${value.length}:${(hash >>> 0).toString(16)}`;
}
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (env, key) => (Object.hasOwn(env, key) ? env[key] : null);

export const PARENT_ENV = 'CSU_PARENT_ENV';

/** The caller's environment without what a parent Computer use launcher derived for its runtime (see PARENT_ENV). */
export function inheritedEnvironment(source) {
  const env = { ...source };
  const family = () => Object.keys(env).filter((key) => RUNTIME_FAMILY.test(key));
  if (!Object.hasOwn(env, PARENT_ENV)) {
    if (LEGACY_SIGNS.some((key) => Object.hasOwn(env, key))) for (const key of [...family(), ...LEGACY_DERIVED]) delete env[key];
    return env;
  }
  let record;
  try {
    record = JSON.parse(env[PARENT_ENV]);
  } catch {
    record = null;
  }
  delete env[PARENT_ENV];
  if (!plainObject(record) || !plainObject(record.runtime) || !plainObject(record.derived)) return env;
  for (const key of family()) delete env[key];
  for (const [key, value] of Object.entries(record.runtime)) {
    if (RUNTIME_FAMILY.test(key) && typeof value === 'string') env[key] = value;
  }
  for (const [key, entry] of Object.entries(record.derived)) {
    if (RUNTIME_FAMILY.test(key) || !Array.isArray(entry) || entry.length !== 2) continue;
    const [before, derived] = entry;
    const current = own(env, key);
    if ((current === null ? null : digest(current)) !== derived) continue;
    if (typeof before === 'string') env[key] = before;
    else delete env[key];
  }
  return env;
}

/** Record in `env`, the original runtime's environment, how this launcher derived it from `base`. */
export function markDerived(base, env) {
  const runtime = {};
  const derived = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(env)])) {
    if (key === PARENT_ENV || HOST_PRIVATE.test(key)) continue;
    const before = own(base, key);
    if (RUNTIME_FAMILY.test(key)) {
      if (before !== null) runtime[key] = before;
      continue;
    }
    const after = own(env, key);
    if (key === ADAPTER_PRIVATE && after !== null) derived[key] = [null, digest(after)];
    else if (before !== after) derived[key] = [before, after === null ? null : digest(after)];
  }
  env[PARENT_ENV] = JSON.stringify({ runtime, derived });
  return env;
}

/**
 * The child environment for the original runtime (macOS). `resolved` comes from resolveInstalledMacApp.
 */
export function environment(resolved, { chrome = false, audio = false, env: source = process.env } = {}) {
  const { resources, runtime, version } = resolved;
  const separator = ':';
  const moduleDir = join(runtime, 'lib/node_modules');
  const node = join(runtime, 'bin/node');
  const nodeRepl = join(runtime, 'bin/node_repl');
  const codex = locateCodexTools(resources).cli;
  const env = inheritedEnvironment(source);
  for (const key of Object.keys(env)) if (HOST_PRIVATE.test(key)) delete env[key];
  const existingPath = env.PATH ?? '/usr/bin:/bin';
  if (!('CODEX_HOME' in env)) env.CODEX_HOME = defaultCodexHome(env);
  const prepend = (key, ...first) => unique([...first.filter(Boolean),
    ...(env[key] ?? '').split(separator).filter(Boolean)]).join(separator);
  Object.assign(env, {
    PATH: join(runtime, 'bin') + separator + existingPath,
    CUA_REPL_NODE_REPL_PATH: nodeRepl,
    NODE_REPL_NODE_PATH: node,
    NODE_REPL_NODE_MODULE_DIRS: prepend('NODE_REPL_NODE_MODULE_DIRS', moduleDir),
    NODE_REPL_TRUSTED_CODE_PATHS: prepend('NODE_REPL_TRUSTED_CODE_PATHS', env.CODEX_HOME, moduleDir, join(resources, 'plugins')),
  });
  env.CUA_REPL_ENABLED_SURFACES ??= chrome ? 'browser,computer' : 'computer';
  if (audio) {
    env.SKY_ENABLE_AUDIO = '1';
    env.NODE_REPL_ENABLE_AUDIO = '1';
  }
  env.CUA_REPL_BROWSER_ENV ??= 'codex-app';
  env.CODEX_CLI_PATH ??= codex;
  // Original Sky's macOS native-pipe transport uses this signed helper through LaunchServices when no
  // existing CUA service is connected.
  env.SKY_CUA_SERVICE_PATH ??= join(runtime, 'lib/node_modules/@oai/sky/Codex Computer Use.app');
  env.NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS ??= '1000';
  if (env.CUA_REPL_BROWSER_ENV === 'codex-app') {
    env.BROWSER_USE_AVAILABLE_BACKENDS ??= 'chrome';
    env.BROWSER_USE_TINYSKY_ENABLED ??= '1';
    const flavor = (env.BUILD_FLAVOR ?? '').trim();
    env.BROWSER_USE_CODEX_APP_BUILD_FLAVOR ??=
      ['dev', 'agent', 'nightly', 'internal-alpha', 'public-beta', 'prod'].includes(flavor) ? flavor : 'prod';
    env.BROWSER_USE_CODEX_APP_VERSION ??= version;
  }
  env.NODE_REPL_DISABLE_ANALYTICS ??= '1';
  env.BROWSER_USE_DISABLE_AMBIENT_NETWORK ??= '1';
  if (!('NODE_REPL_REQUEST_META' in env)) {
    const identity = `dsh-computer-use-${process.getBuiltinModule('node:crypto').randomUUID()}`;
    env.NODE_REPL_REQUEST_META = JSON.stringify({ 'x-codex-turn-metadata': { session_id: identity, turn_id: `${identity}-connection` } });
  }
  return env;
}

/** Add the native-cleanup Sky wrapper while keeping any other trusted services. */
function overrideTrustedService(env, wrapper, separator, platformName, { computerGated }) {
  const enabled = surfaces(env);
  const gate = computerGated ? enabled.has('computer') : true;
  let supplied;
  if (env.NODE_REPL_TRUSTED_SERVICES === undefined) {
    supplied = {};
    if (enabled.has('browser')) supplied.browser = '@oai/browser-desktop/service';
    if (gate) supplied.sky = SKY_SERVICE;
  } else {
    try {
      supplied = JSON.parse(env.NODE_REPL_TRUSTED_SERVICES);
    } catch {
      supplied = null;
    }
  }
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied) ||
      Object.values(supplied).some((value) => typeof value !== 'string')) {
    throw new Error('NODE_REPL_TRUSTED_SERVICES must be a JSON string map.');
  }
  if (gate && ![undefined, SKY_SERVICE, wrapper].includes(supplied.sky)) {
    throw new Error(`A custom Sky trusted-service override conflicts with ${platformName} native cleanup.`);
  }
  env.NODE_REPL_TRUSTED_SERVICES = JSON.stringify(gate ? { ...supplied, sky: wrapper } : supplied);
  env.NODE_REPL_TRUSTED_CODE_PATHS = unique([dirname(wrapper),
    ...(env.NODE_REPL_TRUSTED_CODE_PATHS ?? '').split(separator).filter(Boolean)]).join(separator);
}

/** Keep original Sky behavior and add only its turn-ended host hook; returns the original client, or null. */
export function configureMacosLifecycle(runtime, env) {
  if (!surfaces(env).has('computer')) return null;
  overrideTrustedService(env, join(ROOT, 'runtime/macos_sky_service.mjs'), ':', 'macOS', { computerGated: false });
  const sky = join(runtime, 'lib/node_modules/@oai/sky/dist/project/cua/sky_js/src');
  env.CSU_MAC_SKY_SERVICE_PATH = join(sky, 'service.js');
  env.CSU_MAC_SKY_CLIENT_PATH = join(sky, 'targets/mac/client.js');
  return join(env.SKY_CUA_SERVICE_PATH, 'Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient');
}

/** Run the original server as a child with inherited stdio; its status, or 128 + N when signal N ended it. */
function runChild(command, env) {
  return new Promise((resolveStatus, reject) => {
    const child = process.getBuiltinModule('node:child_process').spawn(command[0], command.slice(1), { env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (status, signal) => resolveStatus(status ?? 128 + (process.getBuiltinModule('node:os').constants.signals[signal] ?? 0)));
  });
}

async function launchMacos(client, launch, base, env) {
  const { startOriginalHost } = await import('./macos_host.mjs');
  // Always decided here, never inherited: only the default socket location is known, and the original client
  // builds its socket path from $HOME (Node's os.homedir), so an account whose HOME is elsewhere is talking to a
  // different socket. Any override, even an empty one, means the client may not use the default socket.
  const accountHome = userInfo().homedir;
  const clientHome = 'HOME' in env ? env.HOME : accountHome;
  if (MAC_SOCKET_ENV in env || !clientHome || real(clientHome) !== real(accountHome)) delete env.CSU_MAC_SERVICE_LOCK;
  else env.CSU_MAC_SERVICE_LOCK = `${macSocketPath(env).path}.lock`;
  const host = await startOriginalHost({ client, env, controlAddress: env.CSU_MAC_CONTROL_SOCKET });
  env.CSU_MAC_LIFETIME_SOCKET = host.address;
  try {
    return await runChild(launch, markDerived(base, env));
  } finally {
    await host.stop();
  }
}

/** Resolve the app, build the environment, start the host and run the original CUA REPL. */
async function main() {
  const appPath = process.env.CSU_APP_PATH || '/Applications/ChatGPT.app';
  if (!isAbsolute(appPath)) throw new Error(`CSU_APP_PATH must be absolute: ${appPath}`);
  const resolved = resolveInstalledMacApp(appPath, { reuseRecordedSeal: true });
  const base = inheritedEnvironment(process.env);
  const env = environment(resolved, { env: base });
  const client = configureMacosLifecycle(resolved.runtime, env);
  const launch = [env.NODE_REPL_NODE_PATH, join(resolved.runtime, 'lib/node_modules/@oai/cua-repl/bin/cua-repl.mjs')];
  if (client) return launchMacos(client, launch, base, env);
  return runChild(launch, markDerived(base, env));
}

main().catch((error) => {
  process.stderr.write(`Computer use: ${error?.message ?? error}\n`);
  process.exitCode = 1;
});
