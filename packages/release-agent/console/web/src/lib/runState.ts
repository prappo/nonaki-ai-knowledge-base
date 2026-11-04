/**
 * Applies server-sent run events to the run the browser is showing.
 */

import type { Gate, RunEvent, RunSnapshot } from '../../../server/runs/runner.ts';

export type StreamEvent = RunEvent | { type: 'snapshot'; run: RunSnapshot };

export function applyRunEvent( run: RunSnapshot | null, event: StreamEvent ): RunSnapshot | null {
	if ( event.type === 'snapshot' ) {
		return event.run;
	}

	if ( ! run ) {
		return run;
	}

	switch ( event.type ) {
		case 'item':
			if ( run.items.some( ( item ) => item.id === event.item.id ) ) {
				return run;
			}

			return { ...run, items: [ ...run.items, event.item ] };
		case 'status':
			return {
				...run,
				status: event.status,
				error: event.error,
				endedAt: [ 'done', 'stopped', 'error' ].includes( event.status ) ? run.endedAt ?? Date.now() : null,
			};
		case 'gate':
			if ( run.gates.some( ( gate ) => gate.id === event.gate.id ) ) {
				return run;
			}

			return { ...run, gates: [ ...run.gates, event.gate ] };
		case 'gate_resolved':
			return { ...run, gates: run.gates.filter( ( gate: Gate ) => gate.id !== event.gateId ) };
		case 'meta':
			return { ...run, sessionId: event.sessionId, costUsd: event.costUsd, files: event.files, outcome: event.outcome };
		default:
			return run;
	}
}

export const ACTIVE_STATUSES = [ 'running', 'waiting', 'awaiting_reply' ];

export function isActive( run: RunSnapshot | null ): boolean {
	return Boolean( run && ACTIVE_STATUSES.includes( run.status ) );
}
