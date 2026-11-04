/** Links built from data the console did not write, such as GitHub's replies. */

/**
 * The URL when it is http or https, or null. Anything else (`javascript:`,
 * `data:`, a relative path) never reaches an `href`.
 */
export function safeExternalUrl( value: unknown ): string | null {
	if ( typeof value !== 'string' || value === '' ) {
		return null;
	}

	try {
		const url = new URL( value );

		return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
	} catch {
		return null;
	}
}
