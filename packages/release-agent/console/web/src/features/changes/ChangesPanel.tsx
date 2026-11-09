import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Change, type Changes, type Diff } from '../../lib/api.ts';
import { Spinner } from '../../components/Spinner.tsx';

const KIND_LABELS: Record<Change[ 'kind' ], string> = {
	modified: 'M',
	added: 'A',
	deleted: 'D',
	renamed: 'R',
	untracked: 'New',
	conflicted: '!',
	other: '?',
};

export type DiffLineType = 'add' | 'remove' | 'hunk' | 'meta' | 'context';

/** Classifies each line of a unified diff for colouring. */
export function classifyDiffLines( diff: string ): { type: DiffLineType; text: string }[] {
	let inHeader = true;

	return diff.split( '\n' ).map( ( text ) => {
		if ( text.startsWith( 'diff --git' ) ) {
			inHeader = true;
			return { type: 'meta' as const, text };
		}

		if ( text.startsWith( '@@' ) ) {
			inHeader = false;
			return { type: 'hunk' as const, text };
		}

		if ( inHeader ) {
			return { type: 'meta' as const, text };
		}

		if ( text.startsWith( '+' ) ) {
			return { type: 'add' as const, text };
		}

		if ( text.startsWith( '-' ) ) {
			return { type: 'remove' as const, text };
		}

		return { type: 'context' as const, text };
	} );
}

export function DiffView( { diff }: { diff: Diff } ) {
	const lines = useMemo( () => ( diff.kind === 'untracked' ? null : classifyDiffLines( diff.diff ) ), [ diff ] );

	if ( diff.binary ) {
		return <p className="muted">Binary file. No text diff to show.</p>;
	}

	if ( diff.kind === 'untracked' ) {
		return (
			<>
				<p className="muted small-text">New file, not yet tracked by git. Full content:</p>
				<pre className="diff">
					{ diff.diff.split( '\n' ).map( ( line, index ) => (
						<span key={ index } className="diff-line diff-add">
							{ `+${ line }` }
						</span>
					) ) }
				</pre>
				{ diff.truncated && <p className="muted small-text">Only the start of the file is shown.</p> }
			</>
		);
	}

	if ( ! diff.diff.trim() ) {
		return <p className="muted">No content changes (for example, only the file mode changed).</p>;
	}

	return (
		<>
			<pre className="diff">
				{ lines!.map( ( line, index ) => (
					<span key={ index } className={ `diff-line diff-${ line.type }` }>
						{ line.text || ' ' }
					</span>
				) ) }
			</pre>
			{ diff.truncated && <p className="muted small-text">The diff is very large; only the start is shown.</p> }
		</>
	);
}

export function ChangesPanel( { refreshKey, initialPath = null }: { refreshKey: unknown; initialPath?: string | null } ) {
	const [ changes, setChanges ] = useState<Changes | null>( null );
	const [ selected, setSelected ] = useState<string | null>( initialPath );

	useEffect( () => {
		if ( initialPath ) {
			setSelected( initialPath );
		}
	}, [ initialPath ] );
	const [ diff, setDiff ] = useState<Diff | null>( null );
	const [ error, setError ] = useState<string | null>( null );
	const [ diffError, setDiffError ] = useState<string | null>( null );

	const load = useCallback( async () => {
		try {
			setChanges( await api.changes() );
			setError( null );
		} catch ( caught ) {
			setError( ( caught as Error ).message );
		}
	}, [] );

	useEffect( () => {
		void load();
	}, [ load, refreshKey ] );

	useEffect( () => {
		if ( ! selected ) {
			setDiff( null );
			return;
		}

		let cancelled = false;

		setDiffError( null );
		api.diff( selected )
			.then( ( result ) => ! cancelled && setDiff( result.diff ) )
			.catch( ( caught: Error ) => {
				if ( ! cancelled ) {
					setDiff( null );
					setDiffError( caught.message );
				}
			} );

		return () => {
			cancelled = true;
		};
	}, [ selected, changes ] );

	return (
		<div className="files-panel">
			<nav className="file-list" aria-label="Changed files">
				<div className="file-list-head">
					<span className="muted small-text">
						{ changes ? `${ changes.changes.length } uncommitted change${ changes.changes.length === 1 ? '' : 's' }` : <Spinner label="Loading changes…" /> }
					</span>
					<button type="button" className="btn btn-sm" onClick={ () => void load() }>
						Refresh
					</button>
				</div>
				{ error && <p className="error-text">{ error }</p> }
				{ changes?.changes.length === 0 && <p className="muted small-text">The working tree is clean.</p> }
				<ul>
					{ changes?.changes.map( ( change ) => (
						<li key={ change.path }>
							<button type="button"
								className={ `file-row${ change.path === selected ? ' is-selected' : '' }` }
								onClick={ () => setSelected( change.path ) }
								title={ change.from ? `${ change.from } → ${ change.path }` : change.path }
							>
								<span className={ `change-kind change-${ change.kind }` }>{ KIND_LABELS[ change.kind ] }</span>
								<span className="file-name">{ change.path }</span>
							</button>
						</li>
					) ) }
				</ul>
				{ changes?.truncated && <p className="muted small-text">Only the first 500 changes are listed.</p> }
				{ changes && changes.hidden > 0 && (
					<p className="muted small-text">
						{ changes.hidden } change{ changes.hidden === 1 ? '' : 's' } to the Release Console itself (<code>tools/release-console/</code>) not shown.
					</p>
				) }
			</nav>
			<div className="viewer">
				{ selected ? (
					<>
						<header className="viewer-head">
							<div className="viewer-title">
								<code>{ selected }</code>
								<span className="muted small-text">Compared with the last commit (HEAD)</span>
							</div>
						</header>
						<div className="viewer-body">
							{ diffError && <p className="error-text" role="alert">{ diffError }</p> }
							{ diff ? <DiffView diff={ diff } /> : ! diffError && <Spinner block label="Loading the diff…" /> }
						</div>
					</>
				) : (
					<div className="viewer-empty">
						<p className="muted">Pick a file to see what changed. Nothing here is committed; the release commands leave that to you.</p>
					</div>
				) }
			</div>
		</div>
	);
}
