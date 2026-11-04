import { ChevronDown, ChevronRight, Download, File, FileText, Folder, FolderOpen, Search } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState.tsx';
import { ZipFileView } from './ZipFileView.tsx';
import { useEffect, useMemo, useState } from 'react';
import { api, buildFileUrl, type ZipEntry } from '../../lib/api.ts';
import { formatSize } from '../../lib/format.ts';

interface TreeNode {
	name: string;
	path: string;
	size: number;
	files: number;
	children: Map<string, TreeNode> | null;
}

/** Turns a zip's flat entry list into folders, with total sizes and file counts. */
export function buildTree( entries: ZipEntry[] ): TreeNode {
	const root: TreeNode = { name: '', path: '', size: 0, files: 0, children: new Map() };

	for ( const entry of entries ) {
		const parts = entry.path.split( '/' ).filter( Boolean );
		let node = root;

		node.size += entry.size;
		node.files += 1;

		parts.forEach( ( part, index ) => {
			const isFile = index === parts.length - 1;
			const children = node.children!;
			let child = children.get( part );

			if ( ! child ) {
				child = { name: part, path: parts.slice( 0, index + 1 ).join( '/' ), size: 0, files: 0, children: isFile ? null : new Map() };
				children.set( part, child );
			}

			child.size += entry.size;
			child.files += 1;
			node = child;
		} );
	}

	return root;
}

function sorted( children: Map<string, TreeNode> ): TreeNode[] {
	// Folders first, then files, each alphabetically: the way Finder lists them.
	return [ ...children.values() ].sort( ( a, b ) => Number( a.children === null ) - Number( b.children === null ) || a.name.localeCompare( b.name ) );
}

function Branch( {
	node,
	depth,
	open,
	toggle,
	selected,
	onSelect,
}: {
	node: TreeNode;
	depth: number;
	open: Set<string>;
	toggle: ( path: string ) => void;
	selected: string | null;
	onSelect: ( path: string ) => void;
} ) {
	const isFolder = node.children !== null;
	const isOpen = open.has( node.path );

	return (
		<>
			<li>
				<button
					type="button"
					className={ `tree-row${ node.path === selected ? ' is-selected' : '' }` }
					style={ { paddingLeft: 8 + depth * 16 } }
					onClick={ () => ( isFolder ? toggle( node.path ) : onSelect( node.path ) ) }
					aria-expanded={ isFolder ? isOpen : undefined }
				>
					<span className="tree-chevron">{ isFolder ? isOpen ? <ChevronDown size={ 13 } /> : <ChevronRight size={ 13 } /> : null }</span>
					{ isFolder ? isOpen ? <FolderOpen size={ 15 } className="icon-folder" /> : <Folder size={ 15 } className="icon-folder" /> : <File size={ 15 } className="icon-muted" /> }
					<span className="tree-name">{ node.name }</span>
					<span className="tree-meta">{ isFolder ? `${ node.files } file${ node.files === 1 ? '' : 's' } · ${ formatSize( node.size ) }` : formatSize( node.size ) }</span>
				</button>
			</li>
			{ isFolder &&
				isOpen &&
				sorted( node.children! ).map( ( child ) => (
					<Branch key={ child.path } node={ child } depth={ depth + 1 } open={ open } toggle={ toggle } selected={ selected } onSelect={ onSelect } />
				) ) }
		</>
	);
}

/** Browse the files inside a built zip, as a folder tree or by search, and read any of them. */
export function ZipBrowser( { buildId, name, compact = false }: { buildId: string; name: string; compact?: boolean } ) {
	const [ selected, setSelected ] = useState<string | null>( null );
	const [ entries, setEntries ] = useState<ZipEntry[] | null>( null );
	const [ truncated, setTruncated ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );
	const [ filter, setFilter ] = useState( '' );
	const [ open, setOpen ] = useState<Set<string>>( new Set() );

	useEffect( () => {
		let cancelled = false;

		setEntries( null );
		setError( null );
		setSelected( null );
		api.zipContents( buildId, name )
			.then( ( result ) => {
				if ( cancelled ) {
					return;
				}

				setEntries( result.entries );
				setTruncated( result.truncated );
				// Open the zip's top folder (wp-simple-pay-pro-3/ or stripe/).
				const top = result.entries[ 0 ]?.path.split( '/' )[ 0 ];
				setOpen( new Set( top ? [ top ] : [] ) );
			} )
			.catch( ( caught: Error ) => ! cancelled && setError( caught.message ) );

		return () => {
			cancelled = true;
		};
	}, [ buildId, name ] );

	const tree = useMemo( () => ( entries ? buildTree( entries ) : null ), [ entries ] );
	const matches = useMemo(
		() => ( entries && filter.trim() ? entries.filter( ( entry ) => entry.path.toLowerCase().includes( filter.trim().toLowerCase() ) ) : null ),
		[ entries, filter ]
	);

	const toggle = ( path: string ) =>
		setOpen( ( current ) => {
			const next = new Set( current );

			if ( next.has( path ) ) {
				next.delete( path );
			} else {
				next.add( path );
			}

			return next;
		} );

	return (
		<div className={ `viewer zip-browser${ compact ? ' is-compact' : '' }` }>
			<header className="viewer-head">
				<div className="viewer-title">
					<strong>{ name }</strong>
					<span className="muted small">{ tree ? `${ tree.files } file${ tree.files === 1 ? '' : 's' } · ${ formatSize( tree.size ) } uncompressed` : 'Reading the zip…' }</span>
				</div>
				<div className="viewer-actions">
					<label className="search">
						<Search size={ 14 } />
						<input value={ filter } onChange={ ( event ) => setFilter( event.target.value ) } placeholder="Find a file" aria-label="Find a file in the zip" />
					</label>
					<a className="btn btn-sm btn-primary" href={ buildFileUrl( buildId, name ) } download>
						<Download size={ 13 } />
						Download
					</a>
				</div>
			</header>
			<div className="zip-split">
			<div className="viewer-body viewer-body-flush zip-tree">
				{ error && <p className="callout callout-danger">{ error }</p> }
				{ truncated && <p className="note">This zip has a very large number of files; only the first 20,000 are listed.</p> }
				{ matches ? (
					<ul className="tree">
						{ matches.length === 0 && <li className="note">No files match.</li> }
						{ matches.slice( 0, 500 ).map( ( entry ) => (
							<li key={ entry.path }>
								<button
									type="button"
									className={ `tree-row tree-row-flat${ entry.path === selected ? ' is-selected' : '' }` }
									onClick={ () => setSelected( entry.path ) }
								>
									<File size={ 15 } className="icon-muted" />
									<span className="tree-name">{ entry.path }</span>
									<span className="tree-meta">{ formatSize( entry.size ) }</span>
								</button>
							</li>
						) ) }
						{ matches.length > 500 && <li className="note">{ matches.length - 500 } more. Narrow the search.</li> }
					</ul>
				) : (
					tree && (
						<ul className="tree">
							{ sorted( tree.children! ).map( ( child ) => (
								<Branch key={ child.path } node={ child } depth={ 0 } open={ open } toggle={ toggle } selected={ selected } onSelect={ setSelected } />
							) ) }
						</ul>
					)
				) }
			</div>
			<div className="zip-pane">
				{ selected ? (
					<ZipFileView buildId={ buildId } zip={ name } path={ selected } />
				) : (
					<EmptyState icon={ <FileText size={ 24 } /> } title="Pick a file to read it">
						Code and text open with line numbers; images show as a preview.
					</EmptyState>
				) }
			</div>
			</div>
		</div>
	);
}
