// DeepSeek Harness (DSH) host plugin: the original runtime's js and js_reset tools, its instructions, its
// native-app approvals through DSH's question card, and its turn cleanup on DSH's turn end. Self-contained:
// `commandFrom` points at the bundled macOS launcher, run on the installed ChatGPT app's own Node.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCuaClient, nativeAppApprovalOptions, nativeAppApprovalResponse } from './client.mjs';
import { persistAudioContent } from './audio-files.mjs';

export const name = 'dsh-computer-use';
export const inject = ['tools', 'systemPrompt', 'webServer', 'connection'];

/** After DSH's MCP servers section (MCP_SERVERS, 3100 in @deepseek-ai/dsh-system-prompt). */
export const PROMPT_ORDER = 3100;
export const PROMPT_SECTION = 'dsh-computer-use';
const QUESTION_ID = 'csu-app-approval';

/** The launcher argv: `CSU_MCP_COMMAND` (tests), the bundle's configured `command`, or the bundled macOS launcher. */
export function commandFrom(config) {
  const raw = process.env.CSU_MCP_COMMAND;
  if (raw) return JSON.parse(raw);
  if (Array.isArray(config?.command)) return config.command;
  const appPath = config?.appPath ?? '/Applications/ChatGPT.app';
  const node = join(appPath, 'Contents/Resources/cua_node/bin/node');
  const launcher = fileURLToPath(new URL('../runtime/launcher.mjs', import.meta.url));
  return [node, launcher];
}

function originsFromEnvironment() {
  const raw = process.env.CSU_APPROVED_ORIGINS;
  return raw ? JSON.parse(raw) : [];
}

const SECRET_NAME = /KEY|PASSWORD|SECRET|TOKEN/i;

/**
 * The environment of the launcher process: DSH's own, without its `DSH_*` variables and without names DSH
 * treats as credentials (its provider keys arrive in this process's environment). Computer use reads none of them.
 */
export function childEnvironment(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key, value]) =>
    value !== undefined && !key.startsWith('DSH_') && !SECRET_NAME.test(key)));
}

/** `childEnvironment` plus the configured app path, which the launcher reads to resolve the installed app. */
export function launcherEnvironment(config, env = process.env) {
  const result = childEnvironment(env);
  if (config?.appPath) result.CSU_APP_PATH = config.appPath;
  return result;
}

/**
 * The app the agent is about to control, read from a `js` call's JavaScript: the first
 * `getApp("…")` / `get_app_state("…")` target, or null. Heuristic for the sidebar monitor.
 */
export function extractTargetApp(code) {
  if (typeof code !== 'string' || !code) return null;
  let match = /\bgetApp\(\s*["'`]([^"'`]+)["'`]\s*\)/.exec(code);
  if (match) return match[1];
  match = /\bget_app_state\(\s*["'`]([^"'`]+)["'`]\s*\)/.exec(code);
  if (match) return match[1];
  return null;
}

/**
 * The most recent screenshot in a `js` tool result: the last image block's base64 and MIME type,
 * or null. This is the live picture of the window the agent is operating.
 */
export function extractImage(result) {
  if (!result || !Array.isArray(result.content)) return null;
  for (let i = result.content.length - 1; i >= 0; i--) {
    const block = result.content[i];
    if (block?.type === 'image' && typeof block.data === 'string' && block.data && block.mimeType) {
      return { data: block.data, mimeType: block.mimeType };
    }
  }
  return null;
}

const cancel = () => ({ action: 'cancel' });

/** Ask the person through DSH's question card; any refusal, error or free text cancels. */
async function ask(questions, agent, signal, question, detail, labels) {
  if (!questions || !agent) return undefined;
  try {
    const result = await questions.ask({ agent, signal, questions: [{ id: QUESTION_ID, question,
      ...(detail ? { detail } : {}), options: labels.map(label => ({ label })) }] });
    const answer = result?.answers?.find(item => item.id === QUESTION_ID);
    return answer && !answer.custom?.trim() && answer.selected?.length === 1 ? answer.selected[0] : undefined;
  } catch {
    // ASK_CANCELLED, ASK_ABORTED, NO_PROVIDER (headless, ACP), DELEGATED_CALLER (subagents), CALLER_NOT_LIVE.
    return undefined;
  }
}

/**
 * Cordis apply. `deps.createMcpToolDefinition` is DSH's `@deepseek-ai/dsh-mcp-client` helper, which gives
 * the results DSH's own content and image handling: the bundle resolves it from the DSH installation,
 * which only a linked bundle's own files can do. `deps.createClient` replaces createCuaClient in tests.
 */
export async function apply(ctx, config = {}, deps = {}) {
  const { createMcpToolDefinition, createClient = createCuaClient } = deps;
  if (typeof createMcpToolDefinition !== 'function') {
    throw new Error('Computer use DSH plugin: load it through the bundle `dsh-computer-use` with its `@deepseek-ai/dsh-mcp-client` peer.');
  }
  // Session id -> { active: {turn, turnId}, pending: {turnId, event}, cleaning: Promise, disposed: boolean }.
  const sessions = new Map();
  // Tool calls in flight -> their agent: an approval is asked in the one agent with a call in flight.
  const inFlight = new Map();
  const log = message => ctx.logger?.warn?.(message);
  // Sidebar monitor state: the app the agent is targeting, its latest screenshot, and when it changed.
  const monitor = { app: null, at: 0, image: null, imageSeq: 0 };

  const client = createClient({
    command: commandFrom(config),
    cwd: process.cwd(),
    env: launcherEnvironment(config),
    adapter: 'dsh',
    allowedOrigins: originsFromEnvironment(),
    onElicitation: async (params, { signal }) => {
      const agents = new Set(inFlight.values());
      const agent = agents.size === 1 ? [...agents][0] : undefined;
      const questions = ctx.get('userQuestions');
      const nativeApproval = nativeAppApprovalOptions(params);
      if (nativeApproval) {
        const selected = await ask(questions, agent, signal, nativeApproval.message,
          `Application: ${nativeApproval.resource}`, nativeApproval.choices.map(choice => choice.label));
        const value = nativeApproval.choices.find(choice => choice.label === selected)?.value ?? 'cancel';
        return nativeAppApprovalResponse(params, value);
      }
      const schema = params?.requestedSchema;
      if (params?.mode === 'url' || schema?.type !== 'object' ||
          Object.keys(schema.properties ?? {}).length !== 0 ||
          (schema.required?.length ?? 0) !== 0 || typeof params.message !== 'string') {
        return cancel();
      }
      const selected = await ask(questions, agent, signal, params.message, undefined, ['Allow', 'Decline']);
      if (selected === 'Allow') return { action: 'accept', content: {} };
      if (selected === 'Decline') return { action: 'decline' };
      return cancel();
    },
  });

  let closing;
  const close = () => closing ??= (async () => {
    await Promise.allSettled([...sessions.keys()].map(id => finish(id, 'Interrupt')));
    sessions.clear();
    await client.close();
  })();
  ctx.effect(() => close, 'dsh-computer-use.client');

  /** End the session's Computer use turn upstream; a failure keeps it pending for the session's next call. */
  async function finish(sessionId, event, turn) {
    const state = sessions.get(sessionId);
    if (!state) return;
    if (state.active && (turn === undefined || state.active.turn === turn)) {
      state.pending = { turnId: state.active.turnId, event };
      state.active = undefined;
    }
    if (state.cleaning) return state.cleaning;
    const cleanup = state.pending;
    if (!cleanup) return;
    const attempt = (async () => {
      await client.turnEnded({ sessionId, turnId: cleanup.turnId, event: cleanup.event });
      if (state.pending === cleanup) state.pending = undefined;
    })();
    state.cleaning = attempt;
    try {
      await attempt;
    } finally {
      if (state.cleaning === attempt) state.cleaning = undefined;
    }
  }

  /** Drop a disposed session once its cleanup succeeds; a failure keeps it for later calls and shutdown. */
  async function release(sessionId) {
    try {
      await finish(sessionId, 'Interrupt');
    } catch (error) {
      log(`Computer use turn cleanup is pending: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (sessions.get(sessionId)?.disposed) sessions.delete(sessionId);
  }

  /** The Computer use turn id of the agent's open DSH turn, ending an earlier one first. */
  async function turnOf(agent) {
    const session = agent?.session;
    if (!session?.id) throw new Error('Computer use requires a DSH agent session');
    for (const [id, other] of sessions) if (other.disposed && id !== session.id) release(id);
    const boundary = ctx.get('sessionProjections')?.stateOf(session, 'turnBoundary');
    if (!boundary || boundary.openTurnStartSeq === null || boundary.openTurnStartSeq === undefined) {
      throw new Error('Computer use requires an active DSH agent turn');
    }
    const turn = boundary.lastTurn;
    let state = sessions.get(session.id);
    if (!state) sessions.set(session.id, state = {});
    state.disposed = false;
    if (state.active?.turn === turn) return state.active.turnId;
    // A turn whose end Computer use missed, or whose cleanup failed, must finish before this turn's first action.
    try {
      await finish(session.id, 'Interrupt');
    } catch (error) {
      throw new Error('Computer use is still finishing the previous turn, so Computer Use actions are paused. ' +
        `Try again in a few seconds. ${error instanceof Error ? error.message : String(error)}`);
    }
    if (state.active?.turn !== turn) state.active = { turn, turnId: randomUUID() };
    return state.active.turnId;
  }

  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'turn/end' || !sessions.has(session?.id)) return;
    const reason = event.data?.reason?.kind;
    finish(session.id, reason === 'completed' ? 'Stop' : 'Interrupt', event.data?.turn)
      .catch(error => log(`Computer use turn cleanup is pending: ${error instanceof Error ? error.message : String(error)}`));
  }, { global: true });
  ctx.on('session/disposed', (session) => {
    const state = sessions.get(session?.id);
    if (!state) return;
    state.disposed = true;
    release(session.id);
  }, { global: true });

  await client.connect();
  const instructions = client.instructions;
  for (const tool of client.publicTools()) {
    ctx.tools.register(createMcpToolDefinition(ctx, {
      name: tool.name,
      rawName: tool.name,
      description: tool.description ?? '',
      inputSchema: tool.inputSchema,
      // No timeoutMs: the client bounds each call and stops that deadline while an approval is open.
      async call(args, exec) {
        const turnId = await turnOf(exec.agent);
        inFlight.set(exec, exec.agent);
        if (tool.name === 'js') {
          const app = extractTargetApp(args?.code);
          if (app) { monitor.app = app; monitor.at = Date.now(); }
        } else if (tool.name === 'js_reset') {
          monitor.app = null; monitor.image = null; monitor.at = Date.now();
        }
        try {
          const result = await client.call(tool.name, args, {
            sessionId: exec.agent.session.id, turnId, toolCallId: exec.callId, signal: exec.signal,
            model: exec.agent.options?.model, reasoningEffort: exec.agent.options?.reasoningEffort,
          });
          if (tool.name === 'js') {
            const image = extractImage(result);
            if (image) { monitor.image = image; monitor.imageSeq += 1; monitor.at = Date.now(); }
          }
          return await persistAudioContent(result);
        } finally {
          inFlight.delete(exec);
        }
      },
    }));
  }
  // Sidebar monitor HTTP route (behind the connection trust fence).
  const webServer = ctx.webServer;
  if (webServer) {
    const rejected = (req, res) => {
      const rejection = ctx.connection.requestRejection(req);
      if (rejection === undefined) return false;
      res.statusCode = rejection;
      res.end();
      return true;
    };
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: '/dsh-computer-use',
      handler(req, res) {
        if (rejected(req, res)) return;
        const pathname = new URL(req.url || '/', 'http://localhost').pathname;
        if (pathname === '/dsh-computer-use/window') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify({
            app: monitor.app,
            at: monitor.at,
            imageSeq: monitor.imageSeq,
            hasImage: monitor.image != null,
          }));
          return;
        }
        if (pathname === '/dsh-computer-use/screenshot') {
          if (!monitor.image) { res.statusCode = 404; res.end('no screenshot'); return; }
          res.setHeader('Content-Type', monitor.image.mimeType);
          res.setHeader('Cache-Control', 'no-store');
          res.end(Buffer.from(monitor.image.data, 'base64'));
          return;
        }
        res.statusCode = 404;
        res.end('not found');
      },
    }));
  }

  ctx.systemPrompt.section({ name: PROMPT_SECTION, order: PROMPT_ORDER, interpolate: false, text: () => instructions });
}
