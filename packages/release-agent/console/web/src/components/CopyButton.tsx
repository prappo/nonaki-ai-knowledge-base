import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

export function CopyButton( { text, label }: { text: string; label: string } ) {
	const [ copied, setCopied ] = useState( false );

	return (
		<button
			type="button"
			className="btn btn-sm"
			onClick={ async () => {
				try {
					await navigator.clipboard.writeText( text );
					setCopied( true );
					setTimeout( () => setCopied( false ), 1500 );
				} catch {
					setCopied( false );
				}
			} }
		>
			{ copied ? <Check size={ 13 } /> : <Copy size={ 13 } /> }
			{ copied ? 'Copied' : label }
		</button>
	);
}
