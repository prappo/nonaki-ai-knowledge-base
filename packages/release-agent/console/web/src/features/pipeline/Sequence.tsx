import { useEffect, useState } from 'react';
import { api, type SequencePlan, type SequenceSnapshot, type StageState } from '../../lib/api.ts';
import { Spinner } from '../../components/Spinner.tsx';

function titleOf( stages: StageState[], id: string ): string {
	return stages.find( ( stage ) => stage.id === id )?.title ?? id;
}

/** Shown under a stage card before "Run all from here" starts: what will run, and where it stops. */
export function RunAllPreview( {
	stage,
	stages,
	version,
	onStart,
	onCancel,
}: {
	stage: StageState;
	stages: StageState[];
	version: string;
	onStart: ( skipDone: boolean ) => Promise<void>;
	onCancel: () => void;
} ) {
	const [ skipDone, setSkipDone ] = useState( true );
	const [ plan, setPlan ] = useState<SequencePlan | null>( null );
	const [ error, setError ] = useState<string | null>( null );
	const [ busy, setBusy ] = useState( false );

	useEffect( () => {
		let cancelled = false;

		api.sequencePlan( version, stage.id, skipDone )
			.then( ( result ) => ! cancelled && ( setPlan( result ), setError( null ) ) )
			.catch( ( caught: Error ) => ! cancelled && setError( caught.message ) );

		return () => {
			cancelled = true;
		};
	}, [ version, stage.id, skipDone ] );

	return (
		<div className="run-all">
			<p className="small-text">
				<strong>Run all from here</strong> runs these stages one after another. It pauses at every question and approval, and wherever a command
				stops early. When a command reports it is done, the next stage starts on its own.
			</p>
			{ error && <p className="error-text small-text">{ error }</p> }
			{ ! plan && ! error && <Spinner label="Working out the stages…" /> }
			{ plan && (
				<>
					<ol className="run-all-list">
						{ plan.stages.map( ( id ) => (
							<li key={ id }>
								{ titleOf( stages, id ) }
								{ plan.blocked[ id ] && (
									<span className="warning-text"> (blocked right now: { plan.blocked[ id ] } An earlier stage may fix that; if not, Run all stops here.)</span>
								) }
							</li>
						) ) }
					</ol>
					{ plan.skipped.length > 0 && (
						<p className="muted small-text">Skipping, already done: { plan.skipped.map( ( id ) => titleOf( stages, id ) ).join( ', ' ) }.</p>
					) }
					{ plan.stopsBefore && (
						<p className="muted small-text">
							Stops before { titleOf( stages, plan.stopsBefore ) }, which is permanent and public. You start that one yourself.
						</p>
					) }
				</>
			) }
			<label className="checkbox small-text">
				<input type="checkbox" checked={ skipDone } onChange={ ( event ) => setSkipDone( event.target.checked ) } />
				Skip stages that are already done
			</label>
			<div className="stage-actions">
				<button type="button"
					className="btn btn-primary"
					disabled={ ! plan || busy }
					onClick={ async () => {
						setBusy( true );

						try {
							await onStart( skipDone );
						} finally {
							setBusy( false );
						}
					} }
				>
					Start { plan ? `${ plan.stages.length } stage${ plan.stages.length === 1 ? '' : 's' }` : '' }
				</button>
				<button type="button" className="btn" onClick={ onCancel }>
					Cancel
				</button>
			</div>
		</div>
	);
}

const STATUS_TEXT: Record<SequenceSnapshot[ 'status' ], string> = {
	running: 'Running',
	paused: 'Paused',
	done: 'Finished',
	stopped: 'Stopped',
};

/** The sequence's progress, above the workspace tabs. */
export function SequenceBanner( {
	sequence,
	stages,
	onStop,
	onDismiss,
}: {
	sequence: SequenceSnapshot;
	stages: StageState[];
	onStop: () => void;
	onDismiss: () => void;
} ) {
	const active = sequence.status === 'running' || sequence.status === 'paused';

	return (
		<section className={ `sequence sequence-${ sequence.status }` } aria-live="polite" aria-label="Run all progress">
			<div className="sequence-head">
				<span className={ `status status-${ sequence.status === 'paused' ? 'waiting' : sequence.status === 'stopped' ? 'stopped' : sequence.status === 'done' ? 'done' : 'running' }` }>
					{ STATUS_TEXT[ sequence.status ] }
				</span>
				<span className="sequence-title">
					Run all: stage { Math.min( sequence.index + 1, sequence.stages.length ) } of { sequence.stages.length }
				</span>
				<span className="sequence-actions">
					{ active ? (
						<button type="button" className="btn btn-sm" onClick={ onStop }>
							Stop after this stage
						</button>
					) : (
						<button type="button" className="btn btn-sm" onClick={ onDismiss }>
							Dismiss
						</button>
					) }
				</span>
			</div>
			<ol className="sequence-steps">
				{ sequence.stages.map( ( id, index ) => (
					<li
						key={ id }
						className={
							index < sequence.index || ( index === sequence.index && sequence.status === 'done' )
								? 'is-done'
								: index === sequence.index
									? 'is-current'
									: ''
						}
					>
						{ titleOf( stages, id ) }
					</li>
				) ) }
			</ol>
			{ sequence.reason && <p className="small-text">{ sequence.reason }</p> }
		</section>
	);
}
