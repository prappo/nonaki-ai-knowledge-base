import type { ReactNode } from 'react';

export function EmptyState( { icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode } ) {
	return (
		<div className="empty">
			<div className="empty-icon">{ icon }</div>
			<p className="empty-title">{ title }</p>
			{ children && <div className="empty-body">{ children }</div> }
		</div>
	);
}
