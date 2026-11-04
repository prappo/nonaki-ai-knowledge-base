import { createContext, useContext } from 'react';

/**
 * The product's mark, from its recipe (`brand.mark`, SVG path data in a 60×41
 * box). Without one, a generic package mark is shown.
 */

const DEFAULT_MARK =
	'M8 6h44l6 10v19a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V16zM6 16h48M24 16v7h12v-7';

export function ProductMark( { size = 20, title, mark }: { size?: number; title?: string; mark?: string | null } ) {
	const custom = Boolean( mark );

	return (
		<svg width={ size } height={ ( size * 41 ) / 60 } viewBox="0 0 60 41" fill="none" role={ title ? 'img' : undefined } aria-hidden={ title ? undefined : true }>
			{ title && <title>{ title }</title> }
			{ custom ? (
				<path fillRule="evenodd" clipRule="evenodd" d={ mark! } fill="currentColor" />
			) : (
				<path d={ DEFAULT_MARK } fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
			) }
		</svg>
	);
}

/** The current product's mark, set by the app from the console state. */
export const ProductMarkContext = createContext<string | null>( null );

/** The product's mark wherever a page shows it (builds, library), from context. */
export function ContextMark( props: { size?: number; title?: string } ) {
	return <ProductMark { ...props } mark={ useContext( ProductMarkContext ) } />;
}
