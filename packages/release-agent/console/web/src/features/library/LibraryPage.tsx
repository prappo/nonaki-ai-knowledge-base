import {
	Bell,
	BookOpen,
	Boxes,
	ChevronDown,
	ChevronRight,
	ClipboardCheck,
	File,
	FileText,
	FolderOpen,
	Image as ImageIcon,
	Mail,
	MessageSquare,
	Newspaper,
	Package,
	RefreshCw,
	Share2,
	type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '../../components/EmptyState.tsx';
import { ContextMark } from '../../components/Logo.tsx';
import { api, rawUrl, type BuildRecord, type DocsListing, type FileEntry, type LibraryVersion } from '../../lib/api.ts';
import { displayName, groupReleaseFiles, type FileGroup, type FileGroupId } from '../../lib/fileGroups.ts';
import { formatDateTime, formatSize } from '../../lib/format.ts';
import { ZipBrowser } from '../builds/ZipBrowser.tsx';
import { DocsList } from './DocsList.tsx';
import { FileViewer } from './FileViewer.tsx';

export const GROUP_ICONS: Record<FileGroupId, LucideIcon> = {
	notes: FileText,
	blog: Newspaper,
	newsletter: Mail,
	social: Share2,
	slack: MessageSquare,
	notifications: Bell,
	reviews: ClipboardCheck,
	media: ImageIcon,
	other: File,
};

const FILTERS: { id: 'all' | FileGroupId; label: string }[] = [
	{ id: 'all', label: 'All' },
	{ id: 'blog', label: 'Blog' },
	{ id: 'newsletter', label: 'Newsletter' },
	{ id: 'social', label: 'Social' },
	{ id: 'notifications', label: 'Notifications' },
	{ id: 'notes', label: 'Notes' },
	{ id: 'reviews', label: 'Reviews' },
];

const COLLAPSED_KEY = 'release-console:library-collapsed';

function loadCollapsed(): Record<string, boolean> {
	try {
		return JSON.parse( localStorage.getItem( COLLAPSED_KEY ) ?? '{}' ) as Record<string, boolean>;
	} catch {
		return {};
	}
}

export interface LibrarySelection {
	/** A release version, "docs" for the customer docs, or "builds" for the plugin builds. */
	source: string | null;
	file: string | null;
	build: string | null;
	zip: string | null;
}

function FileRow( { file, releaseDir, selected, onSelect }: { file: FileEntry; releaseDir: string; selected: boolean; onSelect: () => void } ) {
	return (
		<li>
			<button type="button" className={ `list-row${ selected ? ' is-selected' : '' }` } onClick={ onSelect } title={ file.path }>
				{ file.kind === 'image' ? (
					<img className="thumb" src={ rawUrl( file.path ) } alt="" loading="lazy" />
				) : (
					<span className={ `file-glyph kind-${ file.kind }` } aria-hidden="true">
						{ file.kind === 'markdown' ? 'MD' : file.kind === 'html' ? 'HTML' : 'TXT' }
					</span>
				) }
				<span className="list-row-text">
					<span className="list-row-title">{ displayName( file, releaseDir ) }</span>
					<span className="list-row-sub">
						{ formatSize( file.size ) } · { formatDateTime( file.modifiedAt ) }
					</span>
				</span>
			</button>
		</li>
	);
}

function Group( {
	group,
	releaseDir,
	selected,
	onSelect,
	collapsed,
	onToggle,
}: {
	group: FileGroup;
	releaseDir: string;
	selected: string | null;
	onSelect: ( path: string ) => void;
	collapsed: Record<string, boolean>;
	onToggle: ( key: string, open: boolean ) => void;
} ) {
	const Icon = GROUP_ICONS[ group.id ];
	const contains = ( files: FileEntry[] ) => files.some( ( file ) => file.path === selected );
	const open = contains( [ ...group.files, ...group.media ] ) || ! ( collapsed[ group.id ] ?? ( group.id === 'reviews' && group.files.length > 5 ) );
	const mediaKey = `${ group.id }:media`;
	const mediaOpen = contains( group.media ) || ! ( collapsed[ mediaKey ] ?? true );

	return (
		<section className="library-group">
			<button type="button" className="library-group-head" aria-expanded={ open } onClick={ () => onToggle( group.id, open ) }>
				{ open ? <ChevronDown size={ 14 } /> : <ChevronRight size={ 14 } /> }
				<Icon size={ 15 } />
				<span>{ group.title }</span>
				<span className="count">{ group.files.length + group.media.length }</span>
			</button>
			{ open && (
				<ul className="grouped-list">
					{ group.files.map( ( file ) => (
						<FileRow key={ file.path } file={ file } releaseDir={ releaseDir } selected={ file.path === selected } onSelect={ () => onSelect( file.path ) } />
					) ) }
					{ group.media.length > 0 && (
						<li>
							<button type="button" className="list-row list-row-sub-toggle" aria-expanded={ mediaOpen } onClick={ () => onToggle( mediaKey, mediaOpen ) }>
								{ mediaOpen ? <ChevronDown size={ 13 } /> : <ChevronRight size={ 13 } /> }
								<ImageIcon size={ 14 } />
								<span className="list-row-title">
									{ group.mediaLabel } ({ group.media.length })
								</span>
							</button>
							{ mediaOpen && (
								<div className="thumb-grid">
									{ group.media.map( ( file ) => (
										<button
											key={ file.path }
											type="button"
											className={ `thumb-tile${ file.path === selected ? ' is-selected' : '' }` }
											onClick={ () => onSelect( file.path ) }
											title={ displayName( file, releaseDir ) }
										>
											<img src={ rawUrl( file.path ) } alt={ displayName( file, releaseDir ) } loading="lazy" />
											<span>{ displayName( file, releaseDir ) }</span>
										</button>
									) ) }
								</div>
							) }
						</li>
					) }
				</ul>
			) }
		</section>
	);
}

export function LibraryPage( {
	selection,
	onSelect,
	currentVersion,
	runActive,
	refreshKey,
}: {
	selection: LibrarySelection;
	onSelect: ( selection: Partial<LibrarySelection> ) => void;
	currentVersion: string;
	runActive: boolean;
	refreshKey: unknown;
} ) {
	const [ versions, setVersions ] = useState<LibraryVersion[] | null>( null );
	const [ builds, setBuilds ] = useState<BuildRecord[]>( [] );
	const [ docs, setDocs ] = useState<DocsListing | null>( null );
	const [ error, setError ] = useState<string | null>( null );
	const [ filter, setFilter ] = useState<'all' | FileGroupId>( 'all' );
	const [ collapsed, setCollapsed ] = useState( loadCollapsed );

	const docsVersion = /^\d+\.\d+\.\d+(\.\d+)?$/.test( currentVersion ) ? currentVersion : '';

	const load = useCallback( async () => {
		try {
			const [ library, buildList, docList ] = await Promise.all( [ api.library(), api.builds(), api.docs( docsVersion ) ] );

			setVersions( library.versions );
			setBuilds( buildList.builds.filter( ( build ) => build.artifacts.length > 0 ) );
			setDocs( docList );
			setError( null );
		} catch ( caught ) {
			setError( ( caught as Error ).message );
		}
	}, [ docsVersion ] );

	useEffect( () => {
		void load();
	}, [ load, refreshKey ] );

	// Default to the release being worked on, else the newest one.
	const base = currentVersion.split( '.' ).slice( 0, 3 ).join( '.' );
	const source = selection.source ?? ( versions?.some( ( item ) => item.version === base ) ? base : versions?.[ 0 ]?.version ?? null );
	const release = versions?.find( ( item ) => item.version === source ) ?? null;
	const releaseDir = release ? `docs/releases/${ release.version }` : '';
	const groups = useMemo( () => ( release ? groupReleaseFiles( release.files, releaseDir ) : [] ), [ release, releaseDir ] );
	const shownGroups = filter === 'all' ? groups : groups.filter( ( group ) => group.id === filter );
	const selectedFile = release?.files.find( ( file ) => file.path === selection.file ) ?? null;
	const selectedBuild = builds.find( ( build ) => build.id === selection.build ) ?? null;
	const selectedDoc = source === 'docs' ? docs?.files.find( ( file ) => file.path === selection.file ) ?? null : null;
	const docsChanged = docs?.files.filter( ( file ) => file.change ).length ?? 0;

	const toggle = ( key: string, open: boolean ) =>
		setCollapsed( ( current ) => {
			const next = { ...current, [ key ]: open };

			try {
				localStorage.setItem( COLLAPSED_KEY, JSON.stringify( next ) );
			} catch {
				// Not remembered in private windows.
			}

			return next;
		} );

	return (
		<div className="page library">
			<nav className="source-list" aria-label="Library sources">
				<div className="source-head">
					<span className="field-label">Releases</span>
					<button type="button" className="btn btn-icon btn-ghost btn-sm" onClick={ () => void load() } title="Refresh" aria-label="Refresh">
						<RefreshCw size={ 13 } />
					</button>
				</div>
				{ error && <p className="callout callout-danger">{ error }</p> }
				<ul>
					{ versions?.map( ( item ) => (
						<li key={ item.version }>
							<button
								type="button"
								className={ `source-row${ source === item.version ? ' is-selected' : '' }` }
								onClick={ () => onSelect( { source: item.version, file: null, build: null, zip: null } ) }
							>
								<FolderOpen size={ 15 } />
								<span className="source-name">{ item.version }</span>
								{ item.version === base && <span className="pill">current</span> }
								<span className="count">{ item.files.length }</span>
							</button>
						</li>
					) ) }
				</ul>
				<div className="source-head">
					<span className="field-label">Docs</span>
				</div>
				<ul>
					<li>
						<button
							type="button"
							className={ `source-row${ source === 'docs' ? ' is-selected' : '' }` }
							onClick={ () => onSelect( { source: 'docs', file: null, build: null, zip: null } ) }
						>
							<BookOpen size={ 15 } />
							<span className="source-name">User docs</span>
							{ docsChanged > 0 && (
								<span className="pill" title={ `${ docsChanged } changed since ${ docs?.baseTag ?? 'the last release' }` }>
									{ docsChanged }
								</span>
							) }
							<span className="count">{ docs?.files.filter( ( file ) => file.kind === 'markdown' ).length ?? '' }</span>
						</button>
					</li>
				</ul>
				<div className="source-head">
					<span className="field-label">Builds</span>
				</div>
				<ul>
					<li>
						<button
							type="button"
							className={ `source-row${ source === 'builds' ? ' is-selected' : '' }` }
							onClick={ () => onSelect( { source: 'builds', file: null, build: builds[ 0 ]?.id ?? null, zip: builds[ 0 ]?.artifacts[ 0 ]?.name ?? null } ) }
						>
							<Boxes size={ 15 } />
							<span className="source-name">Plugin builds</span>
							<span className="count">{ builds.length }</span>
						</button>
					</li>
				</ul>
			</nav>

			<section className="item-list" aria-label="Files">
				{ source === 'docs' ? (
					docs ? (
						<DocsList
							key={ docsVersion }
							listing={ docs }
							version={ docsVersion }
							selected={ selection.file }
							onSelect={ ( path ) => onSelect( { source: 'docs', file: path, build: null, zip: null } ) }
						/>
					) : null
				) : source === 'builds' ? (
					<>
						<header className="item-list-head">
							<h2>Plugin builds</h2>
							<span className="muted small">Zips built on this machine</span>
						</header>
						{ builds.length === 0 && (
							<EmptyState icon={ <Boxes size={ 24 } /> } title="No builds yet">
								Build the plugin from the Builds section.
							</EmptyState>
						) }
						<ul className="grouped-list">
							{ builds.flatMap( ( build ) =>
								build.artifacts.map( ( artifact ) => (
									<li key={ `${ build.id }/${ artifact.name }` }>
										<button
											type="button"
											className={ `list-row${ selection.build === build.id && selection.zip === artifact.name ? ' is-selected' : '' }` }
											onClick={ () => onSelect( { source: 'builds', build: build.id, zip: artifact.name, file: null } ) }
										>
											<span className={ `file-glyph kind-zip-${ artifact.kind }` } aria-hidden="true">
												{ artifact.kind === 'pro' ? <ContextMark size={ 18 } /> : <Package size={ 14 } /> }
											</span>
											<span className="list-row-text">
												<span className="list-row-title">{ artifact.name }</span>
												<span className="list-row-sub">
													{ formatSize( artifact.size ) } · { formatDateTime( build.startedAt ) }
												</span>
											</span>
										</button>
									</li>
								) )
							) }
						</ul>
					</>
				) : release ? (
					<>
						<header className="item-list-head">
							<h2>{ release.version }</h2>
							<span className="muted small">
								{ release.files.length } file{ release.files.length === 1 ? '' : 's' } in <code>{ releaseDir }/</code>
							</span>
						</header>
						<div className="segmented segmented-scroll" role="group" aria-label="Show">
							{ FILTERS.filter( ( item ) => item.id === 'all' || groups.some( ( group ) => group.id === item.id ) ).map( ( item ) => (
								<button key={ item.id } type="button" aria-pressed={ filter === item.id } onClick={ () => setFilter( item.id ) }>
									{ item.label }
								</button>
							) ) }
						</div>
						{ shownGroups.map( ( group ) => (
							<Group
								key={ group.id }
								group={ group }
								releaseDir={ releaseDir }
								selected={ selection.file }
								onSelect={ ( path ) => onSelect( { source: release.version, file: path, build: null, zip: null } ) }
								collapsed={ collapsed }
								onToggle={ ( key, open ) => toggle( key, open ) }
							/>
						) ) }
					</>
				) : (
					versions && (
						<EmptyState icon={ <FolderOpen size={ 24 } /> } title="No release folders yet">
							Release content appears here once Analyze has run.
						</EmptyState>
					)
				) }
			</section>

			<section className="detail" aria-label="Preview">
				{ source === 'builds' && selectedBuild && selection.zip ? (
					<ZipBrowser buildId={ selectedBuild.id } name={ selection.zip } />
				) : selectedDoc ? (
					<FileViewer
						entry={ selectedDoc }
						runActive={ runActive }
						onChanged={ () => void load() }
						changedSince={ selectedDoc.change && docs?.baseTag ? docsVersion : undefined }
					/>
				) : source === 'docs' ? (
					<EmptyState icon={ <BookOpen size={ 28 } /> } title="Nothing selected">
						{ selection.file ? `${ selection.file } is not in docs-user/.` : 'Pick an article to read it.' }
					</EmptyState>
				) : selectedFile ? (
					<FileViewer entry={ selectedFile } runActive={ runActive } onChanged={ () => void load() } />
				) : (
					<EmptyState icon={ <File size={ 28 } /> } title="Nothing selected">
						{ selection.file ? `${ selection.file } is not in this release folder.` : 'Pick a file to preview it.' }
					</EmptyState>
				) }
			</section>
		</div>
	);
}
