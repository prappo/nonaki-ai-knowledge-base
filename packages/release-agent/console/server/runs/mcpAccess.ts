/**
 * The MCP servers every agent session gets by default:
 *
 * - everything Claude Code itself loads from the user, project and local
 *   settings and the claude.ai connectors (the runner already uses those sources);
 * - the repo's `.mcp.json` servers, approved up front (a session can't answer
 *   the "trust this server?" prompt the terminal would show);
 * - Claude in Chrome, on laptops that have a browser;
 * - the control server's own MCP server (knowledge base search, answers,
 *   documents, projects and tasks), reached with this agent's paired token.
 */

import type { Options } from '@anthropic-ai/claude-agent-sdk';

/** Name the control server's MCP tools appear under: mcp__nonaki__search_knowledge_base, … */
export const CONTROL_MCP_NAME = 'nonaki';

/** Environment the agent passes to the console server. Never handed on to sessions. */
export const SERVER_ENV = 'RELEASE_SERVER';
export const TOKEN_ENV = 'RELEASE_AGENT_TOKEN';
export const CHROME_ENV = 'RELEASE_CHROME';

export interface McpAccess {
	/** The control server's base URL, e.g. https://kb.example.com */
	server?: string;
	/** This agent's bearer token (nk_agent_…). */
	token?: string;
	/** Attach Claude in Chrome. */
	chrome: boolean;
}

/** Reads the agent-provided settings; Chrome is on unless the agent says the laptop has no browser. */
export function mcpAccessFromEnv( env: NodeJS.ProcessEnv ): McpAccess {
	return {
		server: env[ SERVER_ENV ] || undefined,
		token: env[ TOKEN_ENV ] || undefined,
		chrome: env[ CHROME_ENV ] !== '0',
	};
}

/** The session's environment without the agent's credentials, so Bash and tools never see the token. */
export function sessionProcessEnv( env: NodeJS.ProcessEnv ): Record<string, string> {
	const clean: Record<string, string> = {};

	for ( const [ key, value ] of Object.entries( env ) ) {
		// the ElevenLabs key goes only to Marketing's voiceover session, which adds it itself
		if ( value !== undefined && key !== TOKEN_ENV && key !== SERVER_ENV && key !== CHROME_ENV && key !== 'ELEVENLABS_API_KEY' ) {
			clean[ key ] = value;
		}
	}

	return clean;
}

/** SDK options that give a session every MCP server by default. `chrome: false` leaves the browser out. */
export function sessionMcpOptions( access: McpAccess, { chrome = access.chrome }: { chrome?: boolean } = {} ): Partial<Options> {
	const options: Partial<Options> = {
		settings: { enableAllProjectMcpServers: true },
	};

	if ( access.server && access.token ) {
		options.mcpServers = {
			[ CONTROL_MCP_NAME ]: {
				type: 'http',
				url: new URL( '/api/mcp', access.server ).href,
				headers: { Authorization: `Bearer ${ access.token }` },
			},
		};
	}

	if ( chrome ) {
		options.extraArgs = { chrome: null };
	}

	return options;
}
