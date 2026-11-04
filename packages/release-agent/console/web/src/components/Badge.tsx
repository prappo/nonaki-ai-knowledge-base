import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

export function Badge( { tone = 'neutral', children, icon }: { tone?: Tone; children: ReactNode; icon?: ReactNode } ) {
	return (
		<span className={ `badge badge-${ tone }` }>
			{ icon }
			{ children }
		</span>
	);
}
