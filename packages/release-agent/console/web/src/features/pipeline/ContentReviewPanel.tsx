import { AlertTriangle, CheckCircle2, FileText, Info, Loader2, OctagonAlert, RefreshCw, RotateCcw, Wand2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, type ContentReviewState, type Finding, type RunSnapshot } from '../../lib/api.ts';
import { relativeTime } from '../../lib/format.ts';

type Level = Finding[ 'level' ];
type ShownFinding = ContentReviewState[ 'findings' ][ number ];

const LEVEL_TEXT: Record<Level, string> = { blocker: 'Blocker', warning: 'Warning', note: 'Note' };
const LEVEL_ICON: Record<Level, typeof AlertTriangle> = { blocker: OctagonAlert, warning: AlertTriangle, note: Info };

function Counts( { counts }: { counts: { blocker: number; warning: number; note: number } } ) {
	const parts = ( [ 'blocker', 'warning', 'note' ] as Level[] ).filter( ( level ) => counts[ level ] > 0 );

	if ( ! parts.length ) {
		return <span className="cr-count cr-count-ok">OK</span>;
	}

	return (
		<>
			{ parts.map( ( level ) => (
				<span key={ level } className={ `cr-count cr-count-${ level }` } title={ `${ counts[ level ] } ${ LEVEL_TEXT[ level ].toLowerCase() }${ counts[ level ] === 1 ? '' : 's' }` }>
					{ counts[ level ] }
				</span>
			) ) }
		</>
	);
}

function countsOf( findings: ShownFinding[] ) {
	const open = findings.filter( ( item ) => ! item.dismissed );

	return {
		blocker: open.filter( ( item ) => item.level === 'blocker' ).length,
		warning: open.filter( ( item ) => item.level === 'warning' ).length,
		note: open.filter( ( item ) => item.level === 'note' ).length,
	};
}

function FindingRow( {
	item,
	fileLabel,
	filePath,
	busy,
	onOpenFile,
	onDismiss,
	onUndismiss,
}: {
	item: ShownFinding;
	fileLabel: string | null;
	filePath: string | null;
	busy: boolean;
	onOpenFile: ( path: string ) => void;
	onDismiss: ( reason: string ) => Promise<boolean>;
	onUndismiss: () => void;
} ) {
	const [ dismissing, setDismissing ] = useState( false );
	const [ reason, setReason ] = useState( '' );
	const Icon = LEVEL_ICON[ item.level ];

	return (
		<li className={ `cr-finding cr-finding-${ item.level }${ item.dismissed ? ' is-dismissed' : '' }` }>
			<div className="cr-finding-head">
				<Icon size={ 13 } aria-hidden="true" />
				<span className="cr-finding-level">{ LEVEL_TEXT[ item.level ] }</span>
				<span className="cr-finding-label">{ item.label }</span>
				{ fileLabel && <span className="cr-finding-file">{ fileLabel }</span> }
				<span className="cr-finding-source">{ item.source === 'reviewer' ? 'Reviewer' : 'Check' }</span>
			</div>
			<p className="cr-finding-message">{ item.message }</p>
			{ item.quote && (
				<blockquote className="cr-quote">
					{ item.quote }
					{ item.quoteFound === false && <span className="cr-quote-missing"> (this exact text isn't in the file; the reviewer may have paraphrased it)</span> }
				</blockquote>
			) }
			{ item.fix && (
				<p className="cr-fix">
					<strong>Fix:</strong> { item.fix }
				</p>
			) }
			{ item.dismissed && (
				<p className="cr-dismissed">
					Dismissed { relativeTime( item.dismissed.at ) }: { item.dismissed.reason }
				</p>
			) }

			{ dismissing ? (
				<form
					className="cr-dismiss-form"
					onSubmit={ async ( event ) => {
						event.preventDefault();

						if ( await onDismiss( reason ) ) {
							setDismissing( false );
							setReason( '' );
						}
					} }
				>
					<input type="text" autoFocus placeholder="Why is this fine as it is?" value={ reason } onChange={ ( event ) => setReason( event.target.value ) } aria-label="Reason" />
					<button type="submit" className="btn btn-sm" disabled={ busy || ! reason.trim() }>
						Dismiss
					</button>
					<button type="button" className="btn btn-sm btn-ghost" onClick={ () => setDismissing( false ) }>
						Cancel
					</button>
				</form>
			) : (
				<div className="cr-actions">
					{ filePath && (
						<button type="button" className="btn btn-sm btn-ghost" onClick={ () => onOpenFile( filePath ) }>
							<FileText size={ 12 } />
							Open file
						</button>
					) }
					{ item.level !== 'blocker' &&
						( item.dismissed ? (
							<button type="button" className="btn btn-sm btn-ghost" disabled={ busy } onClick={ onUndismiss }>
								<RotateCcw size={ 12 } />
								Undo dismiss
							</button>
						) : (
							<button type="button" className="btn btn-sm btn-ghost" disabled={ busy } onClick={ () => setDismissing( true ) }>
								<X size={ 12 } />
								Dismiss…
							</button>
						) ) }
				</div>
			) }
		</li>
	);
}

/**
 * The content review's findings on its stage card: a scorecard per piece,
 * then every finding, with dismiss, open file and Fix with agent.
 */
export function ContentReviewPanel( {
	version,
	refreshKey,
	running,
	onOpenFile,
	onFixStarted,
	onChanged,
}: {
	version: string;
	/** Changes when something the review depends on may have changed (a run ended). */
	refreshKey: string;
	/** A run is going on, so starting the fixer would be refused. */
	running: boolean;
	onOpenFile: ( path: string ) => void;
	onFixStarted: ( run: RunSnapshot ) => void;
	/** A dismissal or re-check may change whether stages are blocked. */
	onChanged: () => void;
} ) {
	const [ review, setReview ] = useState<ContentReviewState | null>( null );
	const [ error, setError ] = useState<string | null>( null );
	const [ busy, setBusy ] = useState( false );
	const [ fileFilter, setFileFilter ] = useState<string | null>( null );
	const [ showDismissed, setShowDismissed ] = useState( false );

	const load = useCallback( async () => {
		if ( ! version ) {
			return;
		}

		try {
			setReview( ( await api.contentReview( version ) ).review );
			setError( null );
		} catch ( caught ) {
			setError( ( caught as Error ).message );
		}
	}, [ version ] );

	useEffect( () => {
		void load();
	}, [ load, refreshKey ] );

	// Keep up while link checks or the reviewer are still going.
	const pending = review?.checks.links === 'pending' || review?.reviewer.status === 'running';

	useEffect( () => {
		if ( ! pending ) {
			return;
		}

		const timer = setInterval( () => void load(), 3000 );

		return () => clearInterval( timer );
	}, [ pending, load ] );

	async function act( action: () => Promise<{ review: ContentReviewState }> ): Promise<boolean> {
		setBusy( true );

		try {
			setReview( ( await action() ).review );
			setError( null );
			onChanged();
			return true;
		} catch ( caught ) {
			setError( ( caught as Error ).message );
			return false;
		} finally {
			setBusy( false );
		}
	}

	async function fix() {
		setBusy( true );

		try {
			onFixStarted( ( await api.fixContentReview( version ) ).run );
			setError( null );
		} catch ( caught ) {
			setError( ( caught as Error ).message );
		} finally {
			setBusy( false );
		}
	}

	if ( ! review ) {
		return error ? <p className="callout callout-danger">{ error }</p> : <p className="note">Loading the review…</p>;
	}

	const ran = review.checks.ran || review.reviewer.ran;
	const fixable = review.counts.blocker + review.counts.warning > 0 && Boolean( review.fixStage );
	const fileOf = ( id: string | null ) => review.files.find( ( file ) => file.id === id ) ?? null;
	const shown = review.findings.filter( ( item ) => ( fileFilter === null || item.file === fileFilter ) && ( showDismissed || ! item.dismissed ) );
	const hiddenDismissed = review.findings.filter( ( item ) => item.dismissed && ( fileFilter === null || item.file === fileFilter ) ).length;

	return (
		<div className="cr-panel">
			<div className={ `cr-status ${ review.passed ? 'cr-status-passed' : ran ? 'cr-status-open' : '' }` }>
				{ review.passed ? <CheckCircle2 size={ 15 } /> : pending ? <Loader2 size={ 15 } className="spin" /> : <AlertTriangle size={ 15 } /> }
				<div>
					<p className="cr-status-title">{ review.passed ? 'Passed: the content can go out.' : review.reason }</p>
					<p className="cr-status-meta">
						{ review.checks.at ? `Checks ${ relativeTime( review.checks.at ) }${ review.checks.links === 'pending' ? ' (links still checking)' : '' }` : 'Checks not run' }
						{ ' · ' }
						{ review.reviewer.at
							? `Reviewer ${ review.reviewer.status === 'running' ? 'reading since' : '' } ${ relativeTime( review.reviewer.at ) }`
							: 'Reviewer not run' }
						{ review.counts.dismissed > 0 && ` · ${ review.counts.dismissed } dismissed` }
					</p>
				</div>
			</div>

			{ review.reviewer.fresh && review.reviewer.summary && <p className="cr-summary">“{ review.reviewer.summary }”</p> }

			<div className="button-row">
				<button type="button" className="btn btn-sm" disabled={ busy } onClick={ () => void act( () => api.runContentChecks( version ) ) } title="Run the fixed checks again (no AI). The reviewer runs with the stage's Run button.">
					<RefreshCw size={ 12 } />
					Re-run checks
				</button>
				{ fixable && (
					<button
						type="button"
						className="btn btn-sm btn-primary-soft"
						disabled={ busy || running }
						title={ running ? 'Wait for the current run to finish.' : 'Start a Write marketing content session that fixes the open blockers and warnings.' }
						onClick={ () => void fix() }
					>
						<Wand2 size={ 12 } />
						Fix with agent
					</button>
				) }
			</div>

			{ error && <p className="callout callout-danger">{ error }</p> }

			<ul className="cr-files" aria-label="Pieces">
				<li>
					<button type="button" className={ `cr-file${ fileFilter === null ? ' is-selected' : '' }` } onClick={ () => setFileFilter( null ) }>
						<span className="cr-file-label">All</span>
						<span className="cr-file-counts">
							<Counts counts={ review.counts } />
						</span>
					</button>
				</li>
				{ review.files.map( ( file ) => (
					<li key={ file.id }>
						<button
							type="button"
							className={ `cr-file${ fileFilter === file.id ? ' is-selected' : '' }${ file.exists ? '' : ' is-missing' }` }
							onClick={ () => setFileFilter( fileFilter === file.id ? null : file.id ) }
							title={ file.path }
						>
							<span className="cr-file-label">{ file.label }</span>
							<span className="cr-file-counts">
								{ file.exists ? ran ? <Counts counts={ countsOf( review.findings.filter( ( item ) => item.file === file.id ) ) } /> : null : <span className="cr-count cr-count-blocker">missing</span> }
							</span>
						</button>
					</li>
				) ) }
			</ul>

			{ ran && shown.length === 0 && <p className="note">{ fileFilter ? 'Nothing found in this piece.' : 'Nothing found.' }</p> }

			{ shown.length > 0 && (
				<ol className="cr-findings">
					{ shown.map( ( item ) => (
						<FindingRow
							key={ item.id }
							item={ item }
							fileLabel={ fileOf( item.file )?.label ?? null }
							filePath={ fileOf( item.file )?.path ?? null }
							busy={ busy }
							onOpenFile={ onOpenFile }
							onDismiss={ ( reason ) => act( () => api.dismissFinding( version, item.id, reason ) ) }
							onUndismiss={ () => void act( () => api.undismissFinding( version, item.id ) ) }
						/>
					) ) }
				</ol>
			) }

			{ hiddenDismissed > 0 && (
				<button type="button" className="link cr-toggle-dismissed" onClick={ () => setShowDismissed( ! showDismissed ) }>
					{ showDismissed ? 'Hide' : 'Show' } { hiddenDismissed } dismissed
				</button>
			) }
		</div>
	);
}
