import { useEffect, useRef, useState } from 'react';

export interface Shortcut {
	keys: string;
	description: string;
}

/**
 * Single-key shortcuts only fire outside text fields, and never approve
 * anything: allowing a risky command always takes a click (and, for permanent
 * actions, the typed version).
 */
export const SHORTCUTS: Shortcut[] = [
	{ keys: '1 – 6', description: 'Pipeline, Library, Builds, Changes, History, Setup' },
	{ keys: 'n', description: 'Jump to whatever needs you (a question, an approval or a reply)' },
	{ keys: 'r', description: 'Re-check the setup and reload stage status' },
	{ keys: ',', description: 'Setup and settings' },
	{ keys: '?', description: 'Show these shortcuts' },
	{ keys: 'Esc', description: 'Close a dialog' },
	{ keys: '⌘/Ctrl + Enter', description: 'Send a reply or resume (in the reply box)' },
	{ keys: '⌘/Ctrl + S', description: 'Save (in the file editor)' },
];

/** Whether a key press belongs to a text field rather than to the page. */
export function isTypingTarget( target: EventTarget | null ): boolean {
	if ( ! target || typeof ( target as HTMLElement ).tagName !== 'string' ) {
		return false;
	}

	const element = target as HTMLElement;
	const tag = element.tagName.toLowerCase();

	if ( tag === 'textarea' || tag === 'select' || element.isContentEditable ) {
		return true;
	}

	if ( tag === 'input' ) {
		const type = ( element as HTMLInputElement ).type;

		return ! [ 'checkbox', 'radio', 'button', 'submit', 'reset' ].includes( type );
	}

	return false;
}

/** Calls `handlers[key]` for single-key shortcuts pressed outside text fields. */
export function useShortcuts( handlers: Record<string, () => void> ): void {
	const latest = useRef( handlers );

	latest.current = handlers;

	useEffect( () => {
		const onKey = ( event: KeyboardEvent ) => {
			if ( event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented || isTypingTarget( event.target ) ) {
				return;
			}

			const handler = latest.current[ event.key ];

			if ( handler ) {
				event.preventDefault();
				handler();
			}
		};

		window.addEventListener( 'keydown', onKey );

		return () => window.removeEventListener( 'keydown', onKey );
	}, [] );
}

export function ShortcutHelp( { onClose }: { onClose: () => void } ) {
	useEffect( () => {
		const onKey = ( event: KeyboardEvent ) => event.key === 'Escape' && onClose();

		window.addEventListener( 'keydown', onKey );

		return () => window.removeEventListener( 'keydown', onKey );
	}, [ onClose ] );

	return (
		<div className="overlay" role="presentation" onMouseDown={ ( event ) => event.target === event.currentTarget && onClose() }>
			<div className="dialog" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
				<header className="dialog-head">
					<h2 id="shortcuts-title">Keyboard shortcuts</h2>
					<button type="button" className="btn btn-sm" onClick={ onClose } autoFocus>
						Close
					</button>
				</header>
				<table className="shortcuts">
					<tbody>
						{ SHORTCUTS.map( ( shortcut ) => (
							<tr key={ shortcut.keys }>
								<td>
									<kbd>{ shortcut.keys }</kbd>
								</td>
								<td>{ shortcut.description }</td>
							</tr>
						) ) }
					</tbody>
				</table>
				<p className="muted small-text">There is no shortcut for Allow, on purpose: approving a risky command always takes a click.</p>
			</div>
		</div>
	);
}

const NOTIFY_KEY = 'release-console:notify';

function storedPreference(): boolean {
	try {
		return localStorage.getItem( NOTIFY_KEY ) === '1';
	} catch {
		return false;
	}
}

/**
 * Desktop notifications when a run starts needing you while the console's tab
 * is in the background. Off until turned on, because the browser asks for
 * permission.
 */
export function useNeedsYouNotification( needsYou: boolean, message: string ): {
	supported: boolean;
	enabled: boolean;
	toggle: () => Promise<void>;
} {
	const supported = typeof window !== 'undefined' && 'Notification' in window;
	const [ enabled, setEnabled ] = useState( () => supported && storedPreference() && Notification.permission === 'granted' );
	const previous = useRef( needsYou );

	useEffect( () => {
		if ( enabled && needsYou && ! previous.current && document.hidden ) {
			try {
				const notification = new Notification( 'Release Console needs you', { body: message, tag: 'release-console' } );

				notification.onclick = () => {
					window.focus();
					notification.close();
				};
			} catch {
				// Some browsers only allow notifications from a service worker; skip quietly.
			}
		}

		previous.current = needsYou;
	}, [ needsYou, enabled, message ] );

	async function toggle() {
		if ( ! supported ) {
			return;
		}

		const next = ! enabled && ( Notification.permission === 'granted' || ( await Notification.requestPermission() ) === 'granted' );

		setEnabled( next );

		try {
			localStorage.setItem( NOTIFY_KEY, next ? '1' : '0' );
		} catch {
			// Not remembered in private windows; it still works for this visit.
		}
	}

	return { supported, enabled, toggle };
}
