import { Download, FileQuestion } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CodeView, languageName } from '../../components/CodeView.tsx';
import { CopyButton } from '../../components/CopyButton.tsx';
import { languageFor } from '../../lib/highlight.ts';
import { EmptyState } from '../../components/EmptyState.tsx';
import { api, zipFileUrl, type ZipFileContent } from '../../lib/api.ts';
import { formatSize } from '../../lib/format.ts';

const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;

/** Shows one file from inside a built zip: code with line numbers, an image, or a note for binary files. */
export function ZipFileView( { buildId, zip, path }: { buildId: string; zip: string; path: string } ) {
	const [ file, setFile ] = useState<ZipFileContent | null>( null );
	const [ error, setError ] = useState<string | null>( null );
	const isImage = IMAGE.test( path );

	useEffect( () => {
		let cancelled = false;

		setFile( null );
		setError( null );

		if ( isImage ) {
			return;
		}

		api.zipFile( buildId, zip, path )
			.then( ( result ) => ! cancelled && setFile( result.file ) )
			.catch( ( caught: Error ) => ! cancelled && setError( caught.message ) );

		return () => {
			cancelled = true;
		};
	}, [ buildId, zip, path, isImage ] );

	const lines = file?.content?.split( '\n' ) ?? [];

	return (
		<div className="zip-file">
			<header className="viewer-head">
				<div className="viewer-title">
					<code>{ path }</code>
					<span className="muted small">
						{ file ? formatSize( file.size ) : isImage ? 'Image' : 'Loading…' }
						{ file?.content !== null && file && ` · ${ lines.length.toLocaleString() } line${ lines.length === 1 ? '' : 's' } · ${ languageName( languageFor( path ) ) }` }
					</span>
				</div>
				<div className="viewer-actions">
					{ file?.content && <CopyButton text={ file.content } label="Copy" /> }
					<a className="btn btn-sm btn-icon" href={ zipFileUrl( buildId, zip, path, true ) } title="Download this file" aria-label="Download this file">
						<Download size={ 14 } />
					</a>
				</div>
			</header>
			<div className="viewer-body viewer-body-flush">
				{ error && <p className="callout callout-danger zip-file-callout">{ error }</p> }
				{ isImage && <img className="viewer-image zip-image" src={ zipFileUrl( buildId, zip, path ) } alt={ path } /> }
				{ file?.binary && (
					<EmptyState icon={ <FileQuestion size={ 24 } /> } title="Binary file">
						{ formatSize( file.size ) }. Download it to open it.
					</EmptyState>
				) }
				{ file?.content !== null && file && (
					<>
						{ file.truncated && <p className="note zip-file-callout">Only the first 1 MB is shown. Download the file for the rest.</p> }
						<CodeView code={ file.content } path={ path } />
					</>
				) }
			</div>
		</div>
	);
}
