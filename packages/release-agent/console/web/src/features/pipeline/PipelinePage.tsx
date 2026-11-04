import { AlertTriangle, ArrowRight, Loader2, Play, Workflow } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '../../components/EmptyState.tsx';
import { StageIcon } from '../../components/icons.tsx';
import type { RunSnapshot, StageGroup, StageReview, StageState } from '../../lib/api.ts';
import { api } from '../../lib/api.ts';
import { isActive } from '../../lib/runState.ts';
import type { ConsoleModel } from '../../app/useConsole.ts';
import { RunPanel } from '../run/RunPanel.tsx';
import { SequenceBanner } from './Sequence.tsx';
import { StageRow, stageResult, type LiveState } from './StageRow.tsx';

const EXPANDED_KEY = 'release-console:expanded-stage';

function loadExpanded(): string | null {
	try {
		return localStorage.getItem( EXPANDED_KEY );
	} catch {
		return null;
	}
}

/**
 * The stage whose run the right side shows: the one picked in the list, else
 * the live run's stage, else the first stage that is not done yet.
 */
export function pickFocusedStage( stages: StageState[], requested: string | null, latest: RunSnapshot | null ): string | null {
	if ( requested && stages.some( ( stage ) => stage.id === requested ) ) {
		return requested;
	}

	if ( latest && stages.some( ( stage ) => stage.id === latest.stageId ) ) {
		return latest.stageId;
	}

	return ( stages.find( ( stage ) => stage.status !== 'done' ) ?? stages[ 0 ] )?.id ?? null;
}

/**
 * The run to show for a stage: the live run when it belongs to that stage
 * (it is the newest, and the history list may not have caught up), else the
 * stage's most recent run from the history.
 */
export function runIdForStage( stageId: string | null, latest: RunSnapshot | null, runs: { id: string; stageId: string }[] ): string | null {
	if ( ! stageId ) {
		return null;
	}

	if ( latest?.stageId === stageId ) {
		return latest.id;
	}

	return runs.find( ( run ) => run.stageId === stageId )?.id ?? null;
}

/** Shown on the right for a stage that has not run for this version yet. */
function StageNotRun( {
	stage,
	version,
	disabledReason,
	onRun,
}: {
	stage: StageState;
	version: string;
	disabledReason: string | null;
	onRun: () => void;
} ) {
	return (
		<div className="panel panel-fill stage-empty">
			<div className="empty">
				<div className="empty-icon">
					<StageIcon id={ stage.id } size={ 26 } />
				</div>
				<p className="empty-title">{ stage.title }</p>
				<div className="empty-body">
					<p>
						{ stage.status === 'done'
							? `Done for ${ version }. There is no saved run for it here: it ran in a terminal, or before the console kept run history.`
							: `Not run for ${ version } yet.` }
					</p>
					<p className="note">{ stage.summary }</p>
					{ stage.blockedReason && (
						<p className="callout callout-warning">
							<AlertTriangle size={ 14 } />
							<span>{ stage.blockedReason }</span>
						</p>
					) }
					{ stage.irreversible ? (
						<p className="note">This stage is permanent and public. Start it from its row on the left, where you type the version to confirm.</p>
					) : (
						<button type="button" className="btn btn-primary" disabled={ Boolean( disabledReason ) } title={ disabledReason ?? undefined } onClick={ onRun }>
							<Play size={ 13 } />
							Run { stage.title }
						</button>
					) }
				</div>
			</div>
		</div>
	);
}

export function PipelinePage( {
	model,
	focusedStage,
	onFocusStage,
	onReview,
	onOpenFile,
}: {
	model: ConsoleModel;
	/** The stage picked in the list (from the URL), or null for the default. */
	focusedStage: string | null;
	onFocusStage: ( id: string ) => void;
	onReview: ( review: StageReview ) => void;
	onOpenFile: ( path: string ) => void;
} ) {
	const { state, checks, latest, shown, active, needsYou, validVersion } = model;
	// One stage open at a time keeps the list short; the choice is remembered.
	const [ expanded, setExpanded ] = useState<string | null>( loadExpanded );

	const setExpandedStage = ( next: string | null ) => {
		setExpanded( next );

		try {
			localStorage.setItem( EXPANDED_KEY, next ?? '' );
		} catch {
			// Not remembered in private windows.
		}
	};

	const stages = state?.stages ?? [];
	const focused = pickFocusedStage( stages, focusedStage, latest );
	const focusedRunId = runIdForStage( focused, latest, state?.runs ?? [] );
	const { viewRun } = model;

	// Show the focused stage's run on the right.
	useEffect( () => {
		viewRun( focusedRunId );
	}, [ focusedRunId ] );

	// When a new run starts (by you, or the next stage of Run all), follow it.
	const lastLatest = useRef<string | null | undefined>( undefined );

	useEffect( () => {
		const id = latest?.id ?? null;

		if ( lastLatest.current !== undefined && id && id !== lastLatest.current && isActive( latest ) && latest!.stageId !== focused ) {
			onFocusStage( latest!.stageId );
		}

		lastLatest.current = id;
	}, [ latest?.id ] );

	const sequence = state?.sequence ?? null;
	const sequenceActive = sequence?.status === 'running' || sequence?.status === 'paused';

	if ( ! validVersion || ! state ) {
		return (
			<div className="page page-center">
				<EmptyState icon={ <Workflow size={ 28 } /> } title="Choose a version">
					Enter the version you're releasing in the sidebar to see its stages.
				</EmptyState>
			</div>
		);
	}

	// Done on disk, or reported done by the last run where disk cannot tell.
	const isDoneStage = ( stage: StageState ) => {
		const result = stageResult( stage, state.runs.find( ( item ) => item.stageId === stage.id ) );

		return result === 'done' || result === 'reported';
	};
	const done = stages.filter( isDoneStage ).length;
	const focusedState = stages.find( ( stage ) => stage.id === focused ) ?? null;
	const busyReason =
		latest?.status === 'awaiting_reply'
			? `${ model.stageTitle( latest.stageId ) } is waiting for your reply. Reply, or finish it, first.`
			: latest?.status === 'waiting'
				? `${ model.stageTitle( latest.stageId ) } needs you. Answer it, or stop it, first.`
				: 'Another run is in progress. Finish or stop it first.';
	const disabledFor = ( stage: StageState ) => ( active ? busyReason : stage.status === 'blocked' ? stage.blockedReason : null );
	const liveFor = ( stage: StageState ): LiveState | null => {
		if ( ! active || latest?.stageId !== stage.id ) {
			return null;
		}

		if ( latest.status === 'waiting' ) {
			return { kind: 'needs-you', approval: latest.gates.some( ( gate ) => gate.type === 'approval' ) };
		}

		if ( latest.status === 'awaiting_reply' ) {
			return { kind: 'reply', outcome: latest.outcome?.status === 'blocked' || latest.outcome?.status === 'failed' ? latest.outcome.status : null };
		}

		return { kind: 'running' };
	};
	// Another stage is busy or waiting while you look at this one.
	const elsewhere = latest && latest.stageId !== focused && ( active || needsYou ) ? latest : null;

	async function run( stage: StageState, confirm: string, buildId?: string ) {
		onFocusStage( stage.id );
		await model.startStage( stage, confirm, buildId );
	}

	let detail;

	if ( ! focusedState ) {
		detail = (
			<div className="panel panel-fill">
				<EmptyState icon={ <Workflow size={ 28 } /> } title="Pick a stage" />
			</div>
		);
	} else if ( ! focusedRunId ) {
		detail = (
			<StageNotRun stage={ focusedState } version={ validVersion } disabledReason={ disabledFor( focusedState ) } onRun={ () => void run( focusedState, '' ) } />
		);
	} else if ( shown?.id === focusedRunId ) {
		detail = (
			<RunPanel
				key={ shown.id }
				run={ shown }
				stageTitle={ model.stageTitle( shown.stageId ) }
				root={ state.root }
				isLatest={ true }
				resumeBlocked={ active ? 'Another run is in progress.' : null }
				sequenceNext={
					sequenceActive && sequence && shown.id === sequence.runIds.at( -1 )
						? stages.find( ( stage ) => stage.id === sequence.stages[ sequence.index + 1 ] )?.title ?? null
						: null
				}
				onOpenFile={ onOpenFile }
				onResumed={ model.showRun }
				onShowLatest={ () => model.viewRun( null ) }
			/>
		);
	} else {
		// The run's stream is still connecting.
		detail = (
			<div className="panel panel-fill">
				<Loader2 size={ 20 } className="spin icon-muted" aria-label="Loading the run" />
			</div>
		);
	}

	return (
		<div className="page pipeline">
			<section className="stage-column" aria-label="Release stages">
				<div className="progress-summary">
					<span>
						<strong>{ done }</strong> of { stages.length } stages done
					</span>
					<span className="progress-bar" aria-hidden="true">
						<span style={ { width: `${ ( done / stages.length ) * 100 }%` } } />
					</span>
				</div>

				{ ( Object.keys( state.groups ) as StageGroup[] ).map( ( group ) => {
					const groupStages = stages.filter( ( stage ) => stage.group === group );

					if ( groupStages.length === 0 ) {
						return null;
					}

					const groupDone = groupStages.filter( isDoneStage ).length;

					return (
						<section key={ group } className="group" aria-label={ state.groups[ group ] }>
							<h2 className="group-title">
								<span>{ state.groups[ group ] }</span>
								<span className="group-count">
									{ groupDone }/{ groupStages.length }
								</span>
							</h2>
							<ol className="grouped-list">
								{ groupStages.map( ( stage ) => (
									<StageRow
										key={ stage.id }
										stage={ stage }
										index={ stages.indexOf( stage ) + 1 }
										expanded={ expanded === stage.id }
										focused={ focused === stage.id }
										onToggle={ () => {
											// A click shows the stage on the right and opens or closes its details.
											onFocusStage( stage.id );
											setExpandedStage( expanded === stage.id ? null : stage.id );
										} }
										live={ liveFor( stage ) }
										disabledReason={ disabledFor( stage ) }
										warnings={ ( checks ?? [] ).filter(
											( item ) => ( item.status === 'fail' || item.status === 'warn' ) && item.stages.includes( stage.id )
										) }
										lastRun={ state.runs.find( ( item ) => item.stageId === stage.id ) }
										version={ validVersion }
										allStages={ stages }
										onRun={ ( confirm, buildId ) => void run( stage, confirm, buildId ) }
										onRunAll={ async ( skipDone ) => {
											onFocusStage( stage.id );
											return model.startSequence( stage, skipDone );
										} }
										onReview={ onReview }
										onShowRun={ () => onFocusStage( stage.id ) }
									/>
								) ) }
							</ol>
						</section>
					);
				} ) }
			</section>

			<section className="run-column" aria-label={ focusedState ? `${ focusedState.title } run` : 'Run' }>
				{ elsewhere && (
					<div className={ `live-bar${ needsYou ? ' live-bar-attention' : '' }` } role="status">
						{ needsYou ? <AlertTriangle size={ 14 } /> : <Loader2 size={ 14 } className="spin" /> }
						<span>
							<strong>{ model.stageTitle( elsewhere.stageId ) }</strong>{ ' ' }
							{ elsewhere.status === 'awaiting_reply' ? 'is waiting for your reply' : needsYou ? 'needs you' : 'is running' }
						</span>
						<button type="button" className="btn btn-sm" onClick={ () => onFocusStage( elsewhere.stageId ) }>
							Show it
							<ArrowRight size={ 13 } />
						</button>
					</div>
				) }
				{ sequence && (
					<SequenceBanner
						sequence={ sequence }
						stages={ stages }
						onStop={ () => void model.sequenceAction( api.stopSequence ) }
						onDismiss={ () => void model.sequenceAction( api.dismissSequence ) }
					/>
				) }
				{ detail }
			</section>
		</div>
	);
}
