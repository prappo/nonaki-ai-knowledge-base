import { Download, ExternalLink, Pencil } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseFrontMatter } from '../../../../server/release/frontMatter.ts';
import { CodeView } from '../../components/CodeView.tsx';
import { CopyButton } from '../../components/CopyButton.tsx';
import { Markdown } from '../../components/Markdown.tsx';
import { DiffView } from '../changes/ChangesPanel.tsx';
import { changedFields, diffBlocks } from '../../lib/blockDiff.ts';
import { ApiError, api, rawUrl, type DocDiff, type FileEntry, type TextFile } from '../../lib/api.ts';
import { formatDateTime, formatSize } from '../../lib/format.ts';
import { safeExternalUrl } from '../../lib/url.ts';
import { Spinner } from '../../components/Spinner.tsx';

/** Field names shown as words, e.g. `source_url` → `Source url`. */
function fieldLabel( key: string ): string {
	const words = key.replace( /[_-]+/g, ' ' ).trim();

	return words.charAt( 0 ).toUpperCase() + words.slice( 1 );
}

/** The front matter of a Markdown file, shown above the rendered article. */
export function FrontMatter( { data }: { data: Record<string, string> } ) {
	const fields = Object.entries( data ).filter( ( [ , value ] ) => value !== '' );

	if ( fields.length === 0 ) {
		return null;
	}

	return (
		<dl className="front-matter">
			{ fields.map( ( [ key, value ] ) => (
				<div key={ key }>
					<dt>{ fieldLabel( key ) }</dt>
					<dd>
						{ safeExternalUrl( value ) ? (
							<a href={ safeExternalUrl( value ) ?? undefined } target="_blank" rel="noreferrer noopener">
								{ value }
							</a>
						) : (
							value
						) }
					</dd>
				</div>
			) ) }
		</dl>
	);
}

function Editor( {
	file,
	onSaved,
	onCancel,
	onReload,
}: {
	file: TextFile;
	onSaved: ( file: TextFile ) => void;
	onCancel: () => void;
	/** Loads the file's current content into a fresh editor, dropping these edits. */
	onReload: () => void;
} ) {
	const [ content, setContent ] = useState( file.content );
	const [ error, setError ] = useState<{ message: string; conflict: boolean } | null>( null );
	const [ busy, setBusy ] = useState( false );
	const [ confirmDiscard, setConfirmDiscard ] = useState( false );
	const dirty = content !== file.content;

	async function save() {
		setBusy( true );
		setError( null );

		try {
			const { file: saved } = await api.saveFile( file.path, content, file.hash );
			onSaved( saved );
		} catch ( caught ) {
			const conflict = caught instanceof ApiError && caught.status === 409 && /changed after/.test( caught.message );

			setError( { message: ( caught as Error ).message, conflict } );
		} finally {
			setBusy( false );
		}
	}

	return (
		<div className="editor">
			<textarea
				value={ content }
				spellCheck={ false }
				aria-label={ `Edit ${ file.path }` }
				onChange={ ( event ) => {
					setContent( event.target.value );
					setConfirmDiscard( false );
				} }
				onKeyDown={ ( event ) => {
					if ( event.key === 's' && ( event.metaKey || event.ctrlKey ) ) {
						event.preventDefault();

						if ( dirty && ! busy ) {
							void save();
						}
					}
				} }
			/>
			{ error && (
				<p className="error-text" role="alert">
					{ error.message }
					{ error.conflict && ' Your edits are still in the box above; copy them before loading the latest version.' }
				</p>
			) }
			{ error?.conflict && (
				<div className="actions">
					<CopyButton text={ content } label="Copy my edits" />
					<button type="button" className="btn" onClick={ onReload }>
						Load latest version
					</button>
				</div>
			) }
			<div className="actions">
				<span className="muted small-text">{ dirty ? 'Unsaved changes' : 'No changes' }</span>
				{ confirmDiscard ? (
					<button type="button" className="btn btn-danger" onClick={ onCancel }>
						Discard edits
					</button>
				) : (
					<button type="button" className="btn" disabled={ busy } onClick={ () => ( dirty ? setConfirmDiscard( true ) : onCancel() ) }>
						Cancel
					</button>
				) }
				<button type="button" className="btn btn-primary" disabled={ ! dirty || busy } onClick={ save }>
					{ busy ? 'Saving…' : 'Save' }
				</button>
			</div>
		</div>
	);
}

/** The article rendered as it reads, with added blocks marked green and removed ones red. */
function VisualDiff( { before, after, path }: { before: string; after: string; path: string } ) {
	const { fields, blocks } = useMemo( () => {
		const [ old, current ] = [ parseFrontMatter( before ), parseFrontMatter( after ) ];

		return { fields: changedFields( old.data, current.data ), blocks: diffBlocks( old.body, current.body ) };
	}, [ before, after ] );
	const added = blocks.filter( ( block ) => block.change === 'added' ).length;
	const removed = blocks.filter( ( block ) => block.change === 'removed' ).length;

	return (
		<div className="visual-diff">
			<p className="visual-diff-summary small-text">
				<span className="visual-diff-count visual-diff-count-added">{ added } added</span>
				<span className="visual-diff-count visual-diff-count-removed">{ removed } removed</span>
				{ fields.length > 0 && <span className="muted">{ fields.length } detail{ fields.length === 1 ? '' : 's' } changed</span> }
				{ added + removed === 0 && fields.length === 0 && <span className="muted">Only spacing changed.</span> }
			</p>
			{ fields.length > 0 && (
				<dl className="front-matter visual-diff-fields">
					{ fields.map( ( field ) => (
						<div key={ field.key }>
							<dt>{ fieldLabel( field.key ) }</dt>
							<dd>
								{ field.before !== null && <del>{ field.before }</del> }
								{ field.after !== null && <ins>{ field.after }</ins> }
							</dd>
						</div>
					) ) }
				</dl>
			) }
			{ blocks.map( ( block, index ) => (
				<div key={ index } className={ `visual-diff-block is-${ block.change }` }>
					{ block.change !== 'same' && (
						<span className="visual-diff-tag" aria-label={ block.change === 'added' ? 'Added' : 'Removed' }>
							{ block.change === 'added' ? '+' : '−' }
						</span>
					) }
					<Markdown text={ block.text } filePath={ path } />
				</div>
			) ) }
		</div>
	);
}

/** What changed in a user doc since the previous release tag. */
function DocChanges( { version, path, markdown }: { version: string; path: string; markdown: boolean } ) {
	const [ diff, setDiff ] = useState<DocDiff | null>( null );
	const [ error, setError ] = useState<string | null>( null );
	const [ style, setStyle ] = useState<'visual' | 'text'>( markdown ? 'visual' : 'text' );

	useEffect( () => {
		let cancelled = false;

		setDiff( null );
		setError( null );
		api.docDiff( version, path )
			.then( ( result ) => ! cancelled && setDiff( result.diff ) )
			.catch( ( caught: Error ) => ! cancelled && setError( caught.message ) );

		return () => {
			cancelled = true;
		};
	}, [ version, path ] );

	if ( error ) {
		return <p className="error-text" role="alert">{ error }</p>;
	}

	if ( ! diff ) {
		return <Spinner block label="Loading changes…" />;
	}

	// A new article has nothing to compare with: the visual view shows it all as added.
	// An older agent sends no text at all, so check the types rather than trust them.
	const before = typeof diff.before === 'string' ? diff.before : '';
	const after = typeof diff.after === 'string' ? diff.after : null;
	const canShowVisual = markdown && after !== null;

	return (
		<>
			<div className="visual-diff-head">
				<p className="muted small-text">
					Compared with <code>{ diff.baseTag }</code>, including uncommitted edits.
				</p>
				{ canShowVisual && (
					<div className="segmented" role="group" aria-label="Comparison style">
						<button type="button" className="btn btn-sm" aria-pressed={ style === 'visual' } onClick={ () => setStyle( 'visual' ) }>
							Visual
						</button>
						<button type="button" className="btn btn-sm" aria-pressed={ style === 'text' } onClick={ () => setStyle( 'text' ) }>
							Text
						</button>
					</div>
				) }
			</div>
			{ markdown && ! canShowVisual && diff.after === undefined && (
				<p className="note">The visual comparison needs the latest release agent. Restart it (or update it from this page) to see it.</p>
			) }
			{ canShowVisual && style === 'visual' ? <VisualDiff before={ before } after={ after } path={ path } /> : <DiffView diff={ diff } /> }
		</>
	);
}

export function FileViewer( {
	entry,
	runActive,
	onChanged,
	changedSince,
}: {
	entry: FileEntry;
	runActive: boolean;
	onChanged: () => void;
	/** For a user doc that changed for this release: the release version, which enables the Changes view. */
	changedSince?: string;
} ) {
	const [ file, setFile ] = useState<TextFile | null>( null );
	const [ error, setError ] = useState<string | null>( null );
	const [ mode, setMode ] = useState<'view' | 'source' | 'changes' | 'edit'>( 'view' );
	const [ revision, setRevision ] = useState( 0 );
	const canCompare = Boolean( changedSince ) && entry.kind !== 'image';

	const load = useCallback( async () => {
		setError( null );

		if ( entry.kind === 'image' ) {
			setFile( null );
			return;
		}

		try {
			setFile( ( await api.file( entry.path ) ).file );
		} catch ( caught ) {
			setFile( null );
			setError( ( caught as Error ).message );
		}
	}, [ entry.path, entry.kind ] );

	useEffect( () => {
		setMode( ( current ) => ( current === 'changes' && canCompare ? current : 'view' ) );
		void load();
	}, [ load, entry.modifiedAt, canCompare ] );

	const hasRendered = entry.kind === 'markdown' || entry.kind === 'html';
	const article = useMemo( () => ( file && entry.kind === 'markdown' ? parseFrontMatter( file.content ) : null ), [ file, entry.kind ] );
	const editBlocked = runActive ? 'A run is in progress and may be writing this file.' : null;

	return (
		<div className="viewer">
			<header className="viewer-head">
				<div className="viewer-title">
					<code>{ entry.path }</code>
					<span className="muted small-text">
						{ formatSize( entry.size ) } · { formatDateTime( entry.modifiedAt ) }
					</span>
				</div>
				<div className="viewer-actions">
					{ ( hasRendered || canCompare ) && mode !== 'edit' && (
						<div className="segmented" role="group" aria-label="View mode">
							<button type="button" className="btn" aria-pressed={ mode === 'view' } onClick={ () => setMode( 'view' ) }>
								{ entry.kind === 'html' ? 'Preview' : hasRendered ? 'Rendered' : 'Content' }
							</button>
							{ hasRendered && (
								<button type="button" className="btn" aria-pressed={ mode === 'source' } onClick={ () => setMode( 'source' ) }>
									Source
								</button>
							) }
							{ canCompare && (
								<button type="button" className="btn" aria-pressed={ mode === 'changes' } onClick={ () => setMode( 'changes' ) }>
									Changes
								</button>
							) }
						</div>
					) }
					{ file && mode !== 'edit' && <CopyButton text={ file.content } label="Copy" /> }
					<a className="btn btn-sm btn-icon" href={ rawUrl( entry.path ) } target="_blank" rel="noreferrer" title="Open in a new tab" aria-label="Open in a new tab">
						<ExternalLink size={ 14 } />
					</a>
					<a className="btn btn-sm btn-icon" href={ rawUrl( entry.path ) } download={ entry.path.split( '/' ).pop() } title="Download" aria-label="Download">
						<Download size={ 14 } />
					</a>
					{ entry.editable && file && mode !== 'edit' && (
						<button type="button"
							className="btn btn-sm"
							disabled={ Boolean( editBlocked ) }
							title={ editBlocked ?? undefined }
							onClick={ () => setMode( 'edit' ) }
						>
							<Pencil size={ 13 } />
							Edit
						</button>
					) }
				</div>
			</header>

			<div className="viewer-body">
				{ error && <p className="error-text" role="alert">{ error }</p> }

				{ ! file && ! error && entry.kind !== 'image' && mode !== 'changes' && <Spinner block label="Loading the file…" /> }

				{ entry.kind === 'image' && <img className="viewer-image" src={ `${ rawUrl( entry.path ) }?v=${ entry.modifiedAt }` } alt={ entry.path } /> }

				{ file && mode === 'edit' && (
					<Editor
						key={ file.hash }
						file={ file }
						onReload={ () => {
							void load();
							onChanged();
						} }
						onCancel={ () => setMode( 'view' ) }
						onSaved={ ( saved ) => {
							setFile( saved );
							setMode( 'view' );
							setRevision( ( value ) => value + 1 );
							onChanged();
						} }
					/>
				) }

				{ mode === 'changes' && changedSince && <DocChanges key={ entry.modifiedAt } version={ changedSince } path={ entry.path } markdown={ entry.kind === 'markdown' } /> }

				{ file && mode === 'source' && <div className="source-code"><CodeView code={ file.content } path={ entry.path } /></div> }

				{ file && mode === 'view' && article && (
					<>
						<FrontMatter data={ article.data } />
						<Markdown text={ article.body } filePath={ entry.path } />
					</>
				) }

				{ file && mode === 'view' && entry.kind === 'html' && (
					// Scripts are blocked twice: by this sandbox and by the server's CSP header.
					<iframe
						key={ `${ file.hash }-${ revision }` }
						className="viewer-frame"
						title={ entry.path }
						sandbox=""
						src={ `${ rawUrl( entry.path ) }?v=${ file.hash.slice( 0, 12 ) }` }
					/>
				) }

				{ file && mode === 'view' && entry.kind === 'text' && <div className="source-code"><CodeView code={ file.content } path={ entry.path } /></div> }
			</div>
		</div>
	);
}

