import { useState } from 'react';
import type { Gate, Question } from '../../lib/api.ts';

type QuestionGate = Extract<Gate, { type: 'question' }>;
type ApprovalGate = Extract<Gate, { type: 'approval' }>;

interface QuestionAnswer {
	selected: string[];
	other: string;
}

/** The answer string the tool expects: the picked label(s), or the free text. */
export function answerValue( question: Question, answer: QuestionAnswer ): string {
	const other = answer.other.trim();

	if ( question.multiSelect ) {
		return [ ...answer.selected, ...( other ? [ other ] : [] ) ].join( ', ' );
	}

	return other || answer.selected[ 0 ] || '';
}

function QuestionForm( { gate, onSubmit }: { gate: QuestionGate; onSubmit: ( answers: Record<string, string> ) => Promise<void> } ) {
	const [ answers, setAnswers ] = useState<QuestionAnswer[]>(
		() => gate.questions.map( () => ( { selected: [], other: '' } ) )
	);
	const [ busy, setBusy ] = useState( false );

	const update = ( index: number, next: Partial<QuestionAnswer> ) =>
		setAnswers( ( current ) => current.map( ( answer, i ) => ( i === index ? { ...answer, ...next } : answer ) ) );

	const values = gate.questions.map( ( question, index ) => answerValue( question, answers[ index ] ) );
	const complete = values.every( Boolean );

	async function submit( event: React.FormEvent ) {
		event.preventDefault();

		if ( ! complete ) {
			return;
		}

		setBusy( true );

		try {
			await onSubmit( Object.fromEntries( gate.questions.map( ( question, index ) => [ question.question, values[ index ] ] ) ) );
		} finally {
			setBusy( false );
		}
	}

	return (
		<form onSubmit={ submit } className="gate-form">
			{ gate.questions.map( ( question, index ) => {
				const answer = answers[ index ];
				const name = `${ gate.id }-${ index }`;

				return (
					<fieldset key={ name } className="question">
						<legend>
							{ question.header && <span className="chip">{ question.header }</span> }
							<span className="question-text">{ question.question }</span>
						</legend>
						{ question.options.map( ( option ) => {
							const checked = answer.selected.includes( option.label );

							return (
								<label key={ option.label } className={ `option${ checked ? ' is-checked' : '' }` }>
									<input
										type={ question.multiSelect ? 'checkbox' : 'radio' }
										name={ name }
										checked={ checked }
										onChange={ () =>
											update( index, {
												selected: question.multiSelect
													? checked
														? answer.selected.filter( ( label ) => label !== option.label )
														: [ ...answer.selected, option.label ]
													: [ option.label ],
												other: question.multiSelect ? answer.other : '',
											} )
										}
									/>
									<span>
										<strong>{ option.label }</strong>
										{ option.description && <span className="muted"> { option.description }</span> }
										{ checked && option.preview && <pre className="preview">{ option.preview }</pre> }
									</span>
								</label>
							);
						} ) }
						<label className="other">
							<span className="muted">Other</span>
							<textarea
								rows={ 2 }
								value={ answer.other }
								placeholder="Type your own answer"
								onChange={ ( event ) =>
									update( index, {
										other: event.target.value,
										selected: question.multiSelect || ! event.target.value ? answer.selected : [],
									} )
								}
							/>
						</label>
					</fieldset>
				);
			} ) }
			<div className="actions">
				<button type="submit" className="btn btn-primary" disabled={ ! complete || busy }>
					{ busy ? 'Sending…' : 'Send answer' }
				</button>
			</div>
		</form>
	);
}

/** A text box that must match `phrase` exactly before a permanent action can go ahead. */
export function ConfirmField( {
	phrase,
	value,
	onChange,
	action,
}: {
	phrase: string;
	value: string;
	onChange: ( value: string ) => void;
	action: string;
} ) {
	return (
		<label className="confirm-field">
			<span>
				This is permanent and public. Type <code>{ phrase }</code> to { action }.
			</span>
			<input
				value={ value }
				onChange={ ( event ) => onChange( event.target.value ) }
				spellCheck={ false }
				autoComplete="off"
				aria-invalid={ value !== '' && value.trim() !== phrase }
			/>
		</label>
	);
}

function ApprovalForm( {
	gate,
	onDecide,
}: {
	gate: ApprovalGate;
	onDecide: ( allow: boolean, message: string, confirm: string ) => Promise<void>;
} ) {
	const [ message, setMessage ] = useState( '' );
	const [ confirm, setConfirm ] = useState( '' );
	const [ busy, setBusy ] = useState( false );
	const confirmed = ! gate.confirmPhrase || confirm.trim() === gate.confirmPhrase;
	// Claude in Chrome's page-script tool; Agent sessions can also ask about any other tool
	const isScript = gate.toolName === 'mcp__claude-in-chrome__javascript_tool';

	async function decide( allow: boolean ) {
		setBusy( true );

		try {
			await onDecide( allow, message, confirm );
		} finally {
			setBusy( false );
		}
	}

	return (
		<div className="gate-form">
			<p className="question-text">
				{ isScript ? 'Claude wants to run this script in your browser:' : gate.toolName === 'Bash' ? 'Claude wants to run:' : `Claude wants to use ${ gate.toolName }:` }
			</p>
			<pre className="command">{ gate.command }</pre>
			<p className="warning-text">{ gate.reason }</p>
			{ gate.confirmPhrase && (
				<ConfirmField phrase={ gate.confirmPhrase } value={ confirm } onChange={ setConfirm } action="allow it" />
			) }
			<label className="other">
				<span className="muted">Note for Claude (optional, sent if you deny)</span>
				<textarea rows={ 2 } value={ message } onChange={ ( event ) => setMessage( event.target.value ) } />
			</label>
			<div className="actions">
				{ /* Deny gets focus first so a stray Enter never approves. */ }
				<button type="button" className="btn" autoFocus disabled={ busy } onClick={ () => decide( false ) }>
					Deny
				</button>
				<button type="button" className="btn btn-danger" disabled={ busy || ! confirmed } onClick={ () => decide( true ) }>
					Allow
				</button>
			</div>
		</div>
	);
}

export function GateCard( {
	gate,
	onAnswer,
	onDecide,
}: {
	gate: Gate;
	onAnswer: ( answers: Record<string, string> ) => Promise<void>;
	onDecide: ( allow: boolean, message: string, confirm: string ) => Promise<void>;
} ) {
	return (
		<section className={ `gate gate-${ gate.type }` } aria-live="polite">
			<header>
				<span className="gate-label">{ gate.type === 'question' ? 'Claude is asking' : 'Approval needed' }</span>
				{ gate.subagent && <span className="chip">from a subagent</span> }
			</header>
			{ gate.type === 'question' ? (
				<QuestionForm gate={ gate } onSubmit={ onAnswer } />
			) : (
				<ApprovalForm gate={ gate } onDecide={ onDecide } />
			) }
		</section>
	);
}
