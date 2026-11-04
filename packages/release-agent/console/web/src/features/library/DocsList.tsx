import { BookOpen, ChevronDown, ChevronRight, Image as ImageIcon, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { EmptyState } from '../../components/EmptyState.tsx';
import { rawUrl, type DocEntry, type DocsListing } from '../../lib/api.ts';
import { formatSize } from '../../lib/format.ts';

export type DocsFilter = 'changed' | 'all';

export interface DocSection {
	id: string;
	title: string;
	articles: DocEntry[];
	images: DocEntry[];
}

const SECTION_NAMES: Record<string, string> = {
	'': 'Overview',
	faq: 'FAQ',
	screenshots: 'Screenshots',
};

/** `plugin-functionality` → `Plugin functionality`. */
export function sectionTitle( id: string ): string {
	if ( id in SECTION_NAMES ) {
		return SECTION_NAMES[ id ];
	}

	const words = id.replace( /[-_]+/g, ' ' ).trim();

	return words.charAt( 0 ).toUpperCase() + words.slice( 1 );
}

/** The file name, without the folder. */
function fileName( entry: DocEntry ): string {
	return entry.path.split( '/' ).pop() ?? entry.path;
}

/**
 * The docs grouped by top folder, filtered by what changed and by a search over
 * titles and paths. The top-level files come first and the screenshots last.
 */
export function docSections( files: DocEntry[], filter: DocsFilter, query: string ): DocSection[] {
	const needle = query.trim().toLowerCase();
	const sections = new Map<string, DocSection>();

	for ( const file of files ) {
		if ( filter === 'changed' && ! file.change ) {
			continue;
		}

		if ( needle && ! `${ file.title ?? '' } ${ file.path }`.toLowerCase().includes( needle ) ) {
			continue;
		}

		if ( file.kind !== 'markdown' && file.kind !== 'image' ) {
			continue;
		}

		const section = sections.get( file.section ) ?? { id: file.section, title: sectionTitle( file.section ), articles: [], images: [] };

		( file.kind === 'image' ? section.images : section.articles ).push( file );
		sections.set( file.section, section );
	}

	const rank = ( id: string ) => ( id === '' ? 0 : id === 'screenshots' ? 2 : 1 );

	return [ ...sections.values() ].sort( ( a, b ) => rank( a.id ) - rank( b.id ) || a.title.localeCompare( b.title ) );
}

function ChangeBadge( { change }: { change: DocEntry[ 'change' ] } ) {
	if ( ! change ) {
		return null;
	}

	return <span className={ `doc-change doc-change-${ change }` }>{ change === 'added' ? 'New' : 'Updated' }</span>;
}

function Section( {
	section,
	selected,
	onSelect,
	open,
	onToggle,
}: {
	section: DocSection;
	selected: string | null;
	onSelect: ( path: string ) => void;
	open: boolean;
	onToggle: () => void;
} ) {
	return (
		<section className="library-group">
			<button type="button" className="library-group-head" aria-expanded={ open } onClick={ onToggle }>
				{ open ? <ChevronDown size={ 14 } /> : <ChevronRight size={ 14 } /> }
				{ section.id === 'screenshots' ? <ImageIcon size={ 15 } /> : <BookOpen size={ 15 } /> }
				<span>{ section.title }</span>
				<span className="count">{ section.articles.length + section.images.length }</span>
			</button>
			{ open && (
				<ul className="grouped-list">
					{ section.articles.map( ( file ) => (
						<li key={ file.path }>
							<button type="button" className={ `list-row${ file.path === selected ? ' is-selected' : '' }` } onClick={ () => onSelect( file.path ) } title={ file.path }>
								<span className="file-glyph kind-markdown" aria-hidden="true">
									MD
								</span>
								<span className="list-row-text">
									<span className="list-row-title">{ file.title ?? fileName( file ) }</span>
									<span className="list-row-sub">
										{ fileName( file ) } · { formatSize( file.size ) }
									</span>
								</span>
								<ChangeBadge change={ file.change } />
							</button>
						</li>
					) ) }
					{ section.images.length > 0 && (
						<li>
							<div className="thumb-grid">
								{ section.images.map( ( file ) => (
									<button
										key={ file.path }
										type="button"
										className={ `thumb-tile${ file.path === selected ? ' is-selected' : '' }` }
										onClick={ () => onSelect( file.path ) }
										title={ file.path }
									>
										<img src={ rawUrl( file.path ) } alt={ fileName( file ) } loading="lazy" />
										<span>
											{ file.change && <ChangeBadge change={ file.change } /> } { fileName( file ) }
										</span>
									</button>
								) ) }
							</div>
						</li>
					) }
				</ul>
			) }
		</section>
	);
}

export function DocsList( {
	listing,
	version,
	selected,
	onSelect,
}: {
	listing: DocsListing;
	/** The release being worked on, for the "Changed" label. */
	version: string;
	selected: string | null;
	onSelect: ( path: string ) => void;
} ) {
	const changed = listing.files.filter( ( file ) => file.change ).length;
	const articles = listing.files.filter( ( file ) => file.kind === 'markdown' ).length;
	const [ filter, setFilter ] = useState<DocsFilter>( changed > 0 ? 'changed' : 'all' );
	const [ query, setQuery ] = useState( '' );
	// Sections start open, except the screenshots when every file is shown (there are hundreds).
	const [ toggled, setToggled ] = useState<Record<string, boolean>>( {} );
	const sections = useMemo( () => docSections( listing.files, filter, query ), [ listing.files, filter, query ] );
	const isOpen = ( section: DocSection ) =>
		toggled[ section.id ] ?? ( query.trim() !== '' || filter === 'changed' || section.id !== 'screenshots' || section.images.some( ( file ) => file.path === selected ) );

	return (
		<>
			<header className="item-list-head">
				<h2>User docs</h2>
				<span className="muted small">
					{ articles } article{ articles === 1 ? '' : 's' } in <code>docs-user/</code>
					{ listing.baseTag ? ` · ${ changed } changed since ${ listing.baseTag }` : version ? ' · no earlier release tag to compare with' : '' }
				</span>
			</header>
			<div className="docs-controls">
				<div className="segmented" role="group" aria-label="Show">
					<button type="button" aria-pressed={ filter === 'changed' } onClick={ () => setFilter( 'changed' ) }>
						Changed{ version ? ` in ${ version }` : '' } ({ changed })
					</button>
					<button type="button" aria-pressed={ filter === 'all' } onClick={ () => setFilter( 'all' ) }>
						All
					</button>
				</div>
				<label className="search">
					<Search size={ 14 } />
					<input type="search" value={ query } onChange={ ( event ) => setQuery( event.target.value ) } placeholder="Find an article" aria-label="Find an article" />
				</label>
			</div>

			{ sections.length === 0 &&
				( filter === 'changed' && ! query ? (
					<EmptyState icon={ <BookOpen size={ 24 } /> } title="No doc changes">
						{ listing.baseTag ? `Nothing in docs-user/ differs from ${ listing.baseTag }.` : 'There is no earlier release tag to compare with.' } Run the Docs stage, or
						show all articles.
					</EmptyState>
				) : (
					<EmptyState icon={ <Search size={ 24 } /> } title="No matches">
						Nothing matches “{ query }”.
					</EmptyState>
				) ) }

			{ sections.map( ( section ) => (
				<Section
					key={ section.id }
					section={ section }
					selected={ selected }
					onSelect={ onSelect }
					open={ isOpen( section ) }
					onToggle={ () => setToggled( ( current ) => ( { ...current, [ section.id ]: ! isOpen( section ) } ) ) }
				/>
			) ) }

			{ filter === 'changed' && listing.deleted.length > 0 && (
				<p className="note">
					Deleted since { listing.baseTag }: { listing.deleted.map( ( file ) => file.replace( /^docs-user\//, '' ) ).join( ', ' ) }
				</p>
			) }
			{ listing.truncated && <p className="note">Only the first files are listed; docs-user/ has more than the console reads.</p> }
		</>
	);
}
