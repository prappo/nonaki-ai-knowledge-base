// Ported unchanged from wp-simple-pay-pro origin/develop (9e1146f7b): tools/release-console/server/runs/fake-query.ts
/**
 * A scripted stand-in for the SDK's `query()`, used with RELEASE_CONSOLE_FAKE=1.
 *
 * It walks through everything the UI has to handle (text, tool calls, a
 * question, a risky-command approval, a finished turn, a reply) without calling
 * Claude or touching the repo.
 */

import { randomUUID } from 'node:crypto';
import type { PermissionResult, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { QueryFn } from './runner.ts';

const SESSION_ID = 'fake-session';

function delay( ms: number, signal?: AbortSignal ): Promise<void> {
	return new Promise( ( resolve ) => {
		const timer = setTimeout( resolve, ms );
		signal?.addEventListener( 'abort', () => {
			clearTimeout( timer );
			resolve();
		}, { once: true } );
	} );
}

function assistant( content: unknown[] ): SDKMessage {
	return {
		type: 'assistant',
		uuid: randomUUID(),
		session_id: SESSION_ID,
		parent_tool_use_id: null,
		message: { role: 'assistant', content },
	} as unknown as SDKMessage;
}

function toolResult( toolUseId: string, text: string, isError = false ): SDKMessage {
	return {
		type: 'user',
		uuid: randomUUID(),
		session_id: SESSION_ID,
		parent_tool_use_id: null,
		message: {
			role: 'user',
			content: [ { type: 'tool_result', tool_use_id: toolUseId, content: text, is_error: isError } ],
		},
	} as unknown as SDKMessage;
}

function result( text: string, cost: number ): SDKMessage {
	return {
		type: 'result',
		subtype: 'success',
		uuid: randomUUID(),
		session_id: SESSION_ID,
		is_error: false,
		result: text,
		total_cost_usd: cost,
		duration_ms: 4200,
		num_turns: 3,
	} as unknown as SDKMessage;
}

function allowed( permission: PermissionResult | null ): permission is Extract<PermissionResult, { behavior: 'allow' }> {
	return permission?.behavior === 'allow';
}

function denial( permission: PermissionResult | null ): string {
	return permission?.behavior === 'deny' ? permission.message : 'No decision.';
}

function promptText( message: unknown ): string {
	const content = ( message as { message?: { content?: unknown } } )?.message?.content;

	return typeof content === 'string' ? content : '';
}

export const fakeQuery: QueryFn = ( { prompt, options } ) => {
	const signal = options.abortController?.signal;

	async function* run(): AsyncGenerator<SDKMessage> {
		const input = prompt[ Symbol.asyncIterator ]();
		const first = await input.next();

		if ( first.done ) {
			return;
		}

		yield {
			type: 'system',
			subtype: 'init',
			uuid: randomUUID(),
			session_id: SESSION_ID,
			model: 'fake-model',
		} as unknown as SDKMessage;

		if ( options.resume ) {
			await delay( 300, signal );
			yield assistant( [ { type: 'text', text: `Resumed fake session. You said: “${ promptText( first.value ) }”.` } ] );
			yield result( 'Resumed.', 0.01 );
		} else {
			yield* scripted( first.value );
		}

		for ( ;; ) {
			const next = await input.next();

			if ( next.done || signal?.aborted ) {
				return;
			}

			await delay( 300, signal );
			yield assistant( [ { type: 'text', text: `You said: “${ promptText( next.value ) }”. (Fake mode just echoes.)` } ] );
			yield result( 'Echoed the reply.', 0.02 );
		}
	}

	async function* scripted( first: unknown ): AsyncGenerator<SDKMessage> {
		await delay( 400, signal );
		yield assistant( [
			{ type: 'text', text: `**Fake run** of \`${ promptText( first ) }\`. Nothing here touches the repo.` },
			{ type: 'tool_use', id: 'fake-read', name: 'Bash', input: { command: 'git tag --sort=-v:refname | head -1' } },
		] );
		await delay( 400, signal );
		yield toolResult( 'fake-read', '4.17.4.1' );

		const questionInput = {
			questions: [
				{
					question: 'Use these changelog entries?',
					header: 'Changelog',
					multiSelect: false,
					options: [
						{ label: 'Use as drafted', description: 'Insert the entries exactly as shown.', preview: '* Fix: Example fix entry.\n* Update: Example update entry.' },
						{ label: 'Let me edit', description: 'Pause so you can reword them first.' },
					],
				},
			],
		};

		yield assistant( [ { type: 'tool_use', id: 'fake-ask', name: 'AskUserQuestion', input: questionInput } ] );

		const asked = await options.canUseTool!( 'AskUserQuestion', questionInput, {
			signal: signal ?? new AbortController().signal,
			toolUseID: 'fake-ask',
			requestId: randomUUID(),
		} );

		const answers = allowed( asked ) ? JSON.stringify( asked.updatedInput?.answers ?? {} ) : denial( asked );

		yield toolResult( 'fake-ask', `User answered: ${ answers }`, ! allowed( asked ) );

		// Publishing stages show the typed-confirmation approval; others a plain one.
		const prompt = promptText( first );
		const version = prompt.split( /\s+/ )[ 1 ] ?? '4.17.5';
		const publishing = /create-release|lite-publish|lite-org-release/.test( prompt );
		const pushInput = { command: publishing ? `gh release create ${ version } build.zip --title ${ version }` : `git push origin release/${ version }` };

		yield assistant( [ { type: 'tool_use', id: 'fake-push', name: 'Bash', input: pushInput } ] );

		const pushed = await options.canUseTool!( 'Bash', pushInput, {
			signal: signal ?? new AbortController().signal,
			toolUseID: 'fake-push',
			requestId: randomUUID(),
			title: `Claude wants to run ${ pushInput.command }`,
		} );

		yield toolResult(
			'fake-push',
			allowed( pushed ) ? '(fake) Everything up-to-date' : denial( pushed ),
			! allowed( pushed )
		);

		yield assistant( [ { type: 'text', text: 'Done with the scripted steps. Anything else? Reply below, or finish the run.' } ] );
		const report = {
			release_console: {
				status: allowed( pushed ) ? 'ok' : 'blocked',
				summary: allowed( pushed ) ? 'Fake run finished every scripted step.' : 'Fake run stopped because the command was denied.',
				files: [],
				followups: allowed( pushed ) ? [] : [ 'Re-run once you are ready to allow the command.' ],
			},
		};

		yield result( 'Scripted turn finished.\n\n```json\n' + JSON.stringify( report, null, 2 ) + '\n```', 0.01 );
	}

	return run();
};
