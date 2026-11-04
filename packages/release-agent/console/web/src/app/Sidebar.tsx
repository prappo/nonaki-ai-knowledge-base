import { Bell, BellOff, Boxes, FolderOpen, GitCompareArrows, History, Keyboard, ShieldCheck, Workflow } from 'lucide-react';
import { ProductMark } from '../components/Logo.tsx';
import type { ProductBrand } from '../lib/api.ts';
import type { ReactNode } from 'react';
import type { HealthCheck } from '../lib/api.ts';
import type { Page } from './useRoute.ts';

interface NavItem {
	page: Page;
	label: string;
	icon: ReactNode;
	hint: string;
}

const NAV: NavItem[] = [
	{ page: 'pipeline', label: 'Pipeline', icon: <Workflow size={ 16 } />, hint: 'Run the release stages' },
	{ page: 'library', label: 'Library', icon: <FolderOpen size={ 16 } />, hint: 'Blog posts, newsletters, notes, media and builds' },
	{ page: 'builds', label: 'Builds', icon: <Boxes size={ 16 } />, hint: 'Build the plugin zips locally' },
	{ page: 'changes', label: 'Changes', icon: <GitCompareArrows size={ 16 } />, hint: 'Uncommitted changes' },
	{ page: 'history', label: 'History', icon: <History size={ 16 } />, hint: 'Every run for this version' },
	{ page: 'setup', label: 'Setup', icon: <ShieldCheck size={ 16 } />, hint: 'Checks and settings' },
];

export function Sidebar( {
	product,
	page,
	onNavigate,
	version,
	onVersionChange,
	versionInvalid,
	versionLocked,
	branch,
	checks,
	needsYou,
	buildRunning,
	notifications,
	onShortcuts,
}: {
	product?: ProductBrand;
	page: Page;
	onNavigate: ( page: Page ) => void;
	version: string;
	onVersionChange: ( version: string ) => void;
	versionInvalid: boolean;
	versionLocked: boolean;
	branch: string | null;
	checks: HealthCheck[] | null;
	needsYou: boolean;
	buildRunning: boolean;
	notifications: { supported: boolean; enabled: boolean; toggle: () => Promise<void> };
	onShortcuts: () => void;
} ) {
	const problems = checks?.filter( ( item ) => item.status === 'fail' || item.status === 'warn' ).length ?? 0;
	const failures = checks?.filter( ( item ) => item.status === 'fail' ).length ?? 0;

	const badgeFor = ( item: NavItem ): ReactNode => {
		if ( item.page === 'pipeline' && needsYou ) {
			return <span className="nav-dot nav-dot-warning" aria-label="needs you" />;
		}

		if ( item.page === 'builds' && buildRunning ) {
			return <span className="nav-dot nav-dot-accent" aria-label="build running" />;
		}

		if ( item.page === 'setup' && problems > 0 ) {
			return <span className={ `nav-count ${ failures ? 'nav-count-danger' : 'nav-count-warning' }` }>{ problems }</span>;
		}

		return null;
	};

	return (
		<aside className="sidebar">
			<div className="brand">
				<span className="brand-mark" style={ product?.color ? { background: product.color } : undefined }>
					<ProductMark size={ 20 } title={ product?.name ?? 'Release' } mark={ product?.mark } />
				</span>
				<span>
					<span className="brand-name">{ product?.name ?? 'Release' }</span>
					<span className="brand-sub">Release Console</span>
				</span>
			</div>

			<label className="version-field">
				<span className="field-label">Release version</span>
				<input
					className="input input-mono"
					value={ version }
					onChange={ ( event ) => onVersionChange( event.target.value ) }
					placeholder="e.g. 4.17.5"
					inputMode="decimal"
					spellCheck={ false }
					disabled={ versionLocked }
					title={ versionLocked ? 'A run is in progress' : undefined }
					aria-invalid={ versionInvalid }
				/>
				{ branch && (
					<span className="branch" title="Current branch">
						<code>{ branch }</code>
					</span>
				) }
			</label>

			<nav className="nav" aria-label="Sections">
				{ NAV.map( ( item ) => (
					<button
						key={ item.page }
						type="button"
						className={ `nav-item${ page === item.page ? ' is-active' : '' }` }
						aria-current={ page === item.page ? 'page' : undefined }
						title={ item.hint }
						onClick={ () => onNavigate( item.page ) }
					>
						<span className="nav-icon">{ item.icon }</span>
						<span className="nav-label">{ item.label }</span>
						{ badgeFor( item ) }
					</button>
				) ) }
			</nav>

			<div className="sidebar-foot">
				{ notifications.supported && (
					<button
						type="button"
						className={ `nav-item nav-item-small${ notifications.enabled ? ' is-on' : '' }` }
						onClick={ () => void notifications.toggle() }
						title="Desktop notification when a run needs you and this tab is in the background"
					>
						<span className="nav-icon">{ notifications.enabled ? <Bell size={ 15 } /> : <BellOff size={ 15 } /> }</span>
						<span className="nav-label">{ notifications.enabled ? 'Notifications on' : 'Notify me' }</span>
					</button>
				) }
				<button type="button" className="nav-item nav-item-small" onClick={ onShortcuts } title="Keyboard shortcuts (?)">
					<span className="nav-icon">
						<Keyboard size={ 15 } />
					</span>
					<span className="nav-label">Shortcuts</span>
					<kbd>?</kbd>
				</button>
			</div>
		</aside>
	);
}
