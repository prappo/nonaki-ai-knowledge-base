import { Lexer } from 'marked';

export type BlockChange = 'same' | 'added' | 'removed';

export interface DiffBlock {
	change: BlockChange;
	/** The block's Markdown source, ready to render on its own. */
	text: string;
}

/** Above this many block pairs the comparison gives up on alignment and shows old then new. */
const MAX_CELLS = 1_000_000;

/**
 * Top-level Markdown blocks: headings, paragraphs, whole lists, tables, code
 * fences, quotes. Blank space between them is dropped, so reflowing the gaps
 * does not count as a change.
 */
export function markdownBlocks( markdown: string ): string[] {
	return Lexer.lex( markdown, { gfm: true } )
		.filter( ( token ) => token.type !== 'space' )
		.map( ( token ) => token.raw.trim() )
		.filter( Boolean );
}

/**
 * Line up two versions of an article block by block (longest common
 * subsequence). A changed block appears as the old one removed followed by the
 * new one added, so the reader sees both in place.
 */
export function diffBlocks( before: string, after: string ): DiffBlock[] {
	const a = markdownBlocks( before );
	const b = markdownBlocks( after );

	if ( a.length * b.length > MAX_CELLS ) {
		return [ ...a.map( ( text ) => ( { change: 'removed' as const, text } ) ), ...b.map( ( text ) => ( { change: 'added' as const, text } ) ) ];
	}

	const width = b.length + 1;
	const table = new Uint32Array( ( a.length + 1 ) * width );

	for ( let i = a.length - 1; i >= 0; i-- ) {
		for ( let j = b.length - 1; j >= 0; j-- ) {
			table[ i * width + j ] = a[ i ] === b[ j ] ? table[ ( i + 1 ) * width + j + 1 ] + 1 : Math.max( table[ ( i + 1 ) * width + j ], table[ i * width + j + 1 ] );
		}
	}

	const blocks: DiffBlock[] = [];
	let i = 0;
	let j = 0;

	while ( i < a.length && j < b.length ) {
		if ( a[ i ] === b[ j ] ) {
			blocks.push( { change: 'same', text: b[ j ] } );
			i++;
			j++;
		} else if ( table[ ( i + 1 ) * width + j ] >= table[ i * width + j + 1 ] ) {
			blocks.push( { change: 'removed', text: a[ i++ ] } );
		} else {
			blocks.push( { change: 'added', text: b[ j++ ] } );
		}
	}

	while ( i < a.length ) {
		blocks.push( { change: 'removed', text: a[ i++ ] } );
	}

	while ( j < b.length ) {
		blocks.push( { change: 'added', text: b[ j++ ] } );
	}

	return blocks;
}

/** Front matter fields whose value differs between the versions, in the new order then any dropped ones. */
export function changedFields( before: Record<string, string>, after: Record<string, string> ): { key: string; before: string | null; after: string | null }[] {
	const keys = [ ...new Set( [ ...Object.keys( after ), ...Object.keys( before ) ] ) ];

	return keys
		.filter( ( key ) => ( before[ key ] ?? null ) !== ( after[ key ] ?? null ) )
		.map( ( key ) => ( { key, before: before[ key ] ?? null, after: after[ key ] ?? null } ) );
}
