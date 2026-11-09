// Ported from wp-simple-pay-pro origin/develop (9e1146f7b): tools/release-console/server/runs/runner.ts
// Changed: risk rules come from the repo's recipe (setRiskAssessor) instead of a fixed import.
/**
 * Runs one release command through the Claude Agent SDK.
 *
 * A run is a single Claude Code session started with the command exactly as it
 * would be typed in a terminal (`/acme-prep-release 1.2.0`), with the
 * project's own settings, CLAUDE.md and commands loaded.
 *
 * Two things that would block a terminal session are routed to the browser:
 *
 * - `AskUserQuestion` calls become a question form. The answers go back to the
 *   tool as its input, the same way the terminal's picker answers them.
 * - Risky Bash commands (see risk.ts) become an approval card. A PreToolUse hook
 *   forces those to ask even when the permission allowlist would let them run.
 *
 * The input stream stays open after each turn, so when a command ends a turn
 * with a plain-text question the release manager can reply and the same
 * session carries on.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
	CanUseTool,
	HookCallbackMatcher,
	HookInput,
	HookJSONOutput,
	Options,
	PermissionResult,
	SDKMessage,
	SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { BROWSER_SCRIPT_TOOL, CHECKED_TOOLS, createRiskAssessor, describeToolCall, type RiskAssessor } from './risk.ts';

/**
 * The risk rules approvals use: the built-in ones until the agent sets the
 * repo's recipe rules (one run happens at a time, so one set is active).
 */
let activeRisk: RiskAssessor = createRiskAssessor();

export function setRiskAssessor( risk: RiskAssessor ): void {
	activeRisk = risk;
}

const assessToolRisk = ( toolName: string, input: unknown ) => activeRisk.assessToolRisk( toolName, input );
import type { RunStore } from './store.ts';
import { normalizeMessage, type RunOutcome, type TranscriptItem } from './transcript.ts';

export type RunStatus =
	| 'running'
	| 'waiting'
	| 'awaiting_reply'
	| 'done'
	| 'stopped'
	| 'error'
	// The server stopped while the run was active (only seen on saved runs).
	| 'interrupted';

const ACTIVE_STATUSES: RunStatus[] = [ 'running', 'waiting', 'awaiting_reply' ];

export interface QuestionOption {
	label: string;
	description: string;
	preview?: string;
}

export interface Question {
	question: string;
	header: string;
	options: QuestionOption[];
	multiSelect: boolean;
}

export type Gate =
	| {
			id: string;
			type: 'question';
			createdAt: number;
			subagent: boolean;
			questions: Question[];
	  }
	| {
			id: string;
			type: 'approval';
			createdAt: number;
			subagent: boolean;
			toolName: string;
			command: string;
			reason: string;
			title: string | null;
			/**
			 * For permanent, public actions: the text (the release version) that
			 * must be typed to allow it. Null when a click is enough.
			 */
			confirmPhrase: string | null;
	  };

export type GateAnswer =
	| { type: 'question'; answers: Record<string, string> }
	| { type: 'approval'; allow: boolean; message?: string; confirm?: string }
	| { type: 'cancel'; message: string };

export type RunEvent =
	| { type: 'item'; item: TranscriptItem }
	| { type: 'status'; status: RunStatus; error: string | null }
	| { type: 'gate'; gate: Gate }
	| { type: 'gate_resolved'; gateId: string }
	| { type: 'meta'; sessionId: string | null; costUsd: number | null; files: string[]; outcome: RunOutcome | null };

export interface RunSnapshot {
	id: string;
	stageId: string;
	version: string;
	prompt: string;
	status: RunStatus;
	error: string | null;
	startedAt: number;
	endedAt: number | null;
	sessionId: string | null;
	costUsd: number | null;
	files: string[];
	items: TranscriptItem[];
	gates: Gate[];
	/** The run this one continued, when it was started with Resume. */
	resumedFrom: string | null;
	/** What the command reported in its closing result block, if it wrote one. */
	outcome: RunOutcome | null;
	/** Set for runs that don't use the default ("risky") approvals. */
	permissions?: RunPermissions;
}

/** Whether a run's session can be picked up again with Resume. */
export function isResumable( run: Pick<RunSnapshot, 'status' | 'sessionId'> ): boolean {
	return ! ACTIVE_STATUSES.includes( run.status ) && Boolean( run.sessionId );
}

/** The part of the SDK's Query object the runner uses. */
export interface QueryHandle extends AsyncIterable<SDKMessage> {
	close?: () => void;
}

export type QueryFn = ( params: {
	prompt: AsyncIterable<SDKUserMessage>;
	options: Options;
} ) => QueryHandle;

/** A user-message stream the runner can keep adding to until it is closed. */
export class InputQueue implements AsyncIterable<SDKUserMessage> {
	private messages: SDKUserMessage[] = [];
	private waiting: ( ( result: IteratorResult<SDKUserMessage> ) => void ) | null = null;
	private closed = false;

	push( text: string ): void {
		if ( this.closed ) {
			throw new Error( 'The run no longer accepts messages.' );
		}

		const message: SDKUserMessage = {
			type: 'user',
			message: { role: 'user', content: text },
			parent_tool_use_id: null,
			origin: { kind: 'human' },
		};

		if ( this.waiting ) {
			const resolve = this.waiting;
			this.waiting = null;
			resolve( { value: message, done: false } );
			return;
		}

		this.messages.push( message );
	}

	close(): void {
		this.closed = true;

		if ( this.waiting ) {
			const resolve = this.waiting;
			this.waiting = null;
			resolve( { value: undefined, done: true } );
		}
	}

	get isClosed(): boolean {
		return this.closed;
	}

	[ Symbol.asyncIterator ](): AsyncIterator<SDKUserMessage> {
		return {
			next: () => {
				const message = this.messages.shift();

				if ( message ) {
					return Promise.resolve( { value: message, done: false } );
				}

				if ( this.closed ) {
					return Promise.resolve( { value: undefined, done: true } );
				}

				return new Promise( ( resolve ) => {
					this.waiting = resolve;
				} );
			},
		};
	}
}

function toQuestions( input: Record<string, unknown> ): Question[] {
	const raw = Array.isArray( input.questions ) ? input.questions : [];

	return raw.map( ( entry ) => {
		const data = ( entry ?? {} ) as Record<string, unknown>;
		const options = Array.isArray( data.options ) ? data.options : [];

		return {
			question: String( data.question ?? '' ),
			header: String( data.header ?? '' ),
			multiSelect: data.multiSelect === true,
			options: options.map( ( option ) => {
				const value = ( option ?? {} ) as Record<string, unknown>;

				return {
					label: String( value.label ?? '' ),
					description: String( value.description ?? '' ),
					...( typeof value.preview === 'string' ? { preview: value.preview } : {} ),
				};
			} ),
		};
	} );
}

/**
 * PreToolUse hook: send risky tool calls (see risk.ts) and AskUserQuestion to
 * the permission prompt (our canUseTool), no matter what the allowlist says.
 */
export async function forceAskHook( input: HookInput ): Promise<HookJSONOutput> {
	if ( input.hook_event_name !== 'PreToolUse' ) {
		return {};
	}

	const ask = ( reason: string ): HookJSONOutput => ( {
		hookSpecificOutput: {
			hookEventName: 'PreToolUse',
			permissionDecision: 'ask',
			permissionDecisionReason: reason,
		},
	} );

	if ( input.tool_name === 'AskUserQuestion' ) {
		return ask( 'Answered in the Release Console.' );
	}

	const risk = assessToolRisk( input.tool_name, input.tool_input );

	return risk ? ask( risk.reason ) : {};
}

export interface RunOptions {
	stageId: string;
	version: string;
	prompt: string;
	cwd: string;
	queryFn: QueryFn;
	/** Extra SDK options, e.g. a model override. */
	sdkOptions?: Partial<Options>;
	/** Continue an earlier run's Claude session instead of starting a new one. */
	resume?: {
		run: RunSnapshot;
	};
	/**
	 * What stops for approval. "risky" (the default, as in the release
	 * console): only risky commands. "ask": every tool call the allowlist
	 * doesn't cover, and file edits too — like the terminal's default mode.
	 */
	permissions?: RunPermissions;
	/** What to type to allow a permanent action. Default: the run's version. */
	confirmPhrase?: string;
}

export type RunPermissions = 'risky' | 'ask';

export class Run extends EventEmitter {
	readonly id = randomUUID();
	readonly stageId: string;
	readonly version: string;
	readonly prompt: string;
	status: RunStatus = 'running';
	error: string | null = null;
	readonly startedAt = Date.now();
	endedAt: number | null = null;
	sessionId: string | null = null;
	costUsd: number | null = null;
	readonly items: TranscriptItem[] = [];
	readonly resumedFrom: string | null = null;
	outcome: RunOutcome | null = null;
	private readonly files = new Set<string>();
	/** Cost of the earlier run(s) this one continues. Results only report the current process. */
	private readonly priorCostUsd: number = 0;
	private readonly gates = new Map<string, { gate: Gate; resolve: ( answer: GateAnswer ) => void }>();
	private readonly input = new InputQueue();
	private readonly abort = new AbortController();
	private query: QueryHandle | null = null;
	private readonly cwd: string;
	private readonly options: RunOptions;

	constructor( options: RunOptions ) {
		super();
		this.options = options;
		this.stageId = options.stageId;
		this.version = options.version;
		this.prompt = options.prompt;
		this.cwd = options.cwd;

		const previous = options.resume?.run;

		if ( previous ) {
			// Carry the transcript over, so the resumed run reads as one conversation.
			this.resumedFrom = previous.id;
			this.sessionId = previous.sessionId;
			this.costUsd = previous.costUsd;
			this.priorCostUsd = previous.costUsd ?? 0;
			this.items.push( ...previous.items );
			previous.files.forEach( ( file ) => this.files.add( file ) );
			this.items.push( {
				kind: 'system',
				id: randomUUID(),
				text: 'Resumed the session.',
			} );
		}
	}

	get isActive(): boolean {
		return ACTIVE_STATUSES.includes( this.status );
	}

	snapshot(): RunSnapshot {
		return {
			id: this.id,
			stageId: this.stageId,
			version: this.version,
			prompt: this.prompt,
			status: this.status,
			error: this.error,
			startedAt: this.startedAt,
			endedAt: this.endedAt,
			sessionId: this.sessionId,
			costUsd: this.costUsd,
			files: [ ...this.files ],
			items: [ ...this.items ],
			gates: [ ...this.gates.values() ].map( ( entry ) => entry.gate ),
			resumedFrom: this.resumedFrom,
			outcome: this.outcome,
			...( this.options.permissions && this.options.permissions !== 'risky' ? { permissions: this.options.permissions } : {} ),
		};
	}

	/** Starts the session. Resolves when the run has ended, however it ended. */
	async start(): Promise<void> {
		if ( this.options.resume ) {
			this.addItem( { kind: 'user', id: randomUUID(), text: this.prompt } );
		}

		this.input.push( this.prompt );

		const hooks: Partial<Record<'PreToolUse', HookCallbackMatcher[]>> = {
			PreToolUse: [ { matcher: CHECKED_TOOLS, hooks: [ forceAskHook ] } ],
		};

		try {
			this.query = this.options.queryFn( {
				prompt: this.input,
				options: {
					// Stage options (Chrome, env, a model) go first, so they can never
					// replace the approvals, hooks or permission mode below.
					...this.options.sdkOptions,
					cwd: this.cwd,
					// Same sources as the terminal: user, project and local settings,
					// so CLAUDE.md, the commands, skills and allowlist all apply.
					settingSources: [ 'user', 'project', 'local' ],
					systemPrompt: { type: 'preset', preset: 'claude_code' },
					// File edits go ahead as they would after "accept edits" in the
					// terminal. Risky commands still stop, via the hook above. In
					// "ask" mode edits ask first too, as in the terminal's default.
					permissionMode: this.options.permissions === 'ask' ? 'default' : 'acceptEdits',
					canUseTool: this.canUseTool,
					hooks,
					abortController: this.abort,
					...( this.options.resume?.run.sessionId ? { resume: this.options.resume.run.sessionId } : {} ),
				},
			} );

			for await ( const message of this.query ) {
				this.handleMessage( message );
			}

			if ( this.isActive ) {
				this.finishWith( 'done' );
			}
		} catch ( error ) {
			if ( this.isActive ) {
				this.finishWith( 'error', error instanceof Error ? error.message : String( error ) );
			}
		} finally {
			this.cancelGates( 'The run ended.' );
			this.input.close();
		}
	}

	/** Answers a pending question or approval. Returns false if no such gate is pending. */
	resolveGate( gateId: string, answer: GateAnswer ): boolean {
		const entry = this.gates.get( gateId );

		if ( ! entry ) {
			return false;
		}

		if ( answer.type !== 'cancel' && answer.type !== entry.gate.type ) {
			throw new Error( `Gate ${ gateId } expects a ${ entry.gate.type } answer.` );
		}

		// Enforced here, not only in the UI, so a stray request cannot publish.
		if (
			entry.gate.type === 'approval' &&
			entry.gate.confirmPhrase &&
			answer.type === 'approval' &&
			answer.allow &&
			answer.confirm?.trim() !== entry.gate.confirmPhrase
		) {
			throw new Error( `Type ${ entry.gate.confirmPhrase } to allow this. It is permanent and public.` );
		}

		this.gates.delete( gateId );
		entry.resolve( answer );
		this.emitEvent( { type: 'gate_resolved', gateId } );

		if ( this.status === 'waiting' && this.gates.size === 0 ) {
			this.setStatus( 'running' );
		}

		return true;
	}

	/** Sends a reply after a turn has ended with a question in plain text. */
	reply( text: string ): void {
		if ( this.status !== 'awaiting_reply' ) {
			throw new Error( 'The run is not waiting for a reply.' );
		}

		const trimmed = text.trim();

		if ( ! trimmed ) {
			throw new Error( 'The reply is empty.' );
		}

		this.addItem( { kind: 'user', id: randomUUID(), text: trimmed } );
		this.input.push( trimmed );
		this.setStatus( 'running' );
	}

	/** Ends a run that is waiting for a reply. */
	finish(): void {
		if ( this.status !== 'awaiting_reply' ) {
			throw new Error( 'Only a run waiting for a reply can be finished. Use Stop to end a running one.' );
		}

		this.finishWith( 'done' );
		this.input.close();
		this.query?.close?.();
	}

	/**
	 * Stops the run immediately. `interrupted` is for the server shutting
	 * down, so the run is not recorded as something the release manager stopped.
	 */
	stop( reason: 'stopped' | 'interrupted' = 'stopped' ): void {
		if ( ! this.isActive ) {
			return;
		}

		// A run whose command already reported success was only waiting to be
		// closed; a shutdown does not interrupt any work.
		const finishedWork = reason === 'interrupted' && this.status === 'awaiting_reply' && this.outcome?.status === 'ok';

		this.finishWith( finishedWork ? 'done' : reason );
		this.cancelGates( reason === 'stopped' ? 'The run was stopped.' : 'The console shut down.' );
		this.input.close();
		this.abort.abort();
		this.query?.close?.();
	}

	private readonly canUseTool: CanUseTool = async ( toolName, input, options ) => {
		if ( toolName === 'AskUserQuestion' ) {
			const answer = await this.openGate( {
				id: randomUUID(),
				type: 'question',
				createdAt: Date.now(),
				subagent: Boolean( options.agentID ),
				questions: toQuestions( input ),
			}, options.signal );

			if ( answer.type !== 'question' ) {
				return { behavior: 'deny', message: answer.type === 'cancel' ? answer.message : 'No answer was given.' };
			}

			return { behavior: 'allow', updatedInput: { ...input, answers: answer.answers } };
		}

		const risk = assessToolRisk( toolName, input );

		if ( ! risk && this.options.permissions === 'ask' ) {
			// Like the terminal: anything the allowlist doesn't cover asks first.
			const answer = await this.openGate( {
				id: randomUUID(),
				type: 'approval',
				createdAt: Date.now(),
				subagent: Boolean( options.agentID ),
				toolName,
				command: describeToolCall( toolName, input ),
				reason: options.decisionReason ?? `Claude wants to use ${ toolName }.`,
				title: options.title ?? null,
				confirmPhrase: null,
			}, options.signal );

			return this.approvalResult( answer, input );
		}

		if ( ! risk ) {
			// Anything else that reached the prompt is allowed, as the plan
			// describes: the risk list, not the allowlist, decides what stops.
			return { behavior: 'allow', updatedInput: input };
		}

		const answer = await this.openGate( {
			id: randomUUID(),
			type: 'approval',
			createdAt: Date.now(),
			subagent: Boolean( options.agentID ),
			toolName,
			command: describeToolCall( toolName, input ),
			reason: risk.reason,
			title: options.title ?? null,
			confirmPhrase: risk.irreversible ? ( this.options.confirmPhrase ?? this.version ) : null,
		}, options.signal );

		return this.approvalResult( answer, input );
	};

	private approvalResult( answer: GateAnswer, input: Record<string, unknown> ): PermissionResult {
		if ( answer.type === 'approval' && answer.allow ) {
			return { behavior: 'allow', updatedInput: input };
		}

		// A declined edit didn't write its file: don't list it as written.
		if ( typeof input.file_path === 'string' ) {
			const file = input.file_path;
			const relative = file.startsWith( this.cwd + '/' ) ? file.slice( this.cwd.length + 1 ) : file;

			if ( this.files.delete( file ) || this.files.delete( relative ) ) {
				this.emitEvent( { type: 'meta', sessionId: this.sessionId, costUsd: this.costUsd, files: [ ...this.files ], outcome: this.outcome } );
			}
		}

		// Agent sessions (which set permissions) speak to the user, not the release manager.
		const who = this.options.permissions ? 'You' : 'The release manager';
		const where = this.options.permissions ? '' : ' in the Release Console';
		const message =
			answer.type === 'cancel'
				? answer.message
				: answer.type === 'approval' && answer.message?.trim()
					? `${ who } declined this: ${ answer.message.trim() }`
					: `${ who } declined this${ where }. Do not retry it; continue without it or ask how to proceed.`;

		return { behavior: 'deny', message };
	}


	private openGate( gate: Gate, signal: AbortSignal ): Promise<GateAnswer> {
		if ( ! this.isActive ) {
			return Promise.resolve( { type: 'cancel', message: 'The run has ended.' } );
		}

		return new Promise( ( resolve ) => {
			this.gates.set( gate.id, { gate, resolve } );
			this.emitEvent( { type: 'gate', gate } );
			this.setStatus( 'waiting' );

			signal.addEventListener(
				'abort',
				() => this.resolveGate( gate.id, { type: 'cancel', message: 'The tool call was cancelled.' } ),
				{ once: true }
			);
		} );
	}

	private cancelGates( message: string ): void {
		for ( const id of [ ...this.gates.keys() ] ) {
			this.resolveGate( id, { type: 'cancel', message } );
		}
	}

	private handleMessage( message: SDKMessage ): void {
		if ( ! this.isActive ) {
			return;
		}

		const normalized = normalizeMessage( message, this.cwd );
		let metaChanged = false;

		if ( normalized.sessionId && normalized.sessionId !== this.sessionId ) {
			this.sessionId = normalized.sessionId;
			metaChanged = true;
		}

		for ( const file of normalized.filesWritten ) {
			if ( ! this.files.has( file ) ) {
				this.files.add( file );
				metaChanged = true;
			}
		}

		if ( normalized.costUsd !== null ) {
			this.costUsd = this.priorCostUsd + normalized.costUsd;
			metaChanged = true;
		}

		// Each turn's result replaces the outcome; the last turn's report is the one that counts.
		if ( normalized.isResult ) {
			this.outcome = normalized.outcome;
			metaChanged = true;
		}

		normalized.items.forEach( ( item ) => this.addItem( item ) );

		if ( metaChanged ) {
			this.emitEvent( {
				type: 'meta',
				sessionId: this.sessionId,
				costUsd: this.costUsd,
				files: [ ...this.files ],
				outcome: this.outcome,
			} );
		}

		if ( normalized.isResult && this.gates.size === 0 ) {
			this.setStatus( 'awaiting_reply' );

			// The command says it is done: nothing is left to answer, so finish the
			// run instead of leaving it open (and "running") until someone presses
			// Finish. Resume still continues the same session. Deferred so listeners
			// see the end of the turn first.
			if ( this.outcome?.status === 'ok' ) {
				setImmediate( () => {
					if ( this.status === 'awaiting_reply' && this.outcome?.status === 'ok' ) {
						this.finish();
					}
				} );
			}
		}
	}

	private addItem( item: TranscriptItem ): void {
		this.items.push( item );
		this.emitEvent( { type: 'item', item } );
	}

	private finishWith( status: RunStatus, error: string | null = null ): void {
		this.endedAt = Date.now();
		this.error = error;
		this.setStatus( status );
	}

	private setStatus( status: RunStatus ): void {
		if ( this.status === status && status !== 'error' ) {
			return;
		}

		this.status = status;
		this.emitEvent( { type: 'status', status, error: this.error } );
	}

	private emitEvent( event: RunEvent ): void {
		this.emit( 'event', event );
	}
}

export type SessionOptions = Partial<Options> | ( ( stageId: string ) => Partial<Options> );

/** Summary of a run for the history list. */
export interface RunSummary {
	id: string;
	stageId: string;
	version: string;
	prompt: string;
	status: RunStatus;
	startedAt: number;
	endedAt: number | null;
	costUsd: number | null;
	resumable: boolean;
	resumedFrom: string | null;
	outcome: RunOutcome | null;
}

function summarize( run: RunSnapshot ): RunSummary {
	return {
		id: run.id,
		stageId: run.stageId,
		version: run.version,
		prompt: run.prompt,
		status: run.status,
		startedAt: run.startedAt,
		endedAt: run.endedAt,
		costUsd: run.costUsd,
		resumable: isResumable( run ),
		resumedFrom: run.resumedFrom,
		outcome: run.outcome,
	};
}

const SAVE_DELAY_MS = 250;

/**
 * Holds the live run and the saved history, and enforces one run at a time.
 * Every change to the live run is saved to the store shortly after it happens,
 * and straight away when the run ends.
 */
export class RunManager {
	private current: Run | null = null;
	private readonly saved = new Map<string, RunSnapshot>();
	private readonly cwd: string;
	private readonly queryFn: QueryFn;
	private readonly sdkOptions: SessionOptions;
	private readonly store: RunStore | null;

	/**
	 * `sdkOptions` may be a function of the stage, so a stage can get its own
	 * session settings (Chrome for the browser stages, the Lite path as env).
	 */
	constructor( cwd: string, queryFn: QueryFn, sdkOptions: SessionOptions = {}, store: RunStore | null = null ) {
		this.cwd = cwd;
		this.queryFn = queryFn;
		this.sdkOptions = sdkOptions;
		this.store = store;

		for ( const run of store?.loadAll() ?? [] ) {
			this.saved.set( run.id, run );
		}
	}

	/** The live run, if one has been started since the server started. */
	get latest(): Run | null {
		return this.current;
	}

	/** The live run, or else the most recent saved run. */
	latestSnapshot(): RunSnapshot | null {
		if ( this.current ) {
			return this.current.snapshot();
		}

		return this.list()[ 0 ] ? this.snapshot( this.list()[ 0 ].id ) : null;
	}

	/** The live run with this id. Saved runs cannot be acted on, only read. */
	get( id: string ): Run | null {
		return this.current?.id === id ? this.current : null;
	}

	snapshot( id: string ): RunSnapshot | null {
		if ( this.current?.id === id ) {
			return this.current.snapshot();
		}

		return this.saved.get( id ) ?? null;
	}

	/** Run history, newest first, optionally for one version. */
	list( version?: string ): RunSummary[] {
		const runs = new Map( this.saved );

		if ( this.current ) {
			runs.set( this.current.id, this.current.snapshot() );
		}

		return [ ...runs.values() ]
			.filter( ( run ) => ! version || run.version === version )
			.sort( ( a, b ) => b.startedAt - a.startedAt )
			.map( summarize );
	}

	start( stageId: string, version: string, prompt: string, extra: Pick<RunOptions, 'permissions' | 'confirmPhrase'> = {} ): Run {
		return this.launch( { stageId, version, prompt, ...extra } );
	}

	/** Repo-relative paths every known run recorded writing. */
	writtenFiles(): Set<string> {
		const files = new Set<string>();
		const runs = [ ...this.saved.values(), ...( this.current ? [ this.current.snapshot() ] : [] ) ];

		for ( const run of runs ) {
			for ( const file of run.files ) {
				files.add( file.startsWith( this.cwd + '/' ) ? file.slice( this.cwd.length + 1 ) : file );
			}
		}

		return files;
	}

	/** Forgets every run, after its saved files have been deleted. Refused while one is active. */
	clearHistory(): void {
		if ( this.current?.isActive ) {
			throw new RunConflictError( this.current );
		}

		this.saved.clear();
		this.current = null;
	}

	/**
	 * Deletes a conversation: this run, the runs it resumed and the runs that
	 * resumed it, from memory and from the store. Returns the deleted ids.
	 * Refused while any of them is still running.
	 */
	deleteConversation( id: string ): string[] {
		const runs = new Map( this.saved );

		if ( this.current ) {
			runs.set( this.current.id, this.current.snapshot() );
		}

		if ( ! runs.has( id ) ) {
			throw new Error( 'No such run.' );
		}

		// walk back to the first session, then collect everything resumed from it
		let root = runs.get( id )!;

		while ( root.resumedFrom && runs.has( root.resumedFrom ) ) {
			root = runs.get( root.resumedFrom )!;
		}

		const chain = new Set( [ root.id ] );
		let grew = true;

		while ( grew ) {
			grew = false;

			for ( const run of runs.values() ) {
				if ( run.resumedFrom && chain.has( run.resumedFrom ) && ! chain.has( run.id ) ) {
					chain.add( run.id );
					grew = true;
				}
			}
		}

		if ( this.current && chain.has( this.current.id ) && this.current.isActive ) {
			throw new Error( 'That chat is still running. Stop it first, then delete it.' );
		}

		for ( const runId of chain ) {
			this.saved.delete( runId );
			this.store?.remove( runId );
		}

		if ( this.current && chain.has( this.current.id ) ) {
			this.current = null;
		}

		return [ ...chain ];
	}

	/** Deletes every run, from memory and from the store. Refused while one is running. */
	deleteAll(): number {
		if ( this.current?.isActive ) {
			throw new Error( 'A chat is still running. Stop it first, then delete the chats.' );
		}

		const ids = new Set( [ ...this.saved.keys(), ...( this.current ? [ this.current.id ] : [] ) ] );

		for ( const runId of ids ) {
			this.store?.remove( runId );
		}

		this.saved.clear();
		this.current = null;

		return ids.size;
	}

	/** Continues an ended run's Claude session with a new message. */
	resume( id: string, message: string ): Run {
		const previous = this.snapshot( id );

		if ( ! previous ) {
			throw new Error( 'No such run.' );
		}

		if ( ! isResumable( previous ) ) {
			throw new Error(
				previous.sessionId
					? 'That run is still in progress.'
					: 'That run ended before Claude started a session, so there is nothing to resume.'
			);
		}

		const text = message.trim() || 'Continue where you left off.';

		return this.launch( {
			stageId: previous.stageId,
			version: previous.version,
			prompt: text,
			resume: { run: previous },
			// a resumed session keeps its approvals mode
			...( previous.permissions ? { permissions: previous.permissions } : {} ),
			...( this.confirmPhrase ? { confirmPhrase: this.confirmPhrase } : {} ),
		} );
	}

	/** Set for a manager whose runs have no version (Agent sessions): what to type for permanent actions. */
	confirmPhrase: string | null = null;

	private launch( options: Pick<RunOptions, 'stageId' | 'version' | 'prompt' | 'resume' | 'permissions' | 'confirmPhrase'> ): Run {
		if ( this.current?.isActive ) {
			throw new RunConflictError( this.current );
		}

		if ( this.current ) {
			this.saved.set( this.current.id, this.current.snapshot() );
		}

		const sdkOptions = typeof this.sdkOptions === 'function' ? this.sdkOptions( options.stageId ) : this.sdkOptions;
		const run = new Run( { ...options, cwd: this.cwd, queryFn: this.queryFn, sdkOptions } );

		this.current = run;
		this.persist( run );
		void run.start();

		return run;
	}

	private persist( run: Run ): void {
		if ( ! this.store ) {
			return;
		}

		const store = this.store;
		let timer: ReturnType<typeof setTimeout> | null = null;

		const save = () => {
			timer = null;
			store.save( run.snapshot() );
		};

		save();

		run.on( 'event', ( event: RunEvent ) => {
			if ( event.type === 'status' && ! run.isActive ) {
				if ( timer ) {
					clearTimeout( timer );
				}

				save();
				return;
			}

			timer ??= setTimeout( save, SAVE_DELAY_MS );
		} );
	}
}

export class RunConflictError extends Error {
	readonly run: Run;

	constructor( run: Run ) {
		super( `A ${ run.stageId } run is already in progress. Finish or stop it first.` );
		this.run = run;
	}
}
