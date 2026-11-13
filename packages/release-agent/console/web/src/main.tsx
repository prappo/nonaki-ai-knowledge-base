import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { AgentApp } from './features/agent/AgentApp.tsx';
import { MarketingApp } from './features/marketing/MarketingApp.tsx';
import './styles/app.css';
import './styles/nonaki-theme.css';
import { connectRemote, REMOTE } from './lib/remote.ts';

// Embedded in Nonaki: follow the app's light/dark choice (?theme=light|dark;
// the Releases page also updates it live when the app's toggle changes).
const theme = new URLSearchParams( window.location.search ).get( 'theme' );

if ( theme === 'light' || theme === 'dark' ) {
	document.documentElement.dataset.theme = theme;
}

// ?view=agent: the Agent page (free-prompt Claude Code sessions) instead of the release console;
// ?view=marketing: the Marketing page (promo videos made by Claude Code sessions)
const view = new URLSearchParams( window.location.search ).get( 'view' );

const root = createRoot( document.getElementById( 'root' )! );

function render() {
	root.render(
		<StrictMode>
			{ view === 'agent' ? <AgentApp /> : view === 'marketing' ? <MarketingApp /> : <App /> }
		</StrictMode>
	);
}

// In the Release Console web app: find the machine first, so every URL can be built right away.
if ( REMOTE ) {
	// Kept outside React's root, and removed once the console starts.
	const box = document.createElement( 'div' );
	box.className = 'remote-error';
	const connect = () =>
		connectRemote().then(
			() => {
				box.remove();
				render();
			},
			( error: Error ) => {
				box.textContent = error.message;
				document.body.prepend( box );
				// Try again until the machine is back.
				setTimeout( connect, 5000 );
			}
		);
	void connect();
} else {
	render();
}
