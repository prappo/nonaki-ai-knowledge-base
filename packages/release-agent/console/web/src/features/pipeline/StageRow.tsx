import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, Eye, Globe, ListOrdered, Play, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../components/Badge.tsx';
import { CopyButton } from '../../components/CopyButton.tsx';
import { ProgressIcon, StageIcon, type ProgressState } from '../../components/icons.tsx';
import type { HealthCheck, RunSummary, StageReview, StageState } from '../../lib/api.ts';
import { safeExternalUrl } from '../../lib/url.ts';
import { ConfirmField } from '../run/GateCard.tsx';
import { BuildSource, selectedLocalBuild, type BuildSourceValue } from './BuildSource.tsx';
import { RunAllPreview } from './Sequence.tsx';

const OUTCOME_TEXT: Record<'ok' | 'blocked' | 'failed', string> = {
	ok: 'completed',
	blocked: 'stopped early',
	failed: 'failed',
};

/**
 * What this stage's live run is doing: working, stopped on a question or an
 * approval, or finished a turn and waiting for a reply. Null when it has no
 * live run.
 */
export type LiveState = { kind: 'running' } | { kind: 'needs-you'; approval: boolean } | { kind: 'reply'; outcome: 'blocked' | 'failed' | null };

/**
 * What a stage achieved, from the files on disk and its last run's report:
 * - done: the files show it is done.
 * - reported: disk cannot tell (Docs, Blog draft, Notifications), but its
 *   last run for this version reported Completed.
 * - partial: its last run reported Completed, yet some of its files are
 *   missing (for example Marketing without the featured image).
 */
export type StageResult = 'done' | 'reported' | 'partial' | null;

export function stageResult( stage: StageState, lastRun: RunSummary | undefined ): StageResult {
	if ( stage.status === 'done' ) {
		return 'done';
	}

	if ( lastRun?.outcome?.status !== 'ok' ) {
		return null;
	}

	if ( ! stage.tracked ) {
		return 'reported';
	}

	return stage.missing.length > 0 ? 'partial' : null;
}

export function stageProgress( stage: StageState, live: LiveState | null, result: StageResult = null ): ProgressState {
	if ( live?.kind === 'running' ) {
		return 'running';
	}

	if ( live?.kind === 'needs-you' ) {
		return 'attention';
	}

	if ( live?.kind === 'reply' ) {
		return 'reply';
	}

	if ( stage.status === 'done' || result === 'done' || result === 'reported' ) {
		return 'done';
	}

	if ( result === 'partial' ) {
		return 'partial';
	}

	return stage.status === 'blocked' ? 'blocked' : 'pending';
}

/** The short line under a stage's title: what state it is in, in a few words. */
function statusLine( stage: StageState, live: LiveState | null, lastRun: RunSummary | undefined ): string {
	if ( live?.kind === 'running' ) {
		return 'Running now';
	}

	if ( live?.kind === 'needs-you' ) {
		return live.approval ? 'Needs your approval' : 'Needs your answer';
	}

	if ( live?.kind === 'reply' ) {
		return live.outcome === 'blocked' ? 'Stopped early · reply or finish' : live.outcome === 'failed' ? 'Failed · reply or finish' : 'Waiting for your reply';
	}

	if ( stage.status === 'done' ) {
		return stage.remote?.rerunWarning ? 'Done · already on GitHub' : 'Done';
	}

	const result = stageResult( stage, lastRun );

	if ( result === 'reported' ) {
		return 'Done, reported by its last run';
	}

	if ( result === 'partial' ) {
		return `Almost done: ${ stage.missing.join( ', ' ) } missing`;
	}

	if ( stage.status === 'blocked' ) {
		return stage.blockedReason?.split( '. ' )[ 0 ] ?? 'Blocked';
	}

	if ( lastRun?.outcome ) {
		return `Last run ${ OUTCOME_TEXT[ lastRun.outcome.status ] }`;
	}

	return stage.tracked ? 'Not run yet' : 'Not tracked on disk';
}

export function StageRow( {
	stage,
	index,
	expanded,
	focused = false,
	onToggle,
	live,
	disabledReason,
	warnings,
	lastRun,
	version,
	allStages,
	onRun,
	onRunAll,
	onReview,
	onShowRun,
}: {
	stage: StageState;
	index: number;
	expanded: boolean;
	/** Its run is the one shown on the right. */
	focused?: boolean;
	onToggle: () => void;
	/** This stage's live run, if it has one. */
	live: LiveState | null;
	disabledReason: string | null;
	warnings: HealthCheck[];
	lastRun: RunSummary | undefined;
	version: string;
	allStages: StageState[];
	/** `buildId` runs the stage against a local build. */
	onRun: ( confirm: string, buildId?: string ) => void;
	onRunAll: ( skipDone: boolean ) => Promise<boolean>;
	onReview: ( review: StageReview ) => void;
	onShowRun: ( id: string ) => void;
} ) {
	const [ confirming, setConfirming ] = useState( false );
	// Asked "run this again?" for a stage a remote already shows as done.
	const [ askingRerun, setAskingRerun ] = useState( false );
	const [ confirm, setConfirm ] = useState( '' );
	const [ planning, setPlanning ] = useState( false );
	const [ source, setSource ] = useState<BuildSourceValue>( { kind: 'ci' } );
	const localBuild = stage.localBuild ? selectedLocalBuild( stage, source ) : null;
	// Local build picked, but there is none to run against.
	const noLocalBuild = stage.localBuild && source.kind === 'local' && ! localBuild;
	const prompt = localBuild?.prompt ?? stage.prompt;
	const canReview = stage.review && ( stage.status === 'done' || ! stage.tracked );
	const terminalCommand = `claude${ stage.browser ? ' --chrome' : '' } "${ prompt }"`;
	const failing = warnings.some( ( item ) => item.status === 'fail' );
	const result = stageResult( stage, lastRun );
	const rerunWarning = stage.status === 'done' ? stage.remote?.rerunWarning ?? null : null;

	function run() {
		if ( rerunWarning && ! askingRerun && ! confirming ) {
			setAskingRerun( true );

			if ( ! expanded ) {
				onToggle();
			}

			return;
		}

		setAskingRerun( false );

		if ( stage.irreversible && ! confirming ) {
			setConfirming( true );

			if ( ! expanded ) {
				onToggle();
			}

			return;
		}

		onRun( confirm, localBuild?.id );
		setConfirming( false );
		setConfirm( '' );
	}

	return (
		<li className={ `stage${ expanded ? ' is-expanded' : '' }${ focused ? ' is-focused' : '' }${ live?.kind === 'running' ? ' is-running' : live ? ' is-attention' : '' } stage-${ stage.status }${ result === 'reported' ? ' stage-done' : result === 'partial' ? ' stage-partial' : '' }` }>
			<div className="stage-row">
				<button type="button" className="stage-toggle" aria-expanded={ expanded } aria-current={ focused ? 'true' : undefined } onClick={ onToggle }>
					<ProgressIcon state={ stageProgress( stage, live, result ) } />
					<span className="stage-icon">
						<StageIcon id={ stage.id } size={ 15 } />
					</span>
					<span className="stage-text">
						<span className="stage-title">
							<span className="stage-index">{ index }.</span> { stage.title }
							{ stage.irreversible && <ShieldAlert size={ 13 } className="icon-danger" aria-label="Permanent and public" /> }
							{ stage.browser && <Globe size={ 13 } className="icon-muted" aria-label="Uses Chrome" /> }
							{ warnings.length > 0 && (
								<AlertTriangle size={ 13 } className={ failing ? 'icon-danger' : 'icon-warning' } aria-label={ `${ warnings.length } setup problem(s)` } />
							) }
						</span>
						<span className="stage-status">{ statusLine( stage, live, lastRun ) }</span>
					</span>
					<span className="stage-chevron">{ expanded ? <ChevronDown size={ 15 } /> : <ChevronRight size={ 15 } /> }</span>
				</button>
				<button
					type="button"
					className={ `btn btn-icon btn-sm ${ stage.irreversible ? 'btn-danger-ghost' : stage.status === 'done' ? 'btn-ghost' : 'btn-primary-soft' }` }
					disabled={ Boolean( disabledReason ) || noLocalBuild }
					title={
						disabledReason ??
						( noLocalBuild
							? 'Build the plugin on the Builds page first.'
							: `Run ${ stage.title }${ stage.status === 'done' ? ' again' : '' }${ localBuild ? ' against the local build' : '' }` )
					}
					aria-label={ `Run ${ stage.title }` }
					onClick={ run }
				>
					<Play size={ 14 } />
				</button>
			</div>

			{ expanded && (
				<div className="stage-details">
					<p className="stage-summary">{ stage.summary }</p>
					<div className="stage-command">
						<code>{ prompt }</code>
						<CopyButton text={ terminalCommand } label="Copy for terminal" />
					</div>

					{ stage.localBuild && <BuildSource stage={ stage } version={ version } value={ source } onChange={ setSource } /> }

					{ ( stage.irreversible || stage.browser ) && (
						<div className="stage-badges">
							{ stage.irreversible && (
								<Badge tone="danger" icon={ <ShieldAlert size={ 12 } /> }>
									Permanent and public
								</Badge>
							) }
							{ stage.browser && (
								<Badge tone="info" icon={ <Globe size={ 12 } /> }>
									Uses your Chrome
								</Badge>
							) }
						</div>
					) }

					{ stage.gates.length > 0 && (
						<div className="stage-asks">
							<span className="field-label">Asks you</span>
							<ul>
								{ stage.gates.map( ( gate ) => (
									<li key={ gate }>{ gate }</li>
								) ) }
							</ul>
						</div>
					) }

					{ stage.browser && <p className="note">Claude drives your open Chrome window. Keep it open and logged in.</p> }
					{ ! stage.tracked &&
						( result === 'reported' ? (
							<p className="note">Shown as done because its last run for this version reported Completed. The console can't check this stage on disk.</p>
						) : (
							<p className="note">The console can't tell from disk whether this stage has run.</p>
						) ) }

					{ result === 'partial' && (
						<div className="callout callout-warning callout-block">
							<AlertTriangle size={ 14 } />
							<div>
								<p>
									The last run reported Completed, but { stage.missing.length === 1 ? 'this file is' : 'these files are' } missing:{ ' ' }
									{ stage.missing.map( ( file, index ) => (
										<span key={ file }>
											{ index > 0 && ', ' }
											<code>{ file }</code>
										</span>
									) ) }
									.
								</p>
								{ lastRun?.outcome?.followups.length ? (
									<>
										<p className="callout-heading">What the run says is left to do</p>
										<ul>
											{ lastRun.outcome.followups.map( ( item ) => (
												<li key={ item }>{ item }</li>
											) ) }
										</ul>
									</>
								) : null }
							</div>
						</div>
					) }

					{ warnings.map( ( item ) => (
						<p key={ item.id } className={ `callout ${ item.status === 'fail' ? 'callout-danger' : 'callout-warning' }` }>
							<AlertTriangle size={ 14 } />
							<span>
								<strong>{ item.label }:</strong> { item.detail }
							</span>
						</p>
					) ) }

					{ stage.remote && (
						<p className={ `callout ${ stage.remote.tone === 'success' ? 'callout-success' : 'callout-warning' }` }>
							{ stage.remote.tone === 'success' ? <CheckCircle2 size={ 14 } /> : <AlertTriangle size={ 14 } /> }
							<span>
								{ stage.remote.text }
								{ safeExternalUrl( stage.remote.url ) && (
									<>
										{ ' ' }
										<a className="link" href={ safeExternalUrl( stage.remote.url ) ?? undefined } target="_blank" rel="noreferrer">
											View on GitHub <ExternalLink size={ 11 } aria-hidden="true" />
										</a>
									</>
								) }
							</span>
						</p>
					) }

					{ stage.blockedReason && (
						<p className="callout callout-warning">
							<AlertTriangle size={ 14 } />
							<span>{ stage.blockedReason }</span>
						</p>
					) }

					{ lastRun?.outcome && (
						<p className="note">
							<button type="button" className="link" onClick={ () => onShowRun( lastRun.id ) }>
								Last run
							</button>{ ' ' }
							{ OUTCOME_TEXT[ lastRun.outcome.status ] }
							{ lastRun.outcome.summary && `: ${ lastRun.outcome.summary }` }
						</p>
					) }

					{ askingRerun && rerunWarning && (
						<div className="callout callout-warning callout-block">
							<AlertTriangle size={ 14 } />
							<div>
								<p className="callout-heading">Run this step again?</p>
								<p>{ rerunWarning }</p>
								<div className="button-row">
									<button type="button" className="btn btn-sm" onClick={ run }>
										Run again anyway
									</button>
									<button type="button" className="btn btn-sm btn-ghost" onClick={ () => setAskingRerun( false ) }>
										Cancel
									</button>
								</div>
							</div>
						</div>
					) }

					{ confirming && <ConfirmField phrase={ version } value={ confirm } onChange={ setConfirm } action={ `start ${ stage.title }` } /> }

					<div className="button-row">
						<button
							type="button"
							className={ `btn btn-sm ${ stage.irreversible ? 'btn-danger' : 'btn-primary' }` }
							disabled={ Boolean( disabledReason ) || noLocalBuild || askingRerun || ( confirming && confirm.trim() !== version ) }
							title={ disabledReason ?? ( noLocalBuild ? 'Build the plugin on the Builds page first.' : undefined ) }
							onClick={ run }
						>
							<Play size={ 13 } />
							{ confirming ? `Start ${ stage.title }` : stage.status === 'done' ? 'Run again' : 'Run' }
						</button>
						{ confirming && (
							<button
								type="button"
								className="btn btn-sm"
								onClick={ () => {
									setConfirming( false );
									setConfirm( '' );
								} }
							>
								Cancel
							</button>
						) }
						{ ! stage.irreversible && ! confirming && (
							<button
								type="button"
								className="btn btn-sm"
								disabled={ Boolean( disabledReason ) }
								onClick={ () => setPlanning( ! planning ) }
								aria-expanded={ planning }
							>
								<ListOrdered size={ 13 } />
								Run all from here
							</button>
						) }
						{ canReview && stage.review && (
							<button type="button" className="btn btn-sm btn-ghost" onClick={ () => onReview( stage.review! ) }>
								<Eye size={ 13 } />
								{ stage.review.label }
							</button>
						) }
					</div>

					{ planning && ! disabledReason && (
						<RunAllPreview
							stage={ stage }
							stages={ allStages }
							version={ version }
							onCancel={ () => setPlanning( false ) }
							onStart={ async ( skipDone ) => {
								if ( await onRunAll( skipDone ) ) {
									setPlanning( false );
								}
							} }
						/>
					) }
				</div>
			) }
		</li>
	);
}
