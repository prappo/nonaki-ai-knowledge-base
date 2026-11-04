import { AlertTriangle, CheckCircle2, Info, RefreshCw, Save, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ResetPanel } from './ResetPanel.tsx';
import { ApiError, api, type ConfigIssue, type ConfigState, type HealthCheck } from '../../lib/api.ts';

function CheckIcon( { status }: { status: HealthCheck[ 'status' ] } ) {
	switch ( status ) {
		case 'ok':
			return <CheckCircle2 size={ 17 } className="icon-success" aria-label="OK" />;
		case 'fail':
			return <XCircle size={ 17 } className="icon-danger" aria-label="Problem" />;
		case 'warn':
			return <AlertTriangle size={ 17 } className="icon-warning" aria-label="Warning" />;
		default:
			return <Info size={ 17 } className="icon-muted" aria-label="Info" />;
	}
}

function SettingsForm( { onSaved }: { onSaved: () => void } ) {
	const [ state, setState ] = useState<ConfigState | null>( null );
	const [ values, setValues ] = useState<Record<string, string>>( {} );
	const [ issues, setIssues ] = useState<ConfigIssue[]>( [] );
	const [ error, setError ] = useState<string | null>( null );
	const [ saved, setSaved ] = useState( false );
	const [ busy, setBusy ] = useState( false );

	const load = ( loaded: ConfigState ) => {
		setState( loaded );
		setIssues( loaded.issues );
		setValues( Object.fromEntries( loaded.fields.map( ( item ) => [ item.key, loaded.config[ item.key ] ?? '' ] ) ) );
	};

	useEffect( () => {
		api.config()
			.then( load )
			.catch( ( caught: Error ) => setError( caught.message ) );
	}, [] );

	async function save( event: React.FormEvent ) {
		event.preventDefault();
		setBusy( true );
		setError( null );
		setSaved( false );

		try {
			load( await api.saveConfig( values ) );
			setSaved( true );
			onSaved();
		} catch ( caught ) {
			if ( caught instanceof ApiError && Array.isArray( caught.body.issues ) ) {
				// Each problem is shown next to its field.
				setIssues( caught.body.issues as ConfigIssue[] );
			} else {
				setError( ( caught as Error ).message );
			}
		} finally {
			setBusy( false );
		}
	}

	const field = ( name: ConfigIssue[ 'field' ] ) => {
		const issue = issues.find( ( item ) => item.field === name );

		return issue ? <p className={ `field-hint ${ issue.level === 'error' ? 'text-danger' : 'text-warning' }` }>{ issue.message }</p> : null;
	};

	if ( state && state.fields.length === 0 ) {
		return null;
	}

	return (
		<form className="panel" onSubmit={ save }>
			<header className="panel-head">
				<div className="panel-title-group">
					<h2 className="panel-title">Settings</h2>
					<span className="muted small">
						Saved to <code>{ state?.file ?? '…' }</code> on this machine (not committed). The release commands read the same file, so these also apply
						in the terminal.
					</span>
				</div>
			</header>
			<div className="panel-body form">
				{ ( state?.fields ?? [] ).map( ( item ) => (
					<label className="form-row" key={ item.key }>
						<span className="form-label">{ item.label }</span>
						<span className="form-control">
							<input
								className="input input-mono"
								value={ values[ item.key ] ?? '' }
								onChange={ ( event ) => setValues( ( current ) => ( { ...current, [ item.key ]: event.target.value } ) ) }
								placeholder={ item.default ?? '' }
								spellCheck={ false }
							/>
							{ item.help && <span className="field-hint">{ item.help }</span> }
							{ field( item.key ) }
						</span>
					</label>
				) ) }
				{ error && <p className="callout callout-danger">{ error }</p> }
			</div>
			<footer className="panel-foot">
				{ saved && (
					<span className="muted small">
						<CheckCircle2 size={ 13 } className="icon-success inline-icon" /> Saved
					</span>
				) }
				<button type="submit" className="btn btn-primary" disabled={ busy || ! state }>
					<Save size={ 14 } />
					{ busy ? 'Saving…' : 'Save' }
				</button>
			</footer>
		</form>
	);
}

export function SetupPage( {
	checks,
	loading,
	onRefresh,
	onSaved,
}: {
	checks: HealthCheck[] | null;
	loading: boolean;
	onRefresh: () => void;
	onSaved: () => void;
} ) {
	const problems = checks?.filter( ( item ) => item.status === 'fail' || item.status === 'warn' ).length ?? 0;

	return (
		<div className="page page-narrow">
			<div className="panel">
				<header className="panel-head">
					<div className="panel-title-group">
						<h2 className="panel-title">This machine</h2>
						<span className="muted small">
							{ checks === null ? 'Checking…' : problems ? `${ problems } thing${ problems === 1 ? '' : 's' } to look at. Nothing is blocked; affected stages show a warning.` : 'Everything the release needs is in place.' }
						</span>
					</div>
					<button type="button" className="btn btn-sm" disabled={ loading } onClick={ onRefresh }>
						<RefreshCw size={ 13 } className={ loading ? 'spin' : '' } />
						Check again
					</button>
				</header>
				<ul className="grouped-list checks">
					{ checks?.map( ( item ) => (
						<li key={ item.id } className="check-row">
							<CheckIcon status={ item.status } />
							<span className="list-row-text">
								<span className="list-row-title">{ item.label }</span>
								<span className="list-row-sub">{ item.detail }</span>
							</span>
						</li>
					) ) }
				</ul>
			</div>
			<SettingsForm onSaved={ onSaved } />
			<ResetPanel onChanged={ onSaved } />
		</div>
	);
}
