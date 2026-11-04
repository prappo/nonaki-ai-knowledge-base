/**
 * Icons used across the console (Lucide). Stage icons live here so the
 * pipeline, history and run panel all show the same one for a stage.
 */

import {
	AlertCircle,
	BadgeCheck,
	Mail,
	MessageCircle,
	Bell,
	BookOpen,
	CheckCircle2,
	CircleDashed,
	ClipboardCheck,
	FilePenLine,
	FileSearch,
	Globe,
	GitCompareArrows,
	Loader2,
	Lock,
	Megaphone,
	Newspaper,
	PackageCheck,
	RefreshCw,
	Rocket,
	Tag,
	XCircle,
	type LucideIcon,
} from 'lucide-react';

export const STAGE_ICONS: Record<string, LucideIcon> = {
	'review-milestone': ClipboardCheck,
	'compare-builds': GitCompareArrows,
	analyze: FileSearch,
	prep: PackageCheck,
	docs: BookOpen,
	marketing: Megaphone,
	'blog-draft': Newspaper,
	'email-draft': Mail,
	'notifications-draft': FilePenLine,
	notifications: Bell,
	'create-release': Tag,
	'lite-sync': RefreshCw,
	'lite-publish': Rocket,
	'lite-wporg': Globe,
};

export function StageIcon( { id, size = 16 }: { id: string; size?: number } ) {
	const Icon = STAGE_ICONS[ id ] ?? BadgeCheck;

	return <Icon size={ size } aria-hidden="true" />;
}

export type ProgressState = 'done' | 'partial' | 'running' | 'failed' | 'blocked' | 'pending' | 'attention' | 'reply';

/** One icon for "where is this at": done, running, failed, blocked or not started. */
export function ProgressIcon( { state, size = 16 }: { state: ProgressState; size?: number } ) {
	switch ( state ) {
		case 'done':
			return <CheckCircle2 size={ size } className="icon-success" aria-label="Done" />;
		case 'partial':
			return <CheckCircle2 size={ size } className="icon-warning" aria-label="Almost done" />;
		case 'running':
			return <Loader2 size={ size } className="icon-accent spin" aria-label="Running" />;
		case 'failed':
			return <XCircle size={ size } className="icon-danger" aria-label="Failed" />;
		case 'blocked':
			return <Lock size={ size } className="icon-muted" aria-label="Blocked" />;
		case 'attention':
			return <AlertCircle size={ size } className="icon-warning" aria-label="Needs you" />;
		case 'reply':
			return <MessageCircle size={ size } className="icon-warning" aria-label="Waiting for your reply" />;
		default:
			return <CircleDashed size={ size } className="icon-muted" aria-label="Not started" />;
	}
}
