import DOMPurify from 'dompurify';
import { Marked, type Token } from 'marked';
import { useMemo } from 'react';
import { relinkHref } from '../lib/docLinks.ts';

const plain = new Marked( { gfm: true, breaks: false } );

let hooked = false;

/**
 * Links in rendered Markdown must not move the console itself: an in-page
 * anchor (`#overview`) would change the console's route, so it loses its
 * href, and links to other sites open in a new tab.
 */
function addLinkHook(): void {
	if ( hooked ) {
		return;
	}

	hooked = true;
	DOMPurify.addHook( 'afterSanitizeAttributes', ( node ) => {
		if ( node.tagName !== 'A' ) {
			return;
		}

		const href = node.getAttribute( 'href' ) ?? '';

		if ( /^#(?!\/)/.test( href ) ) {
			node.removeAttribute( 'href' );
		} else if ( /^(https?:)?\/\//i.test( href ) ) {
			node.setAttribute( 'target', '_blank' );
			node.setAttribute( 'rel', 'noreferrer noopener' );
		}
	} );
}

/** Rewrites paths relative to `filePath`: images to the raw endpoint, Markdown and HTML files to the Library. */
function relinked( filePath: string ): Marked {
	return new Marked( {
		gfm: true,
		breaks: false,
		walkTokens( token: Token ) {
			if ( token.type !== 'image' && token.type !== 'link' ) {
				return;
			}

			token.href = relinkHref( filePath, token.type, token.href ) ?? token.href;
		},
	} );
}

/** Markdown to safe HTML. With `filePath`, relative images and links resolve against that file. */
export function renderMarkdown( text: string, filePath?: string ): string {
	addLinkHook();

	const parser = filePath ? relinked( filePath ) : plain;

	return DOMPurify.sanitize( parser.parse( text, { async: false } ) as string );
}

/** Renders Claude's Markdown (changelog tables, lists, code) and repo Markdown files safely. */
export function Markdown( { text, filePath }: { text: string; filePath?: string } ) {
	const html = useMemo( () => renderMarkdown( text, filePath ), [ text, filePath ] );

	return <div className="markdown" dangerouslySetInnerHTML={ { __html: html } } />;
}
