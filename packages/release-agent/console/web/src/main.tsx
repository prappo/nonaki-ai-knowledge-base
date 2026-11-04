import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { AgentApp } from './features/agent/AgentApp.tsx';
import './styles/app.css';
import './styles/nonaki-theme.css';

// Embedded in Nonaki: follow the app's light/dark choice (?theme=light|dark;
// the Releases page also updates it live when the app's toggle changes).
const theme = new URLSearchParams( window.location.search ).get( 'theme' );

if ( theme === 'light' || theme === 'dark' ) {
	document.documentElement.dataset.theme = theme;
}

// ?view=agent: the Agent page (free-prompt Claude Code sessions) instead of the release console
const view = new URLSearchParams( window.location.search ).get( 'view' );

createRoot( document.getElementById( 'root' )! ).render(
	<StrictMode>
		{ view === 'agent' ? <AgentApp /> : <App /> }
	</StrictMode>
);
