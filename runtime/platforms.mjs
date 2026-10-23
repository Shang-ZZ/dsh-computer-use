// Validate the installed official ChatGPT.app for the original CUA runtime (macOS only).
// Builtins come from process.getBuiltinModule, like the rest of the launch path.
const { accessSync, constants, lstatSync, readFileSync, realpathSync, statSync } = process.getBuiltinModule('node:fs');
const os = process.getBuiltinModule('node:os');
const { basename, dirname, join, relative } = process.getBuiltinModule('node:path');
const childProcess = () => process.getBuiltinModule('node:child_process');

import { locateCodexTools } from './app_layout.mjs';
import { cacheDirectory, checkOnce, recorded, writeRecord } from './check_record.mjs';
import { isDirectory, isLink, isRegular } from './fsutil.mjs';
import { tryAcquire } from './lock.mjs';

const MAC_BUNDLE_ID = 'com.openai.codex';
const MAC_HELPER_ID = 'com.openai.sky.CUAService';
const OPENAI_TEAM_ID = '2DC432GLL2';
export const MAC_HELPER = 'Resources/cua_node/lib/node_modules/@oai/sky/Codex Computer Use.app';
export const MAC_REQUIRED_FILES = [
  'Resources/cua_node/bin/node',
  'Resources/cua_node/bin/node_repl',
  'Resources/cua_node/lib/node_modules/@oai/cua-repl/bin/cua-repl.mjs',
  'Resources/plugins/openai-bundled/plugins/unified-computer-use/.mcp.json',
  'Resources/plugins/openai-bundled/plugins/chrome/.codex-plugin/plugin.json',
];
const MAC_EXECUTABLES = new Set(MAC_REQUIRED_FILES.slice(0, 2));

// The signed helper binds its socket here (or at the path in this variable) and refuses a path
// longer than the AF_UNIX sun_path limit. Computer use cannot change that in the helper; it can only detect it.
export const MAC_SOCKET_ENV = 'SKY_CUA_SERVICE_NATIVE_PIPE_PATH';
export const MAC_SOCKET_SUFFIX = `Library/Group Containers/${OPENAI_TEAM_ID}.${MAC_HELPER_ID}/IPC/computeruse.sock`;
const MAC_SOCKET_MAX_BYTES = 103;

/** `{path, overridden}`: the helper's socket path; the override wins, else the account's real home (not $HOME). */
export function macSocketPath(env = process.env) {
  const override = env[MAC_SOCKET_ENV];
  if (override) return { path: override, overridden: true };
  return { path: join(os.userInfo().homedir, MAC_SOCKET_SUFFIX), overridden: false };
}

/** A message when the helper's socket path is too long to bind, else null. */
export function macSocketPathProblem(env = process.env) {
  const { path, overridden } = macSocketPath(env);
  const size = Buffer.byteLength(path);
  if (size <= MAC_SOCKET_MAX_BYTES) return null;
  const source = overridden ? `The path comes from ${MAC_SOCKET_ENV}.`
    : 'The path comes from your home folder, so the ChatGPT app is affected too.';
  return `Computer Use cannot start for this macOS account: the ChatGPT helper's socket path is ${size} bytes ` +
    `(macOS limit ${MAC_SOCKET_MAX_BYTES}): ${path}. ${source} Computer use cannot change the signed helper. Use an account ` +
    'whose home folder path is short enough (13 ASCII characters or fewer after /Users/).';
}

const executable = (path) => { try { accessSync(path, constants.X_OK); return true; } catch { return false; } };

/** Top-level string values of an XML or binary property list. */
export function plistStrings(data) {
  if (data.subarray(0, 8).toString('latin1') === 'bplist00') return binaryPlistStrings(data);
  // XML: track nesting so only direct children of the top-level dict (<plist><dict>) count.
  const result = {};
  let depth = 0;
  let key = null;
  let text = '';
  for (const [, close, name, empty, content] of data.toString('utf8').matchAll(/<([/]?)([A-Za-z]+)[^>]*?([/]?)>|([^<]+)/g)) {
    if (content !== undefined) {
      text += content;
      continue;
    }
    if (!close && !empty) {
      depth += 1;
      text = '';
      continue;
    }
    if ((empty ? depth + 1 : depth) === 3) {
      if (name === 'key') key = unescapeXml(text);
      else {
        if (name === 'string' && key !== null) result[key] = empty ? '' : unescapeXml(text);
        key = null;
      }
    }
    if (!empty) depth -= 1;
    text = '';
  }
  return result;
}

const unescapeXml = (text) => text.replace(/&(lt|gt|amp|quot|apos|#x[0-9a-f]+|#\d+);/gi, (_, name) => (
  { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[name.toLowerCase()] ??
  String.fromCodePoint(name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10))));

function binaryPlistStrings(data) {
  const trailer = data.subarray(data.length - 32);
  const offsetSize = trailer[6];
  const refSize = trailer[7];
  const count = Number(trailer.readBigUInt64BE(8));
  const top = Number(trailer.readBigUInt64BE(16));
  const table = Number(trailer.readBigUInt64BE(24));
  const uint = (at, size) => data.readUIntBE(at, size);
  const offset = (index) => {
    if (index >= count) throw new Error('Application bundle metadata is not a property list');
    return uint(table + index * offsetSize, offsetSize);
  };
  const length = (at) => {
    const low = data[at] & 0x0f;
    if (low !== 0x0f) return [low, at + 1];
    const size = 1 << (data[at + 1] & 0x0f);
    return [uint(at + 2, size), at + 2 + size];
  };
  const string = (index) => {
    const at = offset(index);
    const kind = data[at] >> 4;
    const [size, start] = length(at);
    if (kind === 0x5) return data.toString('latin1', start, start + size);
    if (kind === 0x6) return Buffer.from(data.subarray(start, start + 2 * size)).swap16().toString('utf16le');
    return undefined;
  };
  const at = offset(top);
  if (data[at] >> 4 !== 0xd) throw new Error('Application bundle metadata is not a property list');
  const [entries, start] = length(at);
  const result = {};
  for (let i = 0; i < entries; i += 1) {
    const key = string(uint(start + i * refSize, refSize));
    const value = string(uint(start + (entries + i) * refSize, refSize));
    if (typeof key === 'string' && typeof value === 'string') result[key] = value;
  }
  return result;
}

function bundleIdentity(bundle, identifier) {
  const info = join(bundle, 'Contents/Info.plist');
  if (!isRegular(info)) throw new Error(`Application bundle metadata is missing: ${info}`);
  const details = plistStrings(readFileSync(info));
  if (details.CFBundleIdentifier !== identifier) throw new Error(`Unexpected application bundle identifier: ${bundle}`);
  return details;
}

/**
 * Where Computer use remembers each bundle `codesign --verify --deep --strict` accepted, so that a launch skips that check
 * (over a second for the app) until the bundle changes. A per-account cache: losing it costs one deep check.
 */
export const sealRecord = {
  path: () => join(cacheDirectory(), 'macos-signatures.json'),
  wait: 15_000,
  lock: (path) => tryAcquire(path),
};

/** One signed build of `bundle`: its identifier, version and build, and the hash of its sealed-resource manifest. */
function sealKey(bundle, details) {
  try {
    const info = statSync(join(bundle, 'Contents/Info.plist'));
    const seal = readFileSync(join(bundle, 'Contents/_CodeSignature/CodeResources'));
    return JSON.stringify({ identifier: details.CFBundleIdentifier, version: details.CFBundleShortVersionString ?? null,
      build: details.CFBundleVersion ?? null, info: [info.ino, info.size, info.mtimeMs],
      seal: process.getBuiltinModule('node:crypto').createHash('sha256').update(seal).digest('hex') });
  } catch {
    return null;
  }
}

/** The bundle's sealKey as it is now, its Info.plist read again; null when it cannot be read. */
function currentKey(bundle) {
  try {
    return sealKey(bundle, plistStrings(readFileSync(join(bundle, 'Contents/Info.plist'))));
  } catch {
    return null;
  }
}

function deepVerify(bundle) {
  const verified = childProcess().spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle],
    { encoding: 'utf8', timeout: 120_000 });
  if (verified.status !== 0) {
    const detail = `${verified.stderr || verified.stdout || verified.error?.message || ''}`.trim().replaceAll('\n', ' ').slice(0, 300);
    throw new Error(`Installed application signature verification failed: ${bundle}: ${detail}`);
  }
}

/**
 * Verify the bundle's seal with `codesign --verify --deep --strict`, unless `reuse` is set and this account
 * recorded a successful check of the same build (sealKey). Concurrent launches share one check through a lock.
 */
function verifySeal(bundle, details, reuse) {
  const key = sealKey(bundle, details);
  if (key === null) {
    deepVerify(bundle);
    return;
  }
  let waited = false;
  checkOnce(sealRecord, {
    hit: (path) => {
      if (!reuse) return false;
      const initial = !waited;
      waited = true;
      if (!recorded(path, bundle, key)) return false;
      return initial || currentKey(bundle) === key;
    },
    check: (path) => {
      deepVerify(bundle);
      if (path !== null && sealKey(bundle, details) === key) writeRecord(path, bundle, key);
    },
  });
}

/**
 * The installed app and signed helper are checked in place; Computer use never copies or modifies them. The signer's
 * identity and team are read on every call.
 */
function verifySignature(bundle, identifier, details, reuse) {
  verifySeal(bundle, details, reuse);
  const identity = childProcess().spawnSync('/usr/bin/codesign', ['-dv', '--verbose=2', bundle],
    { encoding: 'utf8', timeout: 30_000 });
  const lines = `${identity.stderr ?? ''}`.split('\n');
  if (identity.status !== 0 || !lines.includes(`Identifier=${identifier}`) ||
      !lines.includes(`TeamIdentifier=${OPENAI_TEAM_ID}`)) {
    throw new Error(`Installed application signer does not match OpenAI: ${bundle}`);
  }
}

function runtimeManifest(path, platform, arch, message) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  const version = manifest?.runtime_archive_version;
  if (manifest?.platform !== platform || manifest?.arch !== arch || typeof version !== 'string' || !version.trim()) {
    throw new Error(message);
  }
  return version;
}

/**
 * Validate a local ChatGPT.app without relocating or modifying signed files. Each signature is checked at most
 * once; with `reuseRecordedSeal` (launches), the deep check is skipped for a build this account already verified.
 * Returns `{app, resources, runtime, backend, version, arch, codexCli, codeModeHost, runtimeVersion}`.
 */
export function resolveInstalledMacApp(appPath, { arch, reuseRecordedSeal = false } = {}) {
  if (process.platform !== 'darwin') throw new Error('The macOS application can only be validated on macOS');
  if (isLink(appPath) || !isDirectory(appPath) || basename(appPath) !== 'ChatGPT.app') {
    throw new Error(`Expected a local ChatGPT.app directory: ${appPath}`);
  }
  const app = realpathSync(appPath);
  const architecture = arch || { arm64: 'arm64', x64: 'x64' }[process.arch];
  if (!['arm64', 'x64'].includes(architecture)) throw new Error(`Unsupported macOS architecture: ${architecture}`);
  const contents = join(app, 'Contents');
  const resources = join(contents, 'Resources');
  const runtime = join(resources, 'cua_node');
  const appDetails = bundleIdentity(app, MAC_BUNDLE_ID);
  const version = appDetails.CFBundleShortVersionString;
  if (typeof version !== 'string' || !version.trim()) throw new Error(`Installed application version is missing: ${app}`);
  const helper = join(contents, MAC_HELPER);
  const helperDetails = bundleIdentity(helper, MAC_HELPER_ID);
  const manifest = join(runtime, 'manifest.json');
  if (!isRegular(manifest)) throw new Error('Installed application CUA manifest is missing');
  const runtimeVersion = runtimeManifest(manifest, 'darwin', architecture,
    'Installed application CUA runtime has an incompatible platform or architecture');
  for (const relativePath of MAC_REQUIRED_FILES) {
    const file = join(contents, relativePath);
    if (!isRegular(file)) throw new Error(`Required application file is missing or invalid: ${relativePath}`);
    if (MAC_EXECUTABLES.has(relativePath) && !executable(file)) {
      throw new Error(`Installed application executable is not executable: ${relativePath}`);
    }
  }
  const tools = locateCodexTools(resources);
  for (const file of [tools.cli, tools.codeModeHost]) {
    if (!executable(file)) throw new Error(`Installed application executable is not executable: ${relative(contents, file)}`);
  }
  verifySignature(app, MAC_BUNDLE_ID, appDetails, reuseRecordedSeal);
  verifySignature(helper, MAC_HELPER_ID, helperDetails, reuseRecordedSeal);
  return { app, resources, runtime, backend: 'mac', version, arch: architecture,
    codexCli: tools.cli, codeModeHost: tools.codeModeHost, runtimeVersion };
}
