/**
 * Syntax highlighting for code views (files inside a zip, Library sources).
 *
 * Only the languages this plugin uses are loaded, to keep the bundle small.
 * highlight.js escapes the text and only emits <span class="hljs-…"> tags.
 * Every line still goes through onlySpans, so nothing else can reach the page
 * as HTML even if highlight.js ever emitted it.
 */

import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import ini from 'highlight.js/lib/languages/ini';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import plaintext from 'highlight.js/lib/languages/plaintext';
import scss from 'highlight.js/lib/languages/scss';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

hljs.registerLanguage( 'bash', bash );
hljs.registerLanguage( 'css', css );
hljs.registerLanguage( 'diff', diff );
hljs.registerLanguage( 'ini', ini );
hljs.registerLanguage( 'javascript', javascript );
hljs.registerLanguage( 'json', json );
hljs.registerLanguage( 'markdown', markdown );
hljs.registerLanguage( 'php', php );
hljs.registerLanguage( 'plaintext', plaintext );
hljs.registerLanguage( 'scss', scss );
hljs.registerLanguage( 'typescript', typescript );
hljs.registerLanguage( 'xml', xml );
hljs.registerLanguage( 'yaml', yaml );

const EXTENSIONS: Record<string, string> = {
	php: 'php',
	js: 'javascript',
	jsx: 'javascript',
	mjs: 'javascript',
	cjs: 'javascript',
	ts: 'typescript',
	tsx: 'typescript',
	css: 'css',
	scss: 'scss',
	json: 'json',
	html: 'xml',
	htm: 'xml',
	xml: 'xml',
	svg: 'xml',
	md: 'markdown',
	sh: 'bash',
	yml: 'yaml',
	yaml: 'yaml',
	ini: 'ini',
	neon: 'yaml',
	diff: 'diff',
	patch: 'diff',
};

/** Above this, highlighting would make the page sluggish, so the file is shown plain. */
export const HIGHLIGHT_LIMIT = 400 * 1024;

/** The highlight.js language for a file, or null for plain text (readme.txt, .pot…). */
export function languageFor( path: string ): string | null {
	const extension = path.split( '/' ).pop()?.split( '.' ).pop()?.toLowerCase() ?? '';

	return EXTENSIONS[ extension ] ?? null;
}

function escapeHtml( text: string ): string {
	return text.replace( /&/g, '&amp;' ).replace( /</g, '&lt;' ).replace( />/g, '&gt;' );
}

const ALLOWED_TAG = /(<span class="[\w -]*">|<\/span>)/;

/**
 * Keeps only the span tags highlight.js emits and escapes every other < and >,
 * so a line can never carry another tag, an attribute or a script.
 */
export function onlySpans( html: string ): string {
	return html
		.split( ALLOWED_TAG )
		.map( ( part ) => ( ALLOWED_TAG.test( part ) ? part : part.replace( /</g, '&lt;' ).replace( />/g, '&gt;' ) ) )
		.join( '' );
}

/**
 * Splits highlighted HTML into one string per line. A span that runs across a
 * line break (a multi-line comment or string) is closed at the end of the line
 * and reopened on the next, so every line is valid HTML on its own.
 */
export function splitHighlightedLines( html: string ): string[] {
	const lines: string[] = [];
	const open: string[] = [];
	let current = '';
	const tokens = html.split( /(<span class="[^"]*">|<\/span>|\n)/ );

	for ( const token of tokens ) {
		if ( token === '\n' ) {
			lines.push( current + '</span>'.repeat( open.length ) );
			current = open.join( '' );
		} else if ( token.startsWith( '<span' ) ) {
			open.push( token );
			current += token;
		} else if ( token === '</span>' ) {
			open.pop();
			current += token;
		} else {
			current += token;
		}
	}

	lines.push( current + '</span>'.repeat( open.length ) );

	return lines;
}

/** The file's lines as HTML, highlighted when its language is known and it is not too big. */
export function highlightLines( code: string, path: string ): { lines: string[]; language: string | null } {
	const language = languageFor( path );

	if ( ! language || code.length > HIGHLIGHT_LIMIT ) {
		return { lines: code.split( '\n' ).map( escapeHtml ), language: null };
	}

	try {
		return { lines: splitHighlightedLines( hljs.highlight( code, { language, ignoreIllegals: true } ).value ).map( onlySpans ), language };
	} catch {
		return { lines: code.split( '\n' ).map( escapeHtml ), language: null };
	}
}
