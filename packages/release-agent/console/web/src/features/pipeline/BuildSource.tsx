import { AlertTriangle, Package } from 'lucide-react';
import type { LocalBuildChoice, StageState } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/format.ts';

/** Which build a stage like Compare builds runs against. */
export type BuildSourceValue = { kind: 'ci' } | { kind: 'local'; buildId: string | null };

/** The local build a choice resolves to: the one picked, else the newest. Null for CI, or when there is none. */
export function selectedLocalBuild( stage: StageState, value: BuildSourceValue ): LocalBuildChoice | null {
	if ( value.kind !== 'local' ) {
		return null;
	}

	return stage.localBuilds.find( ( build ) => build.id === value.buildId ) ?? stage.localBuilds[ 0 ] ?? null;
}

export function buildLabel( build: LocalBuildChoice ): string {
	return [
		build.endedAt ? formatDateTime( build.endedAt ) : build.id,
		build.version ?? 'unknown version',
		build.commit ? `${ build.commit }${ build.changes > 0 ? ` + ${ build.changes } uncommitted` : '' }` : null,
		build.lite ? 'Pro + Lite' : 'Pro only',
	]
		.filter( Boolean )
		.join( ' · ' );
}

export function BuildSource( {
	stage,
	version,
	value,
	onChange,
}: {
	stage: StageState;
	version: string;
	value: BuildSourceValue;
	onChange: ( value: BuildSourceValue ) => void;
} ) {
	const selected = selectedLocalBuild( stage, value );

	return (
		<div className="build-source">
			<div className="build-source-head">
				<span className="field-label">Compare against</span>
				<div className="segmented" role="group" aria-label="Build to compare">
					<button type="button" className="btn" aria-pressed={ value.kind === 'ci' } onClick={ () => onChange( { kind: 'ci' } ) }>
						CI build
					</button>
					<button
						type="button"
						className="btn"
						aria-pressed={ value.kind === 'local' }
						onClick={ () => onChange( { kind: 'local', buildId: selected?.id ?? stage.localBuilds[ 0 ]?.id ?? null } ) }
					>
						Local build
					</button>
				</div>
			</div>

			{ value.kind === 'ci' && <p className="note">Downloads the newest CI build of the release branch from GitHub Actions.</p> }

			{ value.kind === 'local' &&
				( stage.localBuilds.length === 0 ? (
					<p className="callout callout-warning">
						<AlertTriangle size={ 14 } />
						<span>
							There are no finished local builds yet. Build the plugin on the <a href="#/builds">Builds page</a>, then come back.
						</span>
					</p>
				) : (
					<>
						<label className="build-source-select">
							<Package size={ 14 } className="icon-muted" aria-hidden="true" />
							<select className="input" value={ selected?.id ?? '' } onChange={ ( event ) => onChange( { kind: 'local', buildId: event.target.value } ) } aria-label="Local build">
								{ stage.localBuilds.map( ( build ) => (
									<option key={ build.id } value={ build.id }>
										{ buildLabel( build ) }
									</option>
								) ) }
							</select>
						</label>
						{ selected && selected.version && selected.version !== version && (
							<p className="callout callout-warning">
								<AlertTriangle size={ 14 } />
								<span>
									This build is { selected.version }, not { version }. The version check will flag it. Build again after Prep to compare the release itself.
								</span>
							</p>
						) }
						{ selected && selected.changes > 0 && (
							<p className="note">
								Built with { selected.changes } uncommitted file{ selected.changes === 1 ? '' : 's' } on top of <code>{ selected.commit }</code>. The run
								checks build changes against both the commits and those files.
							</p>
						) }
						{ selected && ! selected.lite && <p className="note">This build has no Lite zip, so the Lite checks are skipped.</p> }
					</>
				) ) }
		</div>
	);
}
