/**
 * CI builds: the "Build and Export Plugin" GitHub workflow, through `gh`.
 *
 * The Builds page can dispatch the workflow for any pushed branch and list its
 * recent runs. The workflow builds the Pro and Lite zips, uploads them as run
 * artifacts, and comments on the branch's open PR when there is one.
 *
 * A beta build (the workflow's `beta` input) is the quick fix to send a
 * customer: `master`, which is what they run, plus only the open PR's own
 * changes, Pro only, stamped `{target version}-beta` so the real release
 * updates over it. It all happens in the CI runner: nothing is merged or
 * pushed, and the PR still ships in its release.
 */

import { recipe } from './recipe.ts';
import { runCommand, type CommandRunner } from './health.ts';
import { runGit, type GitRunner } from '../repo/git.ts';

export const CI_BUILD_WORKFLOW = recipe.build?.ciWorkflow ?? '';

/** The open PR a beta build takes its changes from. */
export interface BetaSource {
	pr: number;
	title: string;
	/** The branch the PR targets, e.g. release/4.17.6. */
	base: string;
	/** The version the workflow stamps, e.g. 4.17.6-beta, or null when it can only tell from package.json. */
	version: string | null;
}

/** What the workflow stamps a beta build with: the target branch's version plus -beta, as its "Apply beta version" step does. */
export function betaVersion( base: string ): string | null {
	const version = base.match( /\d+\.\d+\.\d+(\.\d+)?/ )?.[ 0 ];

	return version ? `${ version }-beta` : null;
}

export interface CiBuildRun {
	id: number;
	branch: string;
	commit: string;
	/** queued, in_progress, completed, … as GitHub reports it. */
	status: string;
	/** success, failure, cancelled, … once completed, otherwise null. */
	conclusion: string | null;
	event: string;
	createdAt: string;
	url: string;
}

export class CiBuildError extends Error {
	readonly status: number;

	constructor( status: number, message: string ) {
		super( message );
		this.status = status;
	}
}

/**
 * Whether a branch name is safe to hand to `gh`: git's ref rules, minus the
 * rare characters, and never starting with `-` so it cannot read as a flag.
 */
export function isValidBranchName( branch: string ): boolean {
	return (
		/^[A-Za-z0-9._\/-]+$/.test( branch ) &&
		! branch.startsWith( '-' ) &&
		! branch.startsWith( '/' ) &&
		! branch.endsWith( '/' ) &&
		! branch.endsWith( '.' ) &&
		! branch.endsWith( '.lock' ) &&
		! branch.includes( '..' ) &&
		! branch.includes( '//' ) &&
		branch.length <= 255
	);
}

/** The trimmed branch from a request, or a 400 when it is missing or unsafe. */
export function parseBranch( value: unknown ): string {
	const branch = typeof value === 'string' ? value.trim() : '';

	if ( ! isValidBranchName( branch ) ) {
		throw new CiBuildError( 400, 'Enter a valid branch name.' );
	}

	return branch;
}

/** More than the repo has (about 190); the list is a typing aid, not an index. */
const BRANCH_LIMIT = 500;

/**
 * The branches on GitHub as this checkout last saw them (origin's
 * remote-tracking refs), newest commit first, to suggest in the Branch field.
 * Read locally, so it is instant and offline, and as fresh as the last fetch
 * or push. Empty when git can't answer.
 */
export async function pushedBranches( root: string, git: GitRunner = runGit ): Promise<string[]> {
	let output: string;

	try {
		output = await git( [ 'for-each-ref', '--sort=-committerdate', `--count=${ BRANCH_LIMIT + 1 }`, '--format=%(refname)', 'refs/remotes/origin/' ], root );
	} catch {
		return [];
	}

	return output
		.split( '\n' )
		.map( ( ref ) => ref.trim().replace( /^refs\/remotes\/origin\//, '' ) )
		.filter( ( branch ) => branch !== '' && branch !== 'HEAD' && isValidBranchName( branch ) )
		.slice( 0, BRANCH_LIMIT );
}

export class CiBuilds {
	private readonly cwd: string;
	private readonly run: CommandRunner;
	private readonly log: ( message: string ) => void;

	constructor( cwd: string, run: CommandRunner = runCommand, log: ( message: string ) => void = console.error ) {
		this.cwd = cwd;
		this.run = run;
		this.log = log;
	}

	/**
	 * The open PR from this branch, which a beta build needs. The workflow
	 * looks it up the same way, and fails the run without one; checking first
	 * says why here instead.
	 */
	async betaSource( branch: string ): Promise<BetaSource> {
		const result = await this.run( 'gh', [ 'pr', 'list', '--head', branch, '--state', 'open', '--limit', '1', '--json', 'number,title,baseRefName' ], this.cwd, 15000 );

		if ( ! result.ok ) {
			this.log( `Release Console: gh pr list failed for ${ branch }: ${ result.stderr.trim() || '(no output)' }` );

			throw new CiBuildError( 502, 'Could not ask GitHub for the branch\'s PR. The console server log has the details.' );
		}

		let pr: { number?: number; title?: string; baseRefName?: string } | undefined;

		try {
			[ pr ] = JSON.parse( result.stdout );
		} catch {
			throw new CiBuildError( 502, 'GitHub sent an unexpected answer about the branch\'s PR.' );
		}

		if ( ! pr?.number || ! pr.baseRefName ) {
			throw new CiBuildError( 409, `A beta build needs an open PR from "${ branch }": it is built from master plus that PR's changes. Open the PR, then try again.` );
		}

		return { pr: pr.number, title: pr.title ?? '', base: pr.baseRefName, version: betaVersion( pr.baseRefName ) };
	}

	/**
	 * Starts the workflow on a branch that exists on GitHub. The branch goes to
	 * `gh` as its own argument (no shell), after the same check as the route.
	 * A beta build checks for the branch's open PR first, and returns it.
	 */
	async dispatch( value: unknown, { beta = false }: { beta?: boolean } = {} ): Promise<BetaSource | null> {
		const branch = parseBranch( value );
		const source = beta ? await this.betaSource( branch ) : null;
		const args = [ 'workflow', 'run', CI_BUILD_WORKFLOW, '--ref', branch, ...( beta ? [ '-f', 'beta=true' ] : [] ) ];
		const result = await this.run( 'gh', args, this.cwd, 30000 );

		if ( ! result.ok ) {
			const message = result.stderr.trim();

			if ( /no ref found/i.test( message ) ) {
				throw new CiBuildError( 404, `GitHub has no branch "${ branch }". Push it first.` );
			}

			// GitHub reads the inputs from the workflow file on the branch being built.
			if ( beta && /unexpected inputs?/i.test( message ) ) {
				throw new CiBuildError( 409, `The build workflow on "${ branch }" is too old to make beta builds. Merge develop into the branch, push, and try again.` );
			}

			// gh's output can carry API URLs and ids; it goes to the server log, not the page.
			this.log( `Release Console: gh workflow run failed for ${ branch }: ${ message || '(no output)' }` );

			throw new CiBuildError( 502, 'Could not start the build on GitHub. The console server log has the details.' );
		}

		return source;
	}

	/** The workflow's most recent runs, newest first, or null when GitHub could not be asked. */
	async recent( limit = 10 ): Promise<CiBuildRun[] | null> {
		const result = await this.run(
			'gh',
			[ 'run', 'list', '--workflow', CI_BUILD_WORKFLOW, '--limit', String( limit ), '--json', 'databaseId,headBranch,headSha,status,conclusion,event,createdAt,url' ],
			this.cwd,
			15000
		);

		if ( ! result.ok ) {
			return null;
		}

		try {
			const data = JSON.parse( result.stdout ) as {
				databaseId?: number;
				headBranch?: string;
				headSha?: string;
				status?: string;
				conclusion?: string;
				event?: string;
				createdAt?: string;
				url?: string;
			}[];

			return data.map( ( run ) => ( {
				id: run.databaseId ?? 0,
				branch: run.headBranch ?? '',
				commit: ( run.headSha ?? '' ).slice( 0, 7 ),
				status: run.status ?? 'unknown',
				conclusion: run.conclusion || null,
				event: run.event ?? '',
				createdAt: run.createdAt ?? '',
				url: run.url ?? '',
			} ) );
		} catch {
			return null;
		}
	}
}
