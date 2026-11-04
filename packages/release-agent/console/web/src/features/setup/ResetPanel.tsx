import { AlertTriangle, ArchiveRestore, Bot, Database, RotateCcw, Trash2, Wrench } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '../../components/Badge.tsx';
import { api, type Backup, type DiscardCandidate, type ResetPlan } from '../../lib/api.ts';
import { formatDateTime, formatSize } from '../../lib/format.ts';

const KIND_LABEL: Record<DiscardCandidate[ 'kind' ], string> = {
	modified: 'Modified',
	added: 'Added',
	deleted: 'Deleted',
	renamed: 'Renamed',
	untracked: 'New file',
	conflicted: 'Conflict',
	other: 'Changed',
};

/** A text field that must match `word` before a destructive button turns on. */
function TypeToConfirm( { word, value, onChange }: { word: string; value: string; onChange: ( value: string ) => void } ) {
	return (
		<label className="confirm-field">
			<span>
				Type <code>{ word }</code> to confirm.
			</span>
			<input value={ value } onChange={ ( event ) => onChange( event.target.value ) } spellCheck={ false } autoComplete="off" aria-label={ `Type ${ word } to confirm` } />
		</label>
	);
}

function BackupList( { backups, busy, onRestore, onDelete }: { backups: Backup[]; busy: boolean; onRestore: ( id: string ) => void; onDelete: ( id: string ) => void } ) {
	if ( backups.length === 0 ) {
		return null;
	}

	return (
		<div className="reset-section">
			<h3 className="reset-subtitle">
				<ArchiveRestore size={ 14 } /> Backups of discarded changes
			</h3>
			<ul className="grouped-list">
				{ backups.map( ( backup ) => (
					<li key={ backup.id } className="list-row">
						<span className="list-row-text">
							<span className="list-row-title">
								{ backup.entries.length } file{ backup.entries.length === 1 ? '' : 's' } · { formatDateTime( backup.createdAt ) }
							</span>
							<span className="list-row-sub">
								{ backup.restoredAt ? `Restored ${ formatDateTime( backup.restoredAt ) }` : backup.entries.slice( 0, 3 ).map( ( entry ) => entry.path ).join( ', ' ) }
								{ ! backup.restoredAt && backup.entries.length > 3 && `, +${ backup.entries.length - 3 } more` }
							</span>
						</span>
						<button type="button" className="btn btn-sm" disabled={ busy } onClick={ () => onRestore( backup.id ) }>
							<RotateCcw size={ 13 } />
							Restore
						</button>
						<button type="button" className="btn btn-icon btn-sm btn-ghost" onClick={ () => onDelete( backup.id ) } aria-label="Delete backup" title="Delete backup">
							<Trash2 size={ 13 } />
						</button>
					</li>
				) ) }
			</ul>
		</div>
	);
}

export function ResetPanel( { onChanged }: { onChanged: () => void } ) {
	const [ plan, setPlan ] = useState<ResetPlan | null>( null );
	const [ selected, setSelected ] = useState<Set<string>>( new Set() );
	const [ discardConfirm, setDiscardConfirm ] = useState( '' );
	const [ dataConfirm, setDataConfirm ] = useState( '' );
	const [ confirming, setConfirming ] = useState<'discard' | 'data' | null>( null );
	const [ message, setMessage ] = useState<{ tone: 'ok' | 'error'; text: string } | null>( null );
	const [ working, setWorking ] = useState( false );

	const load = useCallback( async () => {
		try {
			const next = await api.resetPlan();

			setPlan( next );
			setSelected( new Set( next.changes.filter( ( change ) => change.selected ).map( ( change ) => change.path ) ) );
		} catch ( caught ) {
			setMessage( { tone: 'error', text: ( caught as Error ).message } );
		}
	}, [] );

	useEffect( () => {
		void load();
	}, [ load ] );

	const busy = Boolean( plan?.busy ) || working;
	const changes = plan?.changes ?? [];
	const fromRuns = useMemo( () => changes.filter( ( change ) => change.writtenByRun ).length, [ changes ] );

	async function act( action: () => Promise<string> ) {
		setWorking( true );
		setMessage( null );

		try {
			const text = await action();

			setMessage( { tone: 'ok', text } );
			setConfirming( null );
			setDiscardConfirm( '' );
			setDataConfirm( '' );
			onChanged();
		} catch ( caught ) {
			setMessage( { tone: 'error', text: ( caught as Error ).message } );
		} finally {
			setWorking( false );
			await load();
		}
	}

	const toggle = ( path: string ) =>
		setSelected( ( current ) => {
			const next = new Set( current );

			if ( next.has( path ) ) {
				next.delete( path );
			} else {
				next.add( path );
			}

			return next;
		} );

	return (
		<div className="panel panel-danger">
			<header className="panel-head">
				<div className="panel-title-group">
					<h2 className="panel-title">
						<AlertTriangle size={ 16 } className="icon-danger" /> Reset
					</h2>
					<span className="muted small">Undo what the release commands changed in the repo, or clear the console's own data.</span>
				</div>
			</header>

			<div className="panel-body reset">
				{ plan?.busy && (
					<p className="callout callout-warning">
						<AlertTriangle size={ 14 } />
						<span>{ plan.busy }</span>
					</p>
				) }

				{ message && (
					<p className={ `callout ${ message.tone === 'ok' ? 'callout-success' : 'callout-danger' }` } role="status">
						{ message.text }
					</p>
				) }

				<section className="reset-section">
					<h3 className="reset-subtitle">
						<RotateCcw size={ 14 } /> Discard repo changes
					</h3>
					<p className="note">
						Puts the files you tick back to the last commit: version bumps, changelogs, <code>{ '{next}' }</code> replacements, docs and release
						files. Any edits you made yourself to those files go too. A backup is taken first, so you can restore it below.
					</p>

					{ changes.length === 0 ? (
						<p className="note">There are no uncommitted changes to discard.</p>
					) : (
						<>
							<div className="reset-toolbar">
								<span className="muted small">
									{ selected.size } of { changes.length } selected{ fromRuns > 0 && ` · ${ fromRuns } written by a console run` }
								</span>
								<span className="button-row">
									<button
										type="button"
										className="btn btn-sm btn-ghost"
										title="Files a run wrote, or that live where the release commands write"
										onClick={ () => setSelected( new Set( changes.filter( ( change ) => change.selected ).map( ( change ) => change.path ) ) ) }
									>
										Release changes
									</button>
									<button type="button" className="btn btn-sm btn-ghost" onClick={ () => setSelected( new Set( changes.map( ( change ) => change.path ) ) ) }>
										All
									</button>
									<button type="button" className="btn btn-sm btn-ghost" onClick={ () => setSelected( new Set() ) }>
										None
									</button>
								</span>
							</div>
							<ul className="grouped-list reset-list">
								{ changes.map( ( change ) => (
									<li key={ change.path }>
										<label className="list-row reset-row">
											<input type="checkbox" checked={ selected.has( change.path ) } onChange={ () => toggle( change.path ) } />
											<span className="list-row-text">
												<span className="list-row-title mono">{ change.from ? `${ change.from } → ${ change.path }` : change.path }</span>
											</span>
											{ change.writtenByRun && (
												<Badge tone="info" icon={ <Bot size={ 11 } /> }>
													Run
												</Badge>
											) }
											{ change.consoleSetup && (
												<Badge tone="warning" icon={ <Wrench size={ 11 } /> }>
													Console setup
												</Badge>
											) }
											{ ! change.writtenByRun && ! change.releasePath && ! change.consoleSetup && <Badge>Not from a release</Badge> }
											<span className={ `change-kind change-${ change.kind }` }>{ KIND_LABEL[ change.kind ] }</span>
										</label>
									</li>
								) ) }
							</ul>
							{ [ ...selected ].some( ( path ) => changes.find( ( change ) => change.path === path )?.consoleSetup ) && (
								<p className="callout callout-warning">
									<AlertTriangle size={ 14 } />
									<span>
										Some ticked files hold the Release Console's own setup (its build exclusion, npm script or command fixes). Discarding them removes
										that too; <code>package.json</code> also holds Prep's version bump.
									</span>
								</p>
							) }
							{ confirming === 'discard' && <TypeToConfirm word="discard" value={ discardConfirm } onChange={ setDiscardConfirm } /> }
							<div className="button-row">
								{ confirming === 'discard' ? (
									<>
										<button
											type="button"
											className="btn btn-danger"
											disabled={ busy || discardConfirm.trim() !== 'discard' || selected.size === 0 }
											onClick={ () =>
												void act( async () => {
													const { backup } = await api.discard( [ ...selected ], 'discard' );

													return `Discarded ${ selected.size } change${ selected.size === 1 ? '' : 's' }. A backup of ${ backup.entries.length } file${ backup.entries.length === 1 ? '' : 's' } is below if you need it back.`;
												} )
											}
										>
											<RotateCcw size={ 14 } />
											Discard { selected.size } change{ selected.size === 1 ? '' : 's' }
										</button>
										<button type="button" className="btn" onClick={ () => setConfirming( null ) }>
											Cancel
										</button>
									</>
								) : (
									<button type="button" className="btn btn-danger-ghost" disabled={ busy || selected.size === 0 } onClick={ () => setConfirming( 'discard' ) }>
										<RotateCcw size={ 14 } />
										Discard selected changes…
									</button>
								) }
							</div>
						</>
					) }
				</section>

				<BackupList
					backups={ plan?.backups ?? [] }
					busy={ busy }
					onRestore={ ( id ) => void act( async () => ( await api.restoreBackup( id ), 'Restored the backup. The files are back as they were before the discard.' ) ) }
					onDelete={ ( id ) => void act( async () => ( await api.deleteBackup( id ), 'Deleted the backup.' ) ) }
				/>

				<section className="reset-section">
					<h3 className="reset-subtitle">
						<Database size={ 14 } /> Delete console data
					</h3>
					<p className="note">
						Deletes the console's run history ({ plan?.consoleData.runs ?? 0 } run{ plan?.consoleData.runs === 1 ? '' : 's' }), local builds and zips (
						{ plan?.consoleData.builds ?? 0 }), the cache (Mozart, the Lite clone){ plan?.consoleData.settings ? ' and the saved Settings' : '' }:{ ' ' }
						{ formatSize( plan?.consoleData.bytes ?? 0 ) } in all. Your repo files and the discard backups are kept. Claude's own session files are not
						touched, so <code>claude --resume</code> still works.
					</p>
					{ confirming === 'data' && <TypeToConfirm word="delete" value={ dataConfirm } onChange={ setDataConfirm } /> }
					<div className="button-row">
						{ confirming === 'data' ? (
							<>
								<button
									type="button"
									className="btn btn-danger"
									disabled={ busy || dataConfirm.trim() !== 'delete' }
									onClick={ () => void act( async () => ( await api.deleteConsoleData( 'delete' ), 'Deleted the console data.' ) ) }
								>
									<Trash2 size={ 14 } />
									Delete console data
								</button>
								<button type="button" className="btn" onClick={ () => setConfirming( null ) }>
									Cancel
								</button>
							</>
						) : (
							<button type="button" className="btn btn-danger-ghost" disabled={ busy } onClick={ () => setConfirming( 'data' ) }>
								<Trash2 size={ 14 } />
								Delete console data…
							</button>
						) }
					</div>
				</section>
			</div>
		</div>
	);
}
