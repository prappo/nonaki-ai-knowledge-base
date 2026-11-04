/**
 * Front matter at the top of a Markdown file. Pure (no Node imports), so the
 * server and the web UI share it.
 */

/** Reads the simple `key: "value"` front matter the docs use. Anything fancier is skipped. */
export function parseFrontMatter( content: string ): { data: Record<string, string>; body: string } {
	const match = content.match( /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/ );

	if ( ! match ) {
		return { data: {}, body: content };
	}

	const data: Record<string, string> = {};

	for ( const line of match[ 1 ].split( /\r?\n/ ) ) {
		const field = line.match( /^([A-Za-z_][\w-]*):\s*(.*)$/ );

		if ( ! field ) {
			continue;
		}

		let value = field[ 2 ].trim();

		if ( value.length >= 2 && ( ( value.startsWith( '"' ) && value.endsWith( '"' ) ) || ( value.startsWith( "'" ) && value.endsWith( "'" ) ) ) ) {
			value = value.slice( 1, -1 ).replace( /\\"/g, '"' );
		}

		data[ field[ 1 ] ] = value;
	}

	return { data, body: content.slice( match[ 0 ].length ) };
}
