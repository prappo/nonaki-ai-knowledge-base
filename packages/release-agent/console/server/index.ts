/**
 * Release Console server for one repo, started by release-agent.
 *
 * Ported from the WP Simple Pay Release Console's entry point. It listens on
 * 127.0.0.1 only, on a free port, and the agent tunnels the control server's
 * UI requests to it — so the console's own Host/Origin checks still guard it.
 *
 * Environment (set by the agent):
 *   RELEASE_REPO     the repo root
 *   RELEASE_RECIPE   its recipe file
 *   RELEASE_STATE    where run history, builds and the cache live
 *   RELEASE_AGENT_FAKE=1   scripted runs: no Claude calls, no repo changes
 */

import http from 'node:http';
import path from 'node:path';
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import { createRiskAssessor } from '../../src/runs/risk.ts';
import { BuildManager } from './builds/builds.ts';
import { createApp } from './http/app.ts';
import { CONFIG_FILE, sessionEnv } from './release/config.ts';
import { recipe, ROOT as root } from './release/recipe.ts';
import { CiBuilds } from './release/ciBuilds.ts';
import { findStage } from './release/stages.ts';
import { fakeQuery } from './runs/fake-query.ts';
import { RunManager, setRiskAssessor, type QueryFn } from './runs/runner.ts';
import { Sequencer } from './runs/sequence.ts';
import { FileRunStore } from './runs/store.ts';
import { ProbeCache } from '../../src/recipe/hooks.ts';

const stateRoot = path.resolve( process.env.RELEASE_STATE ?? path.join( root, '.release-agent' ) );
const host = '127.0.0.1';
const fake = process.env.RELEASE_AGENT_FAKE === '1';

// approvals use the repo's recipe rules (built-in + its own)
setRiskAssessor( createRiskAssessor( recipe ) );

const queryFn: QueryFn = fake ? fakeQuery : ( params ) => query( params );
// Fake runs are kept apart so they never show up in the real run history.
const runsDir = path.join( stateRoot, '.state', fake ? 'fake-runs' : 'runs' );
const store = new FileRunStore( runsDir );
// Browser stages get Claude in Chrome; every session gets the settings' env vars.
const sessionOptions = ( stageId: string ): Partial<Options> => ( {
	env: { ...( process.env as Record<string, string> ), ...sessionEnv( root ) },
	...( findStage( stageId )?.browser ? { extraArgs: { chrome: null } } : {} ),
} );
const manager = new RunManager( root, queryFn, sessionOptions, store );
const sequencer = new Sequencer( { manager, contextFor: ( version ) => ( { root, version } ) } );

// Agent sessions: the same Claude Code session, started from a free prompt.
// Kept apart from release runs (own history), so neither blocks the other.
const chats = new RunManager(
	root,
	queryFn,
	// a session started with "Use Chrome" (like `claude --chrome`) is stage "chat-chrome"
	( stageId ) => ( {
		env: { ...( process.env as Record<string, string> ), ...sessionEnv( root ) },
		...( stageId === 'chat-chrome' ? { extraArgs: { chrome: null } } : {} ),
	} ),
	new FileRunStore( path.join( stateRoot, '.state', fake ? 'fake-chats' : 'chats' ) )
);
chats.confirmPhrase = 'confirm';

const builds = recipe.build
	? new BuildManager( {
			root,
			buildsDir: path.join( stateRoot, '.builds' ),
			script: path.resolve( root, recipe.build.script ),
			env: { CACHE_DIR: path.join( stateRoot, '.cache' ) },
	  } )
	: undefined;

// filled in once the port is known; createApp reads these arrays per request
const allowedHosts: string[] = [];
const allowedOrigins: string[] = [];

const server = http.createServer(
	createApp( {
		root,
		manager,
		probes: new ProbeCache(),
		chats,
		ciBuilds: recipe.build?.ciWorkflow ? new CiBuilds( root ) : undefined,
		sequencer,
		builds,
		reset: {
			stateDir: path.join( stateRoot, '.state' ),
			consoleData: {
				runsDir,
				buildsDir: path.join( stateRoot, '.builds' ),
				cacheDir: path.join( stateRoot, '.cache' ),
				configFile: path.join( root, CONFIG_FILE ),
			},
		},
		allowedHosts,
		allowedOrigins,
	} )
);

server.listen( 0, host, () => {
	const { port } = server.address() as { port: number };

	allowedHosts.push( `${ host }:${ port }`, `localhost:${ port }` );
	allowedOrigins.push( `http://${ host }:${ port }`, `http://localhost:${ port }` );
	// the agent reads this line to find the port
	console.log( JSON.stringify( { ready: true, port, repo: root, recipe: recipe.name, fake } ) );
} );

function shutdown(): void {
	manager.latest?.stop( 'interrupted' );
	server.close( () => process.exit( 0 ) );
	setTimeout( () => process.exit( 0 ), 2000 ).unref();
}

process.on( 'SIGINT', shutdown );
process.on( 'SIGTERM', shutdown );
process.on( 'disconnect', shutdown );
