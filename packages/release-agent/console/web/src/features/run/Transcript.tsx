import { useMemo, useState } from 'react';
import type { TranscriptItem } from '../../lib/api.ts';
import { Markdown } from '../../components/Markdown.tsx';

type ToolItem = Extract<TranscriptItem, { kind: 'tool' }>;
type ToolResultItem = Extract<TranscriptItem, { kind: 'tool_result' }>;

function formatDuration( ms: number ): string {
	const seconds = Math.round( ms / 1000 );

	return seconds < 60 ? `${ seconds }s` : `${ Math.floor( seconds / 60 ) }m ${ seconds % 60 }s`;
}

export function formatCost( cost: number | null ): string {
	return cost === null ? '' : `$${ cost.toFixed( cost < 1 ? 3 : 2 ) }`;
}

function ToolRow( { item, result }: { item: ToolItem; result: ToolResultItem | undefined } ) {
	const [ open, setOpen ] = useState( false );
	const state = result ? ( result.ok ? 'ok' : 'error' ) : 'pending';

	return (
		<div className={ `tool tool-${ state }` }>
			<button type="button" className="tool-head" onClick={ () => setOpen( ! open ) } aria-expanded={ open } disabled={ ! result }>
				<span className="tool-dot" aria-label={ state } />
				<span className="tool-name">{ item.name }</span>
				<span className="tool-summary">{ item.summary }</span>
			</button>
			{ open && result && <pre className="tool-output">{ result.preview || '(no output)' }</pre> }
		</div>
	);
}

/** Removes the fenced `release_console` report block from a message. */
export function withoutReport( text: string ): string {
	return text.replace( /```json\s*\n\s*\{[\s\S]*?"release_console"[\s\S]*?```/g, '' ).trim();
}

export function Transcript( { items }: { items: TranscriptItem[] } ) {
	const [ showSubagents, setShowSubagents ] = useState( false );

	const results = useMemo( () => {
		const map = new Map<string, ToolResultItem>();

		items.forEach( ( item ) => {
			if ( item.kind === 'tool_result' ) {
				map.set( item.toolUseId, item );
			}
		} );

		return map;
	}, [ items ] );

	const subagentCount = items.filter( ( item ) => 'subagent' in item && item.subagent ).length;

	return (
		<div className="transcript">
			{ subagentCount > 0 && (
				<label className="subagent-toggle">
					<input type="checkbox" checked={ showSubagents } onChange={ ( event ) => setShowSubagents( event.target.checked ) } />
					Show subagent activity ({ subagentCount })
				</label>
			) }
			{ items.map( ( item ) => {
				if ( 'subagent' in item && item.subagent && ! showSubagents ) {
					return null;
				}

				const nested = 'subagent' in item && item.subagent ? ' is-subagent' : '';

				switch ( item.kind ) {
					case 'text': {
						// The command's closing report is shown as its own card, so its raw JSON is hidden here.
						const text = withoutReport( item.text );

						return text ? (
							<div key={ item.id } className={ `entry text${ nested }` }>
								<Markdown text={ text } />
							</div>
						) : null;
					}
					case 'tool':
						return (
							<div key={ item.id } className={ `entry${ nested }` }>
								<ToolRow item={ item } result={ results.get( item.id ) } />
							</div>
						);
					case 'user':
						return (
							<div key={ item.id } className="entry user">
								<span className="who">You</span>
								<p>{ item.text }</p>
							</div>
						);
					case 'result':
						return (
							<div key={ item.id } className={ `entry turn-end${ item.ok ? '' : ' is-error' }` }>
								<span>
									{ item.ok ? 'Turn finished' : `Turn failed: ${ item.text }` }
									{ item.durationMs !== null && ` · ${ formatDuration( item.durationMs ) }` }
									{ item.costUsd !== null && ` · ${ formatCost( item.costUsd ) } so far` }
								</span>
							</div>
						);
					case 'system':
						return (
							<div key={ item.id } className="entry system">
								{ item.text }
							</div>
						);
					default:
						return null;
				}
			} ) }
		</div>
	);
}

export { formatDuration };
