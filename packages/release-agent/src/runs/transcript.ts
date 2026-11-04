// Ported unchanged from wp-simple-pay-pro origin/develop (9e1146f7b): tools/release-console/server/runs/transcript.ts
/**
 * Turns Agent SDK messages into the transcript items the browser renders.
 *
 * Only what a release manager needs to follow along is kept: what Claude said,
 * which tools it ran (with a one-line summary), how each tool call ended, and
 * the result of each turn.
 */

import path from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

export type TranscriptItem =
	| { kind: 'text'; id: string; text: string; subagent: boolean }
	| {
			kind: 'tool';
			id: string;
			name: string;
			summary: string;
			subagent: boolean;
	  }
	| {
			kind: 'tool_result';
			id: string;
			toolUseId: string;
			ok: boolean;
			preview: string;
			subagent: boolean;
	  }
	| {
			kind: 'result';
			id: string;
			ok: boolean;
			text: string;
			costUsd: number | null;
			durationMs: number | null;
	  }
	| { kind: 'system'; id: string; text: string }
	| { kind: 'user'; id: string; text: string };

/**
 * The closing report a release command writes as its last output: a fenced
 * `json` block with a `release_console` object. It lets the console tell a
 * run that finished its job from one that stopped early (for example "the
 * release PR has not merged yet"), and list what is left to do.
 */
export interface RunOutcome {
	status: 'ok' | 'blocked' | 'failed';
	summary: string;
	files: string[];
	followups: string[];
}

const OUTCOME_STATUSES = [ 'ok', 'blocked', 'failed' ];

function stringList( value: unknown ): string[] {
	return Array.isArray( value ) ? value.filter( ( item ): item is string => typeof item === 'string' ).slice( 0, 50 ) : [];
}

/** Reads the last `release_console` block from a turn's final text, if any. */
export function parseOutcome( text: string ): RunOutcome | null {
	const blocks = [ ...text.matchAll( /```json\s*\n([\s\S]*?)```/g ) ].map( ( match ) => match[ 1 ] ).reverse();

	for ( const block of blocks ) {
		try {
			const data = JSON.parse( block ) as Record<string, unknown>;
			const report = data?.release_console as Record<string, unknown> | undefined;

			if ( ! report || ! OUTCOME_STATUSES.includes( report.status as string ) ) {
				continue;
			}

			return {
				status: report.status as RunOutcome[ 'status' ],
				summary: typeof report.summary === 'string' ? report.summary.slice( 0, 2000 ) : '',
				files: stringList( report.files ),
				followups: stringList( report.followups ),
			};
		} catch {
			continue;
		}
	}

	return null;
}

export interface NormalizedMessage {
	items: TranscriptItem[];
	sessionId: string | null;
	/** Absolute paths of files written or edited by tool calls in this message. */
	filesWritten: string[];
	isResult: boolean;
	costUsd: number | null;
	/** Only set on a result message. */
	outcome: RunOutcome | null;
}

const PREVIEW_LIMIT = 4000;
const SUMMARY_LIMIT = 240;
const WRITE_TOOLS = new Set( [ 'Write', 'Edit', 'MultiEdit', 'NotebookEdit' ] );

function truncate( text: string, limit: number ): string {
	return text.length > limit ? `${ text.slice( 0, limit ) }…` : text;
}

function asRecord( value: unknown ): Record<string, unknown> {
	return value && typeof value === 'object' ? ( value as Record<string, unknown> ) : {};
}

function asString( value: unknown ): string {
	return typeof value === 'string' ? value : '';
}

function relativePath( root: string, file: string ): string {
	if ( ! file ) {
		return '';
	}

	const relative = path.relative( root, file );

	return relative.startsWith( '..' ) ? file : relative;
}

/** A one-line description of a tool call, e.g. the command or file it touches. */
export function summarizeToolInput( name: string, input: unknown, root: string ): string {
	const data = asRecord( input );
	let summary = '';

	switch ( name ) {
		case 'Bash':
			summary = asString( data.command );
			break;
		case 'Read':
		case 'Write':
		case 'Edit':
		case 'MultiEdit':
			summary = relativePath( root, asString( data.file_path ) );
			break;
		case 'NotebookEdit':
			summary = relativePath( root, asString( data.notebook_path ) );
			break;
		case 'Glob':
		case 'Grep':
			summary = asString( data.pattern );
			break;
		case 'Agent':
		case 'Task':
			summary = asString( data.description ) || asString( data.prompt );
			break;
		case 'Skill':
			summary = [ asString( data.skill ), asString( data.args ) ].filter( Boolean ).join( ' ' );
			break;
		case 'WebSearch':
			summary = asString( data.query );
			break;
		case 'WebFetch':
			summary = asString( data.url );
			break;
		case 'AskUserQuestion':
			summary = 'Asked you a question';
			break;
		default:
			summary = Object.keys( data ).length ? JSON.stringify( data ) : '';
	}

	return truncate( summary.replace( /\s+/g, ' ' ).trim(), SUMMARY_LIMIT );
}

function toolResultText( content: unknown ): string {
	if ( typeof content === 'string' ) {
		return content;
	}

	if ( Array.isArray( content ) ) {
		return content
			.map( ( block ) => {
				const data = asRecord( block );

				if ( data.type === 'text' ) {
					return asString( data.text );
				}

				return data.type ? `[${ String( data.type ) }]` : '';
			} )
			.filter( Boolean )
			.join( '\n' );
	}

	return '';
}

export function normalizeMessage( message: SDKMessage, root: string ): NormalizedMessage {
	const normalized: NormalizedMessage = {
		items: [],
		sessionId: null,
		filesWritten: [],
		isResult: false,
		costUsd: null,
		outcome: null,
	};

	const data = asRecord( message );

	if ( typeof data.session_id === 'string' ) {
		normalized.sessionId = data.session_id;
	}

	const uuid = asString( data.uuid ) || `${ Date.now() }-${ Math.random() }`;
	const subagent = typeof data.parent_tool_use_id === 'string';

	if ( message.type === 'system' && asString( data.subtype ) === 'init' ) {
		const model = asString( data.model );

		normalized.items.push( {
			kind: 'system',
			id: uuid,
			text: model ? `Session started (${ model }).` : 'Session started.',
		} );

		return normalized;
	}

	if ( message.type === 'assistant' ) {
		const content = asRecord( data.message ).content;

		if ( ! Array.isArray( content ) ) {
			return normalized;
		}

		content.forEach( ( block, index ) => {
			const part = asRecord( block );

			if ( part.type === 'text' && asString( part.text ).trim() ) {
				normalized.items.push( {
					kind: 'text',
					id: `${ uuid }-${ index }`,
					text: asString( part.text ),
					subagent,
				} );
			}

			if ( part.type === 'tool_use' ) {
				const name = asString( part.name );
				const input = asRecord( part.input );

				normalized.items.push( {
					kind: 'tool',
					id: asString( part.id ) || `${ uuid }-${ index }`,
					name,
					summary: summarizeToolInput( name, input, root ),
					subagent,
				} );

				if ( WRITE_TOOLS.has( name ) ) {
					const file = asString( input.file_path ) || asString( input.notebook_path );

					if ( file ) {
						normalized.filesWritten.push( file );
					}
				}
			}
		} );

		return normalized;
	}

	if ( message.type === 'user' ) {
		const content = asRecord( data.message ).content;

		if ( ! Array.isArray( content ) ) {
			return normalized;
		}

		content.forEach( ( block, index ) => {
			const part = asRecord( block );

			if ( part.type !== 'tool_result' ) {
				return;
			}

			normalized.items.push( {
				kind: 'tool_result',
				id: `${ uuid }-${ index }`,
				toolUseId: asString( part.tool_use_id ),
				ok: part.is_error !== true,
				preview: truncate( toolResultText( part.content ), PREVIEW_LIMIT ),
				subagent,
			} );
		} );

		return normalized;
	}

	if ( message.type === 'result' ) {
		const ok = data.subtype === 'success' && data.is_error !== true;
		const cost = typeof data.total_cost_usd === 'number' ? data.total_cost_usd : null;
		const errors = Array.isArray( data.errors ) ? data.errors.map( String ).join( '\n' ) : '';

		normalized.isResult = true;
		normalized.costUsd = cost;
		normalized.outcome = parseOutcome( asString( data.result ) );
		normalized.items.push( {
			kind: 'result',
			id: uuid,
			ok,
			text: asString( data.result ) || errors || asString( data.subtype ),
			costUsd: cost,
			durationMs: typeof data.duration_ms === 'number' ? data.duration_ms : null,
		} );
	}

	return normalized;
}
