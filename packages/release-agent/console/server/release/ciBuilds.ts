/**
 * CI builds: the "Build and Export Plugin" GitHub workflow, through `gh`.
 *
 * The Builds page can dispatch the workflow for any pushed branch and list its
 * recent runs. The workflow builds the Pro and Lite zips, uploads them as run
 * artifacts, and comments on the branch's open PR when there is one.
 */

import { recipe } from './recipe.ts';
import { runCommand, type CommandRunner } from './health.ts';

export const CI_BUILD_WORKFLOW = recipe.build?.ciWorkflow ?? '';

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
	 * Starts the workflow on a branch that exists on GitHub. The branch goes to
	 * `gh` as its own argument (no shell), after the same check as the route.
	 */
	async dispatch( value: unknown ): Promise<void> {
		const branch = parseBranch( value );
		const result = await this.run( 'gh', [ 'workflow', 'run', CI_BUILD_WORKFLOW, '--ref', branch ], this.cwd, 30000 );

		if ( ! result.ok ) {
			const message = result.stderr.trim();

			if ( /no ref found/i.test( message ) ) {
				throw new CiBuildError( 404, `GitHub has no branch "${ branch }". Push it first.` );
			}

			// gh's output can carry API URLs and ids; it goes to the server log, not the page.
			this.log( `Release Console: gh workflow run failed for ${ branch }: ${ message || '(no output)' }` );

			throw new CiBuildError( 502, 'Could not start the build on GitHub. The console server log has the details.' );
		}
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
