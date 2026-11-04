/** Shared formatting for sizes, times, durations and costs. */

export function formatSize( bytes: number ): string {
	if ( bytes < 1024 ) {
		return `${ bytes } B`;
	}

	if ( bytes < 1024 * 1024 ) {
		return `${ ( bytes / 1024 ).toFixed( 1 ) } KB`;
	}

	return `${ ( bytes / 1024 / 1024 ).toFixed( 1 ) } MB`;
}

export function formatDuration( ms: number ): string {
	const seconds = Math.max( 0, Math.round( ms / 1000 ) );

	if ( seconds < 60 ) {
		return `${ seconds }s`;
	}

	const minutes = Math.floor( seconds / 60 );

	return minutes < 60 ? `${ minutes }m ${ seconds % 60 }s` : `${ Math.floor( minutes / 60 ) }h ${ minutes % 60 }m`;
}

export function formatCost( cost: number | null ): string {
	return cost === null ? '' : `$${ cost.toFixed( cost < 1 ? 3 : 2 ) }`;
}

export function formatDateTime( ms: number ): string {
	return new Date( ms ).toLocaleString( undefined, { dateStyle: 'medium', timeStyle: 'short' } );
}

export function relativeTime( ms: number, now = Date.now() ): string {
	const minutes = Math.round( ( now - ms ) / 60000 );

	if ( minutes < 1 ) {
		return 'just now';
	}

	if ( minutes < 60 ) {
		return `${ minutes }m ago`;
	}

	const hours = Math.round( minutes / 60 );

	if ( hours < 24 ) {
		return `${ hours }h ago`;
	}

	return new Date( ms ).toLocaleDateString( undefined, { dateStyle: 'medium' } );
}
