import { History } from 'lucide-react';
import { Badge, type Tone } from '../../components/Badge.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { StageIcon } from '../../components/icons.tsx';
import type { RunSummary } from '../../lib/api.ts';
import { formatCost, formatDuration, relativeTime } from '../../lib/format.ts';
import type { ConsoleModel } from '../../app/useConsole.ts';
import { RunPanel } from '../run/RunPanel.tsx';
import { Spinner } from '../../components/Spinner.tsx';

const STATUS: Record<RunSummary[ 'status' ], { label: string; tone: Tone }> = {
	running: { label: 'Running', tone: 'accent' },
	waiting: { label: 'Needs you', tone: 'warning' },
	awaiting_reply: { label: 'Waiting', tone: 'warning' },
	done: { label: 'Finished', tone: 'success' },
	stopped: { label: 'Stopped', tone: 'neutral' },
	error: { label: 'Failed', tone: 'danger' },
	interrupted: { label: 'Interrupted', tone: 'warning' },
};

const OUTCOME: Record<'ok' | 'blocked' | 'failed', { label: string; tone: Tone }> = {
	ok: { label: 'Completed', tone: 'success' },
	blocked: { label: 'Stopped early', tone: 'warning' },
	failed: { label: 'Failed', tone: 'danger' },
};

export function HistoryPage( { model, onOpenFile }: { model: ConsoleModel; onOpenFile: ( path: string ) => void } ) {
	const { state, shown, latest, active } = model;
	const runs = state?.runs ?? [];
	const total = runs.reduce( ( sum, run ) => sum + ( run.costUsd ?? 0 ), 0 );

	if ( ! model.validVersion ) {
		return (
			<div className="page page-center">
				<EmptyState icon={ <History size={ 28 } /> } title="Choose a version">
					Enter a version in the sidebar to see its runs.
				</EmptyState>
			</div>
		);
	}

	if ( ! state && ! model.error ) {
		return (
			<div className="page page-center">
				<Spinner block label="Loading runs…" />
			</div>
		);
	}

	return (
		<div className="page history">
			<section className="history-list" aria-label="Runs">
				<h2 className="group-title">
					<span>Runs for { model.validVersion }</span>
					<span className="group-count">
						{ runs.length } · { formatCost( total ) || '$0' }
					</span>
				</h2>
				{ runs.length === 0 && (
					<EmptyState icon={ <History size={ 24 } /> } title="No runs yet">
						Runs you start from the Pipeline appear here.
					</EmptyState>
				) }
				<ul className="grouped-list">
					{ runs.map( ( run ) => {
						const badge = run.outcome ? OUTCOME[ run.outcome.status ] : STATUS[ run.status ];

						return (
							<li key={ run.id }>
								<button
									type="button"
									className={ `list-row${ shown?.id === run.id ? ' is-selected' : '' }` }
									onClick={ () => model.viewRun( run.id ) }
								>
									<span className="row-icon">
										<StageIcon id={ run.stageId } size={ 15 } />
									</span>
									<span className="list-row-text">
										<span className="list-row-title">
											{ model.stageTitle( run.stageId ) }
											{ run.resumedFrom && <span className="muted"> · resumed</span> }
										</span>
										<span className="list-row-sub">
											{ relativeTime( run.startedAt ) }
											{ run.endedAt && ` · ${ formatDuration( run.endedAt - run.startedAt ) }` }
											{ run.costUsd !== null && ` · ${ formatCost( run.costUsd ) }` }
										</span>
									</span>
									<Badge tone={ badge.tone }>{ badge.label }</Badge>
								</button>
							</li>
						);
					} ) }
				</ul>
			</section>
			<section className="run-column" aria-label="Run detail">
				{ shown ? (
					<RunPanel
						key={ shown.id }
						run={ shown }
						stageTitle={ model.stageTitle( shown.stageId ) }
						root={ state?.root ?? '' }
						isLatest={ shown.id === latest?.id }
						resumeBlocked={ active ? 'Another run is in progress.' : null }
						onOpenFile={ onOpenFile }
						onResumed={ model.showRun }
						onShowLatest={ () => model.viewRun( null ) }
					/>
				) : (
					<div className="panel panel-fill">
						<EmptyState icon={ <History size={ 28 } /> } title="Pick a run" />
					</div>
				) }
			</section>
		</div>
	);
}
