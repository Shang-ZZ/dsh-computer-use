// Bundle entry: resolve DSH's own MCP tool helper (a peer dependency DSH resolves from its
// installation) and forward the plugin's Cordis interface. `apply` is async so Cordis awaits it
// before the first model request (a sync-constructed plugin function would otherwise race tool registration).
import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client';
import * as computerUse from './adapters/plugin.mjs';

export const name = computerUse.name;
export const inject = computerUse.inject;

export async function apply(ctx, config) {
  return computerUse.apply(ctx, config, { createMcpToolDefinition });
}
