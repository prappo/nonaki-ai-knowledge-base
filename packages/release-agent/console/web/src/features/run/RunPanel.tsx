import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, RUNS, type RunOutcome, type RunSnapshot } from '../../lib/api.ts';
import { CopyButton } from '../../components/CopyButton.tsx';
import { StageIcon } from '../../components/icons.tsx';
import { GateCard } from './GateCard.tsx';
import { isActive } from '../../lib/runState.ts';
import { formatCost, formatDuration, Transcript } from './Transcript.tsx';

const STATUS_LABELS: Record<RunSnapshot[ 'status' ], string> = {
	running: 'Running',
	waiting: 'Needs you',
	awaiting_reply: 'Waiting for your reply',
	done: 'Finished',
	stopped: 'Stopped',
	error: 'Failed',
	interrupted: 'Interrupted',
};

function useNow( active: boolean ): number {
	const [ now, setNow ] = useState( Date.now() );

	useEffect( () => {
		if ( ! active ) {
			return;
		}

		const timer = setInterval( () => setNow( Date.now() ), 1000 );

		return () => clearInterval( timer );
	}, [ active ] );

	return now;
}

const OUTCOME_LABELS: Record<RunOutcome[ 'status' ], string> = {
	ok: 'Completed',
	blocked: 'Stopped early',
	failed: 'Failed',
};

/** The closing report the command wrote, if it wrote one. */
function OutcomeCard( { outcome, root, onOpenFile }: { outcome: RunOutcome; root: string; onOpenFile: ( path: string ) => void } ) {
	const [ showAll, setShowAll ] = useState( false );
	const relative = ( file: string ) => ( file.startsWith( root + '/' ) ? file.slice( root.length + 1 ) : file );

	return (
		<section className={ `outcome outcome-${ outcome.status }` } aria-label="Command report">
			<header>
				<span className="gate-label">{ OUTCOME_LABELS[ outcome.status ] }</span>
				<span className="muted small-text">reported by the command</span>
			</header>
			{ outcome.summary && <p>{ outcome.summary }</p> }
			{ outcome.followups.length > 0 && (
				<>
					<p className="small-text outcome-heading">Left for you to do</p>
					<ul>
						{ outcome.followups.map( ( item ) => (
							<li key={ item }>{ item }</li>
						) ) }
					</ul>
				</>
			) }
			{ outcome.files.length > 0 && (
				<p className="small-text">
					Files:{ ' ' }
					{ ( showAll ? outcome.files : outcome.files.slice( 0, 6 ) ).map( ( file, index ) => (
						<span key={ file }>
							{ index > 0 && ', ' }
							{ file.startsWith( '/' ) && ! file.startsWith( root + '/' ) ? (
								<code>{ file }</code>
							) : (
								<button type="button" className="link" onClick={ () => onOpenFile( relative( file ) ) }>
									<code>{ relative( file ) }</code>
								</button>
							) }
						</span>
					) ) }
					{ outcome.files.length > 6 && (
						<>
							{ ' ' }
							<button type="button" className="link" onClick={ () => setShowAll( ! showAll ) }>
								{ showAll ? 'Show fewer' : `+${ outcome.files.length - 6 } more` }
							</button>
						</>
					) }
				</p>
			) }
		</section>
	);
}

function ResumeBox( {
	run,
	blocked,
	onResumed,
	onError,
	apiBase,
}: {
	run: RunSnapshot;
	apiBase: string;
	blocked: string | null;
	onResumed: ( run: RunSnapshot ) => void;
	onError: ( message: string ) => void;
} ) {
	const [ text, setText ] = useState( '' );
	const [ busy, setBusy ] = useState( false );

	async function resume() {
		setBusy( true );

		try {
			const { run: resumed } = await api.resume( run.id, text, apiBase );
			setText( '' );
			onResumed( resumed );
		} catch ( error ) {
			onError( ( error as Error ).message );
		} finally {
			setBusy( false );
		}
	}

	return (
		<form
			className="reply"
			onSubmit={ ( event ) => {
				event.preventDefault();
				void resume();
			} }
		>
			<p className="muted">
				{ run.status === 'interrupted'
					? 'The console stopped while this run was going. Resume picks the same Claude session back up.'
					: 'Resume continues this Claude session with a new message, keeping everything it already knows.' }
			</p>
			<textarea
				rows={ 2 }
				value={ text }
				placeholder="Continue where you left off."
				onChange={ ( event ) => setText( event.target.value ) }
				onKeyDown={ ( event ) => {
					if ( event.key === 'Enter' && ( event.metaKey || event.ctrlKey ) ) {
						event.currentTarget.form?.requestSubmit();
					}
				} }
			/>
			<div className="actions">
				{ blocked && <span className="muted small-text">{ blocked }</span> }
				<button type="submit" className="btn btn-primary" disabled={ busy || Boolean( blocked ) }>
					{ busy ? 'Resuming…' : 'Resume' }
				</button>
			</div>
		</form>
	);
}

function ReplyBox( {
	run,
	sequenceNext,
	onError,
	apiBase,
}: {
	run: RunSnapshot;
	apiBase: string;
	/** The stage Run all starts after this one, when this run is part of a sequence. */
	sequenceNext: string | null;
	onError: ( message: string ) => void;
} ) {
	const [ text, setText ] = useState( '' );
	const [ busy, setBusy ] = useState( false );

	async function act( action: () => Promise<unknown> ) {
		setBusy( true );

		try {
			await action();
			setText( '' );
		} catch ( error ) {
			onError( ( error as Error ).message );
		} finally {
			setBusy( false );
		}
	}

	return (
		<form
			className="reply"
			onSubmit={ ( event ) => {
				event.preventDefault();

				if ( text.trim() ) {
					void act( () => api.reply( run.id, text, apiBase ) );
				}
			} }
		>
			<p className="muted">
				Claude finished a turn. If it asked you something, reply here and the same session carries on. Otherwise, finish the run.
			</p>
			<textarea
				rows={ 3 }
				value={ text }
				placeholder="Your reply"
				onChange={ ( event ) => setText( event.target.value ) }
				onKeyDown={ ( event ) => {
					if ( event.key === 'Enter' && ( event.metaKey || event.ctrlKey ) ) {
						event.currentTarget.form?.requestSubmit();
					}
				} }
			/>
			<div className="actions">
				<button type="button" className="btn" disabled={ busy } onClick={ () => act( () => api.finish( run.id, apiBase ) ) }>
					{ sequenceNext ? `Finish and go on to ${ sequenceNext }` : 'Finish run' }
				</button>
				<button type="submit" className="btn btn-primary" disabled={ busy || ! text.trim() }>
					Send reply
				</button>
			</div>
		</form>
	);
}

export function RunPanel( {
	apiBase = RUNS,
	run,
	stageTitle,
	root,
	resumeBlocked,
	isLatest,
	onOpenFile,
	onResumed,
	onShowLatest,
	sequenceNext = null,
}: {
	/** Where this run's routes are: release runs, or Agent sessions (/api/chat). */
	apiBase?: string;
	run: RunSnapshot;
	stageTitle: string;
	root: string;
	/** Why Resume is unavailable (another run is active), or null. */
	resumeBlocked: string | null;
	/** False when viewing an older run from the history. */
	isLatest: boolean;
	onOpenFile: ( path: string ) => void;
	onResumed: ( run: RunSnapshot ) => void;
	onShowLatest: () => void;
	sequenceNext?: string | null;
} ) {
	const [ error, setError ] = useState<string | null>( null );
	const active = isActive( run );
	const now = useNow( active );
	const scroller = useRef<HTMLDivElement>( null );
	const pinned = useRef( true );

	useLayoutEffect( () => {
		const element = scroller.current;

		if ( element && pinned.current ) {
			element.scrollTop = element.scrollHeight;
		}
	}, [ run.items.length, run.gates.length, run.status ] );

	const elapsed = ( run.endedAt ?? now ) - run.startedAt;
	const resumeCommand = run.sessionId ? `claude --resume ${ run.sessionId }` : '';
	const resumable = ! active && Boolean( run.sessionId );
	const files = run.files.map( ( file ) => ( file.startsWith( root + '/' ) ? file.slice( root.length + 1 ) : file ) );

	const handle = ( action: () => Promise<unknown> ) => async () => {
		setError( null );

		try {
			await action();
		} catch ( caught ) {
			setError( ( caught as Error ).message );
		}
	};

	return (
		<section className="run" aria-label="Current run">
			<header className="run-head">
				<div>
					<h2>
						<span className="stage-icon">
							<StageIcon id={ run.stageId } size={ 15 } />
						</span>
						{ stageTitle }
						{ run.resumedFrom && <span className="chip">resumed</span> }
					</h2>
					<code>{ run.prompt }</code>
					{ ! isLatest && (
						<p className="small-text muted history-note">
							An earlier run.{ ' ' }
							<button type="button" className="link" onClick={ onShowLatest }>
								Show the latest
							</button>
						</p>
					) }
				</div>
				<div className="run-meta">
					<span className={ `status status-${ run.status }` }>{ STATUS_LABELS[ run.status ] }</span>
					<span className="muted">
						{ formatDuration( elapsed ) }
						{ run.costUsd !== null && ` · ${ formatCost( run.costUsd ) }` }
					</span>
					{ active && (
						<button type="button" className="btn btn-sm btn-danger-ghost" onClick={ handle( () => api.stop( run.id, apiBase ) ) }>
							Stop
						</button>
					) }
				</div>
			</header>

			<div
				className="run-body"
				ref={ scroller }
				onScroll={ ( event ) => {
					const element = event.currentTarget;
					pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
				} }
			>
				<Transcript items={ run.items } />
				{ run.status === 'error' && <div className="entry turn-end is-error">The run failed: { run.error }</div> }
				{ run.status === 'stopped' && <div className="entry system">You stopped the run.</div> }
				{ run.status === 'interrupted' && (
					<div className="entry turn-end is-error">The console stopped while this run was in progress.</div>
				) }
			</div>

			<footer className="run-foot">
				{ error && <p className="error-text" role="alert">{ error }</p> }

				{ run.outcome && run.gates.length === 0 && <OutcomeCard outcome={ run.outcome } root={ root } onOpenFile={ onOpenFile } /> }

				{ run.gates.map( ( gate ) => (
					<GateCard
						key={ gate.id }
						gate={ gate }
						onAnswer={ ( answers ) => handle( () => api.answerQuestion( run.id, gate.id, answers, apiBase ) )() }
						onDecide={ ( allow, message, confirm ) =>
							handle( () => api.answerApproval( run.id, gate.id, allow, message || undefined, confirm || undefined, apiBase ) )()
						}
					/>
				) ) }

				{ run.status === 'awaiting_reply' && run.gates.length === 0 && <ReplyBox run={ run } sequenceNext={ sequenceNext } onError={ setError } apiBase={ apiBase } /> }

				{ resumable && <ResumeBox run={ run } blocked={ resumeBlocked } onResumed={ onResumed } onError={ setError } apiBase={ apiBase } /> }

				{ ( files.length > 0 || resumeCommand ) && (
					<details className="run-details">
						<summary>
							{ files.length } file{ files.length === 1 ? '' : 's' } written{ resumeCommand && ' · session' }
						</summary>
						{ files.length > 0 && (
							<ul className="files">
								{ files.map( ( file ) => (
									<li key={ file }>
										{ file.startsWith( '/' ) ? (
											<code>{ file }</code>
										) : (
											<button type="button" className="link" onClick={ () => onOpenFile( file ) }>
												<code>{ file }</code>
											</button>
										) }
									</li>
								) ) }
							</ul>
						) }
						{ resumeCommand && (
							<p className="resume">
								Continue this session in a terminal: <code>{ resumeCommand }</code>{ ' ' }
								<CopyButton text={ resumeCommand } label="Copy" />
							</p>
						) }
					</details>
				) }
			</footer>
		</section>
	);
}
