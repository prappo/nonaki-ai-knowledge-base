import { Loader2 } from 'lucide-react';

/**
 * Shown while data loads from the API. `block` centres it in the space the
 * content will fill; inline it sits in a line of text. The label is read out
 * to screen readers and, unless `quiet`, shown next to the spinner.
 */
export function Spinner( { label = 'Loading…', block = false, quiet = false, size }: { label?: string; block?: boolean; quiet?: boolean; size?: number } ) {
	return (
		<span className={ `spinner${ block ? ' spinner-block' : '' }` } role="status" aria-live="polite">
			<Loader2 size={ size ?? ( block ? 20 : 14 ) } className="spin" aria-hidden="true" />
			{ quiet ? <span className="visually-hidden">{ label }</span> : <span>{ label }</span> }
		</span>
	);
}
