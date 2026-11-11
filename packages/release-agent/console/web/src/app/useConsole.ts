/**
 * The console's shared state: the version being released, stage status and
 * run history from the server, the live run's event stream, the setup checks
 * and any "Run all" sequence. Every page reads from here.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, type ConsoleState, type HealthCheck, type RunSnapshot, type StageState, linkUrl } from '../lib/api.ts';
import { applyRunEvent, isActive, type StreamEvent } from '../lib/runState.ts';

const VERSION_KEY = 'release-console:version';
export const VERSION_PATTERN = /^\d+\.\d+\.\d+(\.\d+)?$/;

function loadVersion(): string {
	try {
		return localStorage.getItem( VERSION_KEY ) ?? '';
	} catch {
		return '';
	}
}

function saveVersion( version: string ): void {
	try {
		localStorage.setItem( VERSION_KEY, version );
	} catch {
		// Private windows can block storage; the version just won't be remembered.
	}
}

/**
 * Follows a run's event stream. The stream starts with a full snapshot, so
 * the id is all that's needed, and a reconnect repairs any missed events.
 */
export function useRunStream( runId: string | null, base = '/api/runs' ): RunSnapshot | null {
	const [ run, setRun ] = useState<RunSnapshot | null>( null );
	// Bumped to reopen a stream the browser gave up on (e.g. its URL token ran out).
	const [ attempt, setAttempt ] = useState( 0 );

	useEffect( () => {
		setRun( null );

		if ( ! runId ) {
			return;
		}

		const source = new EventSource( linkUrl( `${ base }/${ runId }/events` ) );
		let retry: ReturnType<typeof setTimeout> | undefined;

		source.onmessage = ( message ) => {
			try {
				const event = JSON.parse( message.data ) as StreamEvent;
				setRun( ( current ) => applyRunEvent( current, event ) );
			} catch {
				// Ignore a malformed frame; the snapshot on reconnect repairs state.
			}
		};

		// The browser reconnects by itself, except after an error status: then open a new one.
		source.onerror = () => {
			if ( source.readyState === EventSource.CLOSED ) {
				retry = setTimeout( () => setAttempt( ( n ) => n + 1 ), 3000 );
			}
		};

		return () => {
			clearTimeout( retry );
			source.close();
		};
	}, [ runId, base, attempt ] );

	return run;
}

export interface ConsoleModel {
	version: string;
	setVersion: ( version: string ) => void;
	validVersion: string;
	state: ConsoleState | null;
	error: string | null;
	setError: ( message: string | null ) => void;
	refresh: () => Promise<void>;
	checks: HealthCheck[] | null;
	checksLoading: boolean;
	loadChecks: () => Promise<void>;
	/** The live (most recent) run. */
	latest: RunSnapshot | null;
	/** The run being looked at: an older one from history, or the latest. */
	shown: RunSnapshot | null;
	viewRun: ( id: string | null ) => void;
	active: boolean;
	needsYou: boolean;
	/** Starts a stage; `buildId` runs it against a local build instead of the CI build. */
	startStage: ( stage: StageState, confirm: string, buildId?: string ) => Promise<boolean>;
	startSequence: ( stage: StageState, skipDone: boolean ) => Promise<boolean>;
	sequenceAction: ( action: () => Promise<unknown> ) => Promise<void>;
	showRun: ( run: RunSnapshot ) => void;
	stageTitle: ( id: string ) => string;
}

export function useConsole(): ConsoleModel {
	const [ version, setVersion ] = useState( loadVersion );
	const [ state, setState ] = useState<ConsoleState | null>( null );
	const [ error, setError ] = useState<string | null>( null );
	const [ viewRunId, setViewRunId ] = useState<string | null>( null );
	const [ checks, setChecks ] = useState<HealthCheck[] | null>( null );
	const [ checksLoading, setChecksLoading ] = useState( false );
	const validVersion = VERSION_PATTERN.test( version.trim() ) ? version.trim() : '';

	const refresh = useCallback( async () => {
		try {
			setState( await api.state( validVersion ) );
			setError( null );
		} catch ( caught ) {
			setError( ( caught as Error ).message );
		}
	}, [ validVersion ] );

	const loadChecks = useCallback( async () => {
		setChecksLoading( true );

		try {
			setChecks( ( await api.health( validVersion ) ).checks );
		} catch ( caught ) {
			setError( ( caught as Error ).message );
		} finally {
			setChecksLoading( false );
		}
	}, [ validVersion ] );

	useEffect( () => {
		void loadChecks();
	}, [ loadChecks ] );

	useEffect( () => {
		saveVersion( version );
		const timer = setTimeout( refresh, 250 );

		return () => clearTimeout( timer );
	}, [ version, refresh ] );

	const latestId = state?.run?.id ?? null;
	const latest = useRunStream( latestId );
	const viewed = useRunStream( viewRunId && viewRunId !== latestId ? viewRunId : null );
	const shown = viewRunId && viewRunId !== latestId ? viewed : latest;
	const active = isActive( latest );
	const needsYou = Boolean( latest && ( latest.gates.length > 0 || latest.status === 'awaiting_reply' ) );

	// Stage status and history come from disk, so re-read them whenever the live run changes status.
	useEffect( () => {
		if ( latest ) {
			void refresh();
		}

		if ( latest && ! isActive( latest ) ) {
			void loadChecks();
		}
	}, [ latest?.status ] );

	useEffect( () => {
		document.title = needsYou ? '● Needs you · Release Console' : 'Release Console';
	}, [ needsYou ] );

	const sequenceActive = state?.sequence?.status === 'running' || state?.sequence?.status === 'paused';

	// A sequence starts the next stage on the server; poll so the new run shows up.
	useEffect( () => {
		if ( ! sequenceActive ) {
			return;
		}

		const timer = setInterval( () => void refresh(), 2000 );

		return () => clearInterval( timer );
	}, [ sequenceActive, refresh ] );

	function showRun( run: RunSnapshot ) {
		setState( ( current ) => ( current ? { ...current, run } : current ) );
		setViewRunId( null );
	}

	async function startStage( stage: StageState, confirm: string, buildId?: string ): Promise<boolean> {
		if ( ! validVersion ) {
			return false;
		}

		setError( null );

		try {
			showRun( ( await api.startRun( stage.id, validVersion, confirm || undefined, buildId ) ).run );
			return true;
		} catch ( caught ) {
			setError( ( caught as Error ).message );
			return false;
		}
	}

	async function startSequence( stage: StageState, skipDone: boolean ): Promise<boolean> {
		setError( null );

		try {
			await api.startSequence( validVersion, stage.id, skipDone );
			setViewRunId( null );
			await refresh();
			return true;
		} catch ( caught ) {
			setError( ( caught as Error ).message );
			return false;
		}
	}

	async function sequenceAction( action: () => Promise<unknown> ) {
		try {
			await action();
			await refresh();
		} catch ( caught ) {
			setError( ( caught as Error ).message );
		}
	}

	return {
		version,
		setVersion,
		validVersion,
		state,
		error,
		setError,
		refresh,
		checks,
		checksLoading,
		loadChecks,
		latest,
		shown,
		viewRun: ( id ) => setViewRunId( id === latestId ? null : id ),
		active,
		needsYou,
		startStage,
		startSequence,
		sequenceAction,
		showRun,
		stageTitle: ( id ) => state?.stages.find( ( stage ) => stage.id === id )?.title ?? id,
	};
}
