import { Cloud, ExternalLink, FlaskConical, GitBranch, Play, RotateCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge, type Tone } from '../../components/Badge.tsx';
import { ProgressIcon } from '../../components/icons.tsx';
import { api, type CiBuildRun } from '../../lib/api.ts';
import { relativeTime } from '../../lib/format.ts';
import { safeExternalUrl } from '../../lib/url.ts';
import { Spinner } from '../../components/Spinner.tsx';

/** How long to keep polling after a dispatch, waiting for its run to show up. */
const DISPATCH_WATCH_MS = 60_000;

export function ciRunState( run: CiBuildRun ): { label: string; tone: Tone; icon: 'done' | 'running' | 'pending' | 'failed' } {
	if ( run.status !== 'completed' ) {
		return run.status === 'in_progress' ? { label: 'Building', tone: 'accent', icon: 'running' } : { label: 'Queued', tone: 'neutral', icon: 'pending' };
	}

	if ( run.conclusion === 'success' ) {
		return { label: 'Built', tone: 'success', icon: 'done' };
	}

	if ( run.conclusion === 'cancelled' || run.conclusion === 'skipped' ) {
		return { label: run.conclusion === 'cancelled' ? 'Cancelled' : 'Skipped', tone: 'neutral', icon: 'pending' };
	}

	return { label: 'Failed', tone: 'danger', icon: 'failed' };
}

export function CiBuildPanel() {
	const [ current, setCurrent ] = useState<string | null>( null );
	const [ branch, setBranch ] = useState( '' );
	const [ branches, setBranches ] = useState<string[]>( [] );
	const [ beta, setBeta ] = useState( false );
	const [ runs, setRuns ] = useState<CiBuildRun[] | null | undefined>( undefined );
	const [ error, setError ] = useState<string | null>( null );
	const [ notice, setNotice ] = useState<string | null>( null );
	const [ starting, setStarting ] = useState( false );
	const [ watchUntil, setWatchUntil ] = useState( 0 );
	const active = runs?.some( ( run ) => run.status !== 'completed' ) ?? false;

	const load = useCallback( async () => {
		try {
			const data = await api.ciBuilds();

			setCurrent( data.branch );
			setBranches( data.branches ?? [] );
			setRuns( data.runs );
		} catch ( caught ) {
			setError( ( caught as Error ).message );
		}
	}, [] );

	useEffect( () => {
		void load();
	}, [ load ] );

	// Follow running builds, and look for a just-dispatched one.
	useEffect( () => {
		if ( ! active && watchUntil <= Date.now() ) {
			return;
		}

		const timer = setInterval( () => void load(), active ? 10_000 : 5_000 );

		return () => clearInterval( timer );
	}, [ active, watchUntil, load ] );

	async function start() {
		const target = branch.trim() || current;

		if ( ! target ) {
			setError( 'Enter a branch to build.' );
			return;
		}

		setError( null );
		setNotice( null );
		setStarting( true );

		try {
			const { source } = await api.startCiBuild( target, beta );

			setNotice(
				source
					? `Started the beta build: master + PR #${ source.pr }'s changes, stamped ${ source.version ?? 'with the target version plus -beta' }. The zip is attached to PR #${ source.pr } once it finishes.`
					: `Started the GitHub build for ${ target }. It shows below once GitHub queues it.`
			);
			setWatchUntil( Date.now() + DISPATCH_WATCH_MS );
			await load();
		} catch ( caught ) {
			setError( ( caught as Error ).message );
		} finally {
			setStarting( false );
		}
	}

	return (
		<div className="panel">
			<header className="panel-head">
				<div className="panel-title-group">
					<h2 className="panel-title">
						<Cloud size={ 16 } /> Build on GitHub
					</h2>
					<span className="muted small">
						Runs the Build and Export Plugin workflow on a pushed branch. Only committed, pushed changes are built. The zips are attached to the run, and
						to the branch's open PR as a comment.
					</span>
				</div>
				<button type="button" className="btn btn-sm btn-icon btn-ghost" onClick={ () => void load() } title="Refresh" aria-label="Refresh GitHub builds">
					<RotateCw size={ 13 } />
				</button>
			</header>
			<div className="panel-body">
				<form
					className="build-form"
					onSubmit={ ( event ) => {
						event.preventDefault();
						void start();
					} }
				>
					<label className="ci-branch">
						<span className="field-label">Branch</span>
						<input
							type="text"
							className="input-mono"
							value={ branch }
							onChange={ ( event ) => setBranch( event.target.value ) }
							placeholder={ current ? `${ current } (current)` : 'Branch name' }
							spellCheck={ false }
							autoComplete="off"
							list="ci-branch-suggestions"
						/>
						{ /* The browser filters these as you type, newest branch first. */ }
						<datalist id="ci-branch-suggestions">
							{ branches.map( ( name ) => (
								<option key={ name } value={ name } />
							) ) }
						</datalist>
					</label>
					<div className="segmented" role="radiogroup" aria-label="How to version the build">
						<button type="button" role="radio" aria-checked={ ! beta } aria-pressed={ ! beta } onClick={ () => setBeta( false ) }>
							Normal
						</button>
						<button type="button" role="radio" aria-checked={ beta } aria-pressed={ beta } onClick={ () => setBeta( true ) }>
							<FlaskConical size={ 13 } /> Beta
						</button>
					</div>
					<button type="submit" className="btn btn-primary" disabled={ starting || ( ! branch.trim() && ! current ) }>
						<Play size={ 14 } />
						{ starting ? 'Starting…' : `${ branch.trim() ? 'Build branch' : 'Build current branch' }${ beta ? ' as beta' : '' }` }
					</button>
				</form>
				<p className="muted small ci-kind-hint">
					{ beta
						? 'Beta: the quick fix to send a customer. Built from master (what they run) plus only this branch\'s PR changes, Pro only, stamped like 4.17.6-beta so the real release updates over it. Nothing is merged or pushed; the PR still ships in its release. Needs an open PR.'
						: 'Normal: the branch as pushed, Pro and Lite. A release/* or hotfix/* branch gets the plain version; any other branch is stamped like 4.17.6-3556-branch-name.' }
				</p>
				{ error && <p className="callout callout-danger">{ error }</p> }
				{ notice && ! error && <p className="callout callout-neutral">{ notice }</p> }

				{ runs === undefined && ! error && <Spinner label="Asking GitHub for recent builds…" /> }
				{ runs === null && <p className="muted small">Could not ask GitHub for recent builds. Check that `gh` is installed and signed in.</p> }
				{ runs && runs.length > 0 && (
					<ul className="grouped-list ci-runs">
						{ runs.map( ( run ) => {
							const state = ciRunState( run );
							const url = safeExternalUrl( run.url );

							return (
								<li key={ run.id }>
									<div className="list-row">
										<a className="list-row-main" href={ url ?? undefined } target="_blank" rel="noreferrer">
											<ProgressIcon state={ state.icon } size={ 15 } />
											<span className="list-row-text">
												<span className="list-row-title">
													<GitBranch size={ 12 } className="inline-icon" /> { run.branch }
												</span>
												<span className="list-row-sub">
													{ run.commit } · { relativeTime( Date.parse( run.createdAt ) ) }
												</span>
											</span>
											<Badge tone={ state.tone }>{ state.label }</Badge>
											{ url && <ExternalLink size={ 13 } /> }
										</a>
									</div>
								</li>
							);
						} ) }
					</ul>
				) }
			</div>
		</div>
	);
}
