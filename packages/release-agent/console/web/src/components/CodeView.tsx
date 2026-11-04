import { useMemo } from 'react';
import { highlightLines } from '../lib/highlight.ts';

/** Lines rendered; past this the rest is still in Copy and Download. */
export const CODE_LINE_LIMIT = 5000;

const LANGUAGE_NAMES: Record<string, string> = {
	php: 'PHP',
	javascript: 'JavaScript',
	typescript: 'TypeScript',
	css: 'CSS',
	scss: 'SCSS',
	json: 'JSON',
	xml: 'HTML / XML',
	markdown: 'Markdown',
	bash: 'Shell',
	yaml: 'YAML',
	ini: 'INI',
	diff: 'Diff',
};

export function languageName( language: string | null ): string {
	if ( ! language ) {
		return 'Plain text';
	}

	// Own keys only, so "constructor" or "__proto__" can never return a non-string.
	return Object.hasOwn( LANGUAGE_NAMES, language ) ? LANGUAGE_NAMES[ language ] : language;
}

/** Code with line numbers and syntax highlighting, in the style of Xcode. */
export function CodeView( { code, path }: { code: string; path: string } ) {
	const { lines, language } = useMemo( () => highlightLines( code, path ), [ code, path ] );

	return (
		<>
			<pre className="code hljs-code" data-language={ language ?? 'plaintext' }>
				{ lines.slice( 0, CODE_LINE_LIMIT ).map( ( html, index ) => (
					// highlightLines escapes the text and lets through only hljs span tags.
					<span key={ index } className="code-line" dangerouslySetInnerHTML={ { __html: html || ' ' } } />
				) ) }
			</pre>
			{ lines.length > CODE_LINE_LIMIT && (
				<p className="note code-note">
					Showing { CODE_LINE_LIMIT.toLocaleString() } of { lines.length.toLocaleString() } lines. Copy or download for the rest.
				</p>
			) }
		</>
	);
}
