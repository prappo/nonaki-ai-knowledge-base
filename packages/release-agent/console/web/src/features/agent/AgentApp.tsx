/**
 * Agent: chat with Claude Code in the repo, ChatGPT-style.
 *
 * Each conversation is a Claude Code session on the agent's machine (same
 * CLAUDE.md, commands, skills and allowlist as `claude` there). One message
 * box drives everything: it starts a chat, replies when Claude finished a
 * turn, and picks an older chat's session back up (resume) — so there's no
 * Reply / Finish / Resume to think about. Questions and approvals appear in
 * the thread.
 */

import {
	ArrowUp,
	Bot,
	ChevronRight,
	Globe,
	Loader2,
	MessageSquare,
	PanelLeftClose,
	PanelLeftOpen,
	Plus,
	ShieldCheck,
	Square,
	Trash2,
	TriangleAlert,
	Wrench,
	Zap,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Markdown } from '../../components/Markdown.tsx';
import { api, CHAT, type RunSnapshot, type RunSummary } from '../../lib/api.ts';
import { formatCost } from '../../lib/format.ts';
import { isActive } from '../../lib/runState.ts';
import { useRunStream } from '../../app/useConsole.ts';
import { GateCard } from '../run/GateCard.tsx';
import './agent.css';

type Item = RunSnapshot[ 'items' ][ number ];
type Mode = 'ask' | 'risky';

const MODE_KEY = 'release-console:agent-mode';
const SIDEBAR_KEY = 'release-console:agent-sidebar';
const CHROME_KEY = 'release-console:agent-chrome';

const SUGGESTIONS = [
	{ title: 'Explain this repo', prompt: 'Give me a short tour of this repo: what it is, how it is laid out, and where to start reading.' },
	{ title: 'Review my changes', prompt: 'Review my uncommitted changes. Point out bugs, risky edits and anything I forgot.' },
	{ title: 'Find TODOs', prompt: 'Find the TODO and FIXME comments in this repo and group them by area.' },
	{ title: 'What changed recently?', prompt: 'Summarise what changed in the last 10 commits, in plain language.' },
];

const load = <T,>( key: string, fallback: T ): T => {
	try {
		const value = localStorage.getItem( key );
		return value === null ? fallback : ( JSON.parse( value ) as T );
	} catch {
		return fallback;
	}
};
const store = ( key: string, value: unknown ) => {
	try {
		localStorage.setItem( key, JSON.stringify( value ) );
	} catch {
		/* not remembered */
	}
};

const firstLine = ( text: string, max = 60 ) => {
	const line = text.trim().split( '\n' )[ 0 ];
	return line.length > max ? `${ line.slice( 0, max - 1 ) }…` : line || 'New chat';
};

// ── conversations: a session and the sessions that resumed it are one chat ──

interface Conversation {
	/** The newest run of the chain — the one new messages go to. */
	head: RunSummary;
	title: string;
	updatedAt: number;
	cost: number;
}

function conversations( runs: RunSummary[] ): Conversation[] {
	const byId = new Map( runs.map( ( run ) => [ run.id, run ] ) );
	const resumed = new Set( runs.map( ( run ) => run.resumedFrom ).filter( Boolean ) as string[] );

	return runs
		.filter( ( run ) => ! resumed.has( run.id ) )
		.map( ( head ) => {
			let root = head;
			while ( root.resumedFrom && byId.has( root.resumedFrom ) ) {
				root = byId.get( root.resumedFrom )!;
			}
			return { head, title: firstLine( root.prompt ), updatedAt: head.endedAt ?? head.startedAt, cost: head.costUsd ?? 0 };
		} )
		.sort( ( a, b ) => b.updatedAt - a.updatedAt );
}

function dayLabel( ms: number ): string {
	const day = ( d: Date ) => new Date( d.getFullYear(), d.getMonth(), d.getDate() ).getTime();
	const diff = Math.round( ( day( new Date() ) - day( new Date( ms ) ) ) / 86_400_000 );
	if ( diff <= 0 ) return 'Today';
	if ( diff === 1 ) return 'Yesterday';
	if ( diff < 7 ) return 'Previous 7 days';
	return 'Older';
}

// ── the thread: transcript items as chat messages ───────────────────────

type Block =
	| { type: 'user'; id: string; text: string }
	| { type: 'assistant'; id: string; text: string }
	| { type: 'steps'; id: string; items: Item[] };

function toBlocks( items: Item[], firstPrompt: string | null ): Block[] {
	const blocks: Block[] = firstPrompt ? [ { type: 'user', id: 'first', text: firstPrompt } ] : [];
	let steps: Item[] = [];
	const flush = () => {
		if ( steps.length ) blocks.push( { type: 'steps', id: steps[ 0 ].id, items: steps } );
		steps = [];
	};

	for ( const item of items ) {
		if ( item.kind === 'user' ) {
			flush();
			blocks.push( { type: 'user', id: item.id, text: item.text } );
		} else if ( item.kind === 'text' && ! item.subagent ) {
			flush();
			blocks.push( { type: 'assistant', id: item.id, text: item.text } );
		} else if ( item.kind === 'tool' || item.kind === 'tool_result' || item.kind === 'text' ) {
			steps.push( item );
		}
		// "result" (turn ends) and "system" notes aren't chat messages
	}
	flush();
	return blocks;
}

function Steps( { items, working }: { items: Item[]; working: boolean } ) {
	const [ open, setOpen ] = useState( false );
	const tools = items.filter( ( item ) => item.kind === 'tool' );
	const failed = items.filter( ( item ) => item.kind === 'tool_result' && ! item.ok ).length;
	const last = tools[ tools.length - 1 ];

	return (
		<div className={ `chat-steps${ open ? ' is-open' : '' }` }>
			<button type="button" className="chat-steps-toggle" onClick={ () => setOpen( ! open ) }>
				{ working ? <Loader2 size={ 13 } className="spin" /> : <Wrench size={ 13 } /> }
				<span>
					{ working && last && last.kind === 'tool' ? `${ last.name }: ${ last.summary }` : `Worked · ${ tools.length } step${ tools.length === 1 ? '' : 's' }` }
					{ failed > 0 && <span className="chat-steps-failed"> · { failed } failed</span> }
				</span>
				<ChevronRight size={ 13 } className="chat-steps-chevron" />
			</button>
			{ open && (
				<ol className="chat-steps-list">
					{ items.map( ( item ) =>
						item.kind === 'tool' ? (
							<li key={ item.id } className={ item.subagent ? 'is-subagent' : '' }>
								<span className="chat-step-name">{ item.name }</span> <code>{ item.summary }</code>
							</li>
						) : item.kind === 'tool_result' ? (
							! item.ok && (
								<li key={ item.id } className="is-error">
									<TriangleAlert size={ 12 } /> { item.preview }
								</li>
							)
						) : item.kind === 'text' ? (
							<li key={ item.id } className="is-subagent is-note">
								{ item.text }
							</li>
						) : null
					) }
				</ol>
			) }
		</div>
	);
}

// ── composer ─────────────────────────────────────────────────────────────

function Composer( props: {
	busy: boolean;
	working: boolean;
	disabledReason: string | null;
	placeholder: string;
	showOptions: boolean;
	mode: Mode;
	onMode: ( mode: Mode ) => void;
	chrome: boolean;
	onChrome: ( value: boolean ) => void;
	/** In an open chat: switch Chrome for the next message (restarts the session with it on or off). */
	chromeSwitch?: { on: boolean; changed: boolean; disabled: boolean; onToggle: () => void } | null;
	onSend: ( text: string ) => Promise<boolean>;
	onStop: () => void;
	autoFocus?: boolean;
	prefill?: { text: string; at: number } | null;
} ) {
	const [ text, setText ] = useState( '' );
	const area = useRef<HTMLTextAreaElement>( null );

	// grow with the text, like ChatGPT's box
	useLayoutEffect( () => {
		const element = area.current;
		if ( ! element ) return;
		element.style.height = 'auto';
		element.style.height = `${ Math.min( element.scrollHeight, 240 ) }px`;
	}, [ text ] );

	const [ prefilled, setPrefilled ] = useState( props.prefill?.at ?? 0 );
	if ( props.prefill && props.prefill.at !== prefilled ) {
		setPrefilled( props.prefill.at );
		setText( props.prefill.text );
	}

	const canSend = Boolean( text.trim() ) && ! props.busy && ! props.working && ! props.disabledReason;
	const send = async () => {
		if ( ! canSend ) return;
		const value = text;
		setText( '' );
		if ( ! ( await props.onSend( value ) ) ) setText( value ); // keep it if sending failed
	};

	return (
		<div className="chat-composer-wrap">
			<form
				className="chat-composer"
				onSubmit={ ( event ) => {
					event.preventDefault();
					void send();
				} }
			>
				<textarea
					ref={ area }
					rows={ 1 }
					autoFocus={ props.autoFocus }
					value={ text }
					placeholder={ props.placeholder }
					onChange={ ( event ) => setText( event.target.value ) }
					onKeyDown={ ( event ) => {
						if ( event.key === 'Enter' && ! event.shiftKey && ! event.nativeEvent.isComposing ) {
							event.preventDefault();
							void send();
						}
					} }
				/>
				<div className="chat-composer-bar">
					{ props.showOptions ? (
						<>
							<div className="chat-pills" role="group" aria-label="Approvals">
								<button
									type="button"
									className={ props.mode === 'ask' ? 'is-on' : '' }
									onClick={ () => props.onMode( 'ask' ) }
									title="Asks before commands and file edits your allowlist doesn't cover, like the terminal"
								>
									<ShieldCheck size={ 13 } /> Ask before acting
								</button>
								<button
									type="button"
									className={ props.mode === 'risky' ? 'is-on' : '' }
									onClick={ () => props.onMode( 'risky' ) }
									title="Edits and commands go ahead; pushes, tags, releases, deletes and publishing still stop"
								>
									<Zap size={ 13 } /> Auto
								</button>
							</div>
							<button
								type="button"
								className={ `chat-pill${ props.chrome ? ' is-on' : ' is-off' }` }
								onClick={ () => props.onChrome( ! props.chrome ) }
								aria-pressed={ props.chrome }
								title={ props.chrome ? 'Claude can use your Chrome, like claude --chrome. Click to start without it.' : 'Claude can’t use Chrome in this chat. Click to turn it on.' }
							>
								<Globe size={ 13 } /> { props.chrome ? 'Chrome' : 'No Chrome' }
							</button>
						</>
					) : (
						<>
							{ props.chromeSwitch && (
								<button
									type="button"
									className={ `chat-pill${ props.chromeSwitch.on ? ' is-on' : ' is-off' }${ props.chromeSwitch.changed ? ' is-changed' : '' }` }
									onClick={ props.chromeSwitch.onToggle }
									disabled={ props.chromeSwitch.disabled }
									aria-pressed={ props.chromeSwitch.on }
									title={
										props.chromeSwitch.disabled
											? 'Wait for Claude to finish this turn to switch Chrome.'
											: props.chromeSwitch.changed
												? `Your next message restarts this session ${ props.chromeSwitch.on ? 'with' : 'without' } Chrome. Click to undo.`
												: props.chromeSwitch.on
													? 'Claude can use your Chrome in this chat. Click to drop it for the next message.'
													: 'Claude can’t use Chrome in this chat. Click to turn it on for the next message.'
									}
								>
									<Globe size={ 13 } />
									{ props.chromeSwitch.changed ? ( props.chromeSwitch.on ? 'Chrome on next message' : 'Chrome off next message' ) : props.chromeSwitch.on ? 'Chrome' : 'No Chrome' }
								</button>
							) }
							<span className="chat-composer-hint">{ props.disabledReason ?? 'Enter to send · Shift+Enter for a new line' }</span>
						</>
					) }
					<span className="chat-spacer" />
					{ props.working ? (
						<button type="button" className="chat-send is-stop" onClick={ props.onStop } title="Stop">
							<Square size={ 13 } fill="currentColor" />
						</button>
					) : (
						<button type="submit" className="chat-send" disabled={ ! canSend } title="Send">
							{ props.busy ? <Loader2 size={ 16 } className="spin" /> : <ArrowUp size={ 17 } /> }
						</button>
					) }
				</div>
			</form>
			{ props.showOptions && props.disabledReason && <p className="chat-composer-note">{ props.disabledReason }</p> }
		</div>
	);
}

// ── the page ─────────────────────────────────────────────────────────────

export function AgentApp() {
	const [ runs, setRuns ] = useState<RunSummary[]>( [] );
	const [ current, setCurrent ] = useState<RunSnapshot | null>( null );
	const [ selected, setSelected ] = useState<string | null>( null );
	const [ loaded, setLoaded ] = useState( false );
	const [ error, setError ] = useState<string | null>( null );
	const [ busy, setBusy ] = useState( false );
	const [ mode, setMode ] = useState<Mode>( () => ( load<string>( MODE_KEY, 'ask' ) === 'risky' ? 'risky' : 'ask' ) );
	// Chrome is on by default, like every other MCP server; turning it off is remembered
	const [ chrome, setChromeState ] = useState( () => load( CHROME_KEY, true ) );
	const setChrome = ( value: boolean ) => {
		setChromeState( value );
		store( CHROME_KEY, value );
	};
	const [ sidebar, setSidebar ] = useState( () => load( SIDEBAR_KEY, true ) );
	const [ prefill, setPrefill ] = useState<{ text: string; at: number } | null>( null );
	const live = useRunStream( selected, CHAT );
	const scroller = useRef<HTMLDivElement>( null );
	const pinned = useRef( true );

	const refresh = useCallback( async () => {
		try {
			const result = await api.chats();
			setRuns( result.runs );
			setCurrent( result.run );
			setError( null );
			return result;
		} catch ( caught ) {
			setError( ( caught as Error ).message );
			return null;
		} finally {
			setLoaded( true );
		}
	}, [] );

	useEffect( () => {
		void refresh().then( ( result ) => {
			if ( result?.run && isActive( result.run ) ) setSelected( result.run.id );
		} );
		const timer = setInterval( () => void refresh(), 4000 );
		return () => clearInterval( timer );
	}, [ refresh ] );

	const chats = useMemo( () => conversations( runs ), [ runs ] );
	const shown = live && live.id === selected ? live : null;
	const working = Boolean( shown && ( shown.status === 'running' || shown.status === 'waiting' ) && shown.gates.length === 0 );
	const otherActive = current && isActive( current ) && current.id !== selected ? current : null;

	// the chat's first message: the root session's prompt (later ones are transcript items)
	const firstPrompt = useMemo( () => {
		if ( ! shown ) return null;
		const byId = new Map( runs.map( ( run ) => [ run.id, run ] ) );
		let root: { prompt: string; resumedFrom: string | null } = shown;
		while ( root.resumedFrom && byId.has( root.resumedFrom ) ) root = byId.get( root.resumedFrom )!;
		return root.resumedFrom ? null : root.prompt;
	}, [ shown, runs ] );
	const blocks = useMemo( () => ( shown ? toBlocks( shown.items, firstPrompt ) : [] ), [ shown, firstPrompt ] );

	// Chrome for the open chat's next message: starts as the session has it, reset when another chat opens
	const shownChrome = shown?.stageId === 'chat-chrome';
	const chromeKey = shown ? `${ shown.id }:${ shown.stageId }` : '';
	const [ nextChrome, setNextChrome ] = useState<{ key: string; on: boolean }>( { key: '', on: false } );
	const wantChrome = nextChrome.key === chromeKey ? nextChrome.on : shownChrome;

	// stick to the bottom while new messages arrive, unless the user scrolled up
	useLayoutEffect( () => {
		const element = scroller.current;
		if ( element && pinned.current ) element.scrollTop = element.scrollHeight;
	}, [ blocks.length, shown?.gates.length, shown?.status, working ] );

	const choose = ( id: string | null ) => {
		pinned.current = true;
		setSelected( id );
	};

	// which chat (head run id) or "all" is asking "delete?", and whether it's being deleted
	const [ confirmDelete, setConfirmDelete ] = useState<string | null>( null );
	const [ deleting, setDeleting ] = useState( false );

	async function deleteChat( headId: string ) {
		setDeleting( true );
		try {
			const { deleted } = await api.deleteChat( headId );
			if ( selected && deleted.includes( selected ) ) choose( null );
			setConfirmDelete( null );
			await refresh();
		} catch ( caught ) {
			setError( ( caught as Error ).message );
		} finally {
			setDeleting( false );
		}
	}

	async function deleteAllChats() {
		setDeleting( true );
		try {
			await api.deleteAllChats();
			choose( null );
			setConfirmDelete( null );
			await refresh();
		} catch ( caught ) {
			setError( ( caught as Error ).message );
		} finally {
			setDeleting( false );
		}
	}

	/** Free the repo's one session slot: finish another chat that's waiting for a reply. */
	async function freeSlot(): Promise<void> {
		if ( ! otherActive ) return;
		if ( otherActive.status === 'awaiting_reply' && otherActive.gates.length === 0 ) {
			await api.finish( otherActive.id, CHAT );
			return;
		}
		throw new Error( 'Claude is still working in another chat. Wait for it, or open it and press Stop.' );
	}

	async function send( text: string ): Promise<boolean> {
		setBusy( true );
		setError( null );
		pinned.current = true;
		try {
			if ( ! shown ) {
				await freeSlot();
				const { run } = await api.startChat( text, mode, chrome );
				choose( run.id );
			} else if ( wantChrome !== shownChrome ) {
				// The session's MCP servers are fixed when it starts: pick it back up with Chrome switched.
				// A session waiting for a reply is finished first, on the server.
				if ( isActive( shown ) && ! ( shown.status === 'awaiting_reply' && shown.gates.length === 0 ) ) {
					throw new Error( 'Wait for Claude to finish this turn, then switch Chrome.' );
				}
				if ( ! shown.sessionId ) throw new Error( 'This chat ended before Claude started, so it can’t continue. Start a new chat.' );
				if ( ! isActive( shown ) ) await freeSlot();
				const { run } = await api.resume( shown.id, text, CHAT, wantChrome );
				choose( run.id );
			} else if ( shown.status === 'awaiting_reply' && shown.gates.length === 0 ) {
				await api.reply( shown.id, text, CHAT );
			} else if ( isActive( shown ) ) {
				throw new Error( 'Claude is still working on this chat.' );
			} else {
				if ( ! shown.sessionId ) throw new Error( 'This chat ended before Claude started, so it can’t continue. Start a new chat.' );
				await freeSlot();
				const { run } = await api.resume( shown.id, text, CHAT );
				choose( run.id );
			}
			void refresh();
			return true;
		} catch ( caught ) {
			setError( ( caught as Error ).message );
			return false;
		} finally {
			setBusy( false );
		}
	}

	async function act( action: () => Promise<unknown> ) {
		try {
			await action();
		} catch ( caught ) {
			setError( ( caught as Error ).message );
		}
	}

	const chooseMode = ( next: Mode ) => {
		setMode( next );
		store( MODE_KEY, next );
	};
	const toggleSidebar = () => {
		setSidebar( ! sidebar );
		store( SIDEBAR_KEY, ! sidebar );
	};

	const waitingGate = shown?.gates[ 0 ] ?? null;
	const disabledReason = waitingGate
		? waitingGate.type === 'question'
			? 'Answer Claude’s question above to continue.'
			: 'Allow or deny the action above to continue.'
		: null;
	const total = chats.reduce( ( sum, chat ) => sum + chat.cost, 0 );
	let lastGroup = '';

	return (
		<div className={ `chat-app${ sidebar ? '' : ' is-collapsed' }` }>
			{ sidebar && (
				<aside className="chat-sidebar">
					<div className="chat-sidebar-top">
						<button type="button" className="chat-icon-btn" onClick={ toggleSidebar } title="Hide chats">
							<PanelLeftClose size={ 17 } />
						</button>
						<button type="button" className="chat-new" onClick={ () => choose( null ) }>
							<Plus size={ 15 } /> New chat
						</button>
					</div>
					<nav className="chat-list" aria-label="Chats">
						{ loaded && chats.length === 0 && <p className="chat-list-empty">Your chats appear here.</p> }
						{ chats.map( ( chat ) => {
							const group = dayLabel( chat.updatedAt );
							const heading = group !== lastGroup ? group : null;
							lastGroup = group;
							const state = chat.head.status;
							const busy = state === 'running' || state === 'waiting' || state === 'awaiting_reply';
							const asking = confirmDelete === chat.head.id;
							return (
								<div key={ chat.head.id }>
									{ heading && <div className="chat-list-group">{ heading }</div> }
									{ asking ? (
										<div className="chat-list-confirm" role="group" aria-label={ `Delete ${ chat.title }?` }>
											<span className="chat-list-title">Delete this chat?</span>
											<button type="button" className="chat-confirm-btn is-danger" disabled={ deleting } onClick={ () => void deleteChat( chat.head.id ) }>
												{ deleting ? 'Deleting…' : 'Delete' }
											</button>
											<button type="button" className="chat-confirm-btn" disabled={ deleting } onClick={ () => setConfirmDelete( null ) }>
												Cancel
											</button>
										</div>
									) : (
										<div className={ `chat-list-row${ selected === chat.head.id || shown?.resumedFrom === chat.head.id ? ' is-selected' : '' }` }>
											<button
												type="button"
												className="chat-list-item"
												onClick={ () => choose( chat.head.id ) }
												title={ chat.title }
											>
												{ chat.head.stageId === 'chat-chrome' ? <Globe size={ 14 } /> : <MessageSquare size={ 14 } /> }
												<span className="chat-list-title">{ chat.title }</span>
												{ ( state === 'running' || state === 'waiting' ) && <span className={ `chat-dot${ state === 'waiting' ? ' is-waiting' : '' }` } /> }
											</button>
											<button
												type="button"
												className="chat-list-delete"
												disabled={ busy }
												onClick={ () => setConfirmDelete( chat.head.id ) }
												title={ busy ? 'Stop or finish this chat before deleting it' : 'Delete chat' }
												aria-label={ `Delete ${ chat.title }` }
											>
												<Trash2 size={ 13 } />
											</button>
										</div>
									) }
								</div>
							);
						} ) }
					</nav>
					{ chats.length > 0 && (
						<div className="chat-sidebar-foot">
							{ confirmDelete === 'all' ? (
								<div className="chat-foot-confirm" role="group" aria-label="Delete all chats?">
									<span>Delete all { chats.length } chats?</span>
									<button type="button" className="chat-confirm-btn is-danger" disabled={ deleting } onClick={ () => void deleteAllChats() }>
										{ deleting ? 'Deleting…' : 'Delete all' }
									</button>
									<button type="button" className="chat-confirm-btn" disabled={ deleting } onClick={ () => setConfirmDelete( null ) }>
										Cancel
									</button>
								</div>
							) : (
								<>
									<span>
										{ formatCost( total ) || '$0' } across { chats.length } chat{ chats.length === 1 ? '' : 's' }
									</span>
									<button
										type="button"
										className="chat-foot-delete"
										disabled={ Boolean( current && isActive( current ) ) }
										title={ current && isActive( current ) ? 'Stop or finish the running chat first' : 'Delete every chat' }
										onClick={ () => setConfirmDelete( 'all' ) }
									>
										Delete all
									</button>
								</>
							) }
						</div>
					) }
				</aside>
			) }

			<main className="chat-main">
				{ ! sidebar && (
					<button type="button" className="chat-icon-btn chat-sidebar-open" onClick={ toggleSidebar } title="Show chats">
						<PanelLeftOpen size={ 17 } />
					</button>
				) }

				{ ! selected ? (
					<div className="chat-welcome">
						<div className="chat-welcome-mark">
							<Bot size={ 26 } />
						</div>
						<h1>What should Claude do?</h1>
						<p>
							Claude Code works in this repo on the agent’s machine — the same CLAUDE.md, slash commands, skills and allowlist as <code>claude</code> in a terminal there.
						</p>
						<Composer
							busy={ busy }
							working={ false }
							disabledReason={ otherActive && otherActive.status !== 'awaiting_reply' ? 'Claude is still working in another chat.' : null }
							placeholder="Message Claude, or type a slash command like /review"
							showOptions
							mode={ mode }
							onMode={ chooseMode }
							chrome={ chrome }
							onChrome={ setChrome }
							onSend={ send }
							onStop={ () => {} }
							autoFocus
							prefill={ prefill }
						/>
						<div className="chat-suggestions">
							{ SUGGESTIONS.map( ( item ) => (
								<button key={ item.title } type="button" onClick={ () => setPrefill( { text: item.prompt, at: Date.now() } ) }>
									<strong>{ item.title }</strong>
									<span>{ item.prompt }</span>
								</button>
							) ) }
						</div>
						{ error && <p className="chat-error">{ error }</p> }
					</div>
				) : (
					<>
						<div
							className="chat-scroll"
							ref={ scroller }
							onScroll={ ( event ) => {
								const element = event.currentTarget;
								pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
							} }
						>
							<div className="chat-thread">
								{ ! shown && <div className="chat-loading"><Loader2 size={ 18 } className="spin" /></div> }
								{ shown && (
									<div className="chat-session-meta">
										{ shown.permissions === 'ask' ? <ShieldCheck size={ 12 } /> : <Zap size={ 12 } /> }
										{ shown.permissions === 'ask' ? 'Ask before acting' : 'Auto' }
										{ shown.stageId === 'chat-chrome' ? (
											' · Chrome'
										) : (
											<span className="chat-meta-nochrome" title="This session can’t use your browser. Switch Chrome on below to continue it with Chrome.">
												{ ' · No Chrome' }
											</span>
										) }
										{ shown.costUsd !== null && ` · ${ formatCost( shown.costUsd ) }` }
									</div>
								) }
								{ blocks.map( ( block, index ) =>
									block.type === 'user' ? (
										<div key={ block.id } className="chat-msg is-user">
											<div className="chat-bubble">{ block.text }</div>
										</div>
									) : block.type === 'assistant' ? (
										<div key={ block.id } className="chat-msg is-assistant">
											<div className="chat-avatar"><Bot size={ 15 } /></div>
											<div className="chat-content"><Markdown text={ block.text } /></div>
										</div>
									) : (
										<div key={ block.id } className="chat-msg is-assistant is-steps">
											<div className="chat-avatar is-quiet"><Wrench size={ 13 } /></div>
											<div className="chat-content">
												<Steps items={ block.items } working={ working && index === blocks.length - 1 } />
											</div>
										</div>
									)
								) }
								{ working && blocks[ blocks.length - 1 ]?.type !== 'steps' && (
									<div className="chat-msg is-assistant">
										<div className="chat-avatar"><Bot size={ 15 } /></div>
										<div className="chat-content"><span className="chat-typing"><i /><i /><i /></span></div>
									</div>
								) }
								{ shown?.gates.map( ( gate ) => (
									<div key={ gate.id } className="chat-gate">
										<GateCard
											gate={ gate }
											onAnswer={ ( answers ) => act( () => api.answerQuestion( shown.id, gate.id, answers, CHAT ) ) }
											onDecide={ ( allow, message, confirm ) =>
												act( () => api.answerApproval( shown.id, gate.id, allow, message || undefined, confirm || undefined, CHAT ) )
											}
										/>
									</div>
								) ) }
								{ shown?.error && <p className="chat-error">{ shown.error }</p> }
								{ shown && shown.status === 'interrupted' && <p className="chat-note">The agent restarted during this chat. Send a message to pick it back up.</p> }
							</div>
						</div>
						<div className="chat-bottom">
							{ error && <p className="chat-error">{ error }</p> }
							<Composer
								busy={ busy }
								working={ working }
								disabledReason={ disabledReason }
								placeholder={ shown && ! isActive( shown ) ? 'Message Claude to continue this chat' : 'Message Claude' }
								showOptions={ false }
								mode={ mode }
								onMode={ chooseMode }
								chrome={ chrome }
								onChrome={ setChrome }
								chromeSwitch={
									shown
										? {
												on: wantChrome,
												changed: wantChrome !== shownChrome,
												disabled: working || busy,
												onToggle: () => setNextChrome( { key: chromeKey, on: ! wantChrome } ),
										  }
										: null
								}
								onSend={ send }
								onStop={ () => shown && void act( () => api.stop( shown.id, CHAT ) ) }
							/>
							<p className="chat-disclaimer">Claude works in your repo. Review what it changes before you commit.</p>
						</div>
					</>
				) }
			</main>
		</div>
	);
}
