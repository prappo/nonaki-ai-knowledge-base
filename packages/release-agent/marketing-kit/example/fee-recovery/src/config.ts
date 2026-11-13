import vo from './vo-durations.json';
import { FPS } from './theme';

/** Scene lengths in seconds. Voiceover starts VO_DELAY frames into each scene. */
export const SCENES = [
	{ id: 's1', sec: 4.5 },
	{ id: 's2', sec: 9 },
	{ id: 's3', sec: 4 },
	{ id: 's4', sec: 6 },
	{ id: 's5', sec: 6 },
	{ id: 's6', sec: 7 },
	{ id: 's7', sec: 6 },
	{ id: 's8', sec: 8 },
	{ id: 's9', sec: 7 },
	{ id: 's10', sec: 5.5 },
] as const;

export const VO_DELAY = 8;

export const timeline = (() => {
	let from = 0;
	return SCENES.map((s) => {
		const frames = Math.round(s.sec * FPS);
		const voFrames = Math.ceil((vo as Record<string, number>)[s.id] * FPS);
		const item = { ...s, from, frames, voFrom: from + VO_DELAY, voTo: from + VO_DELAY + voFrames };
		from += frames;
		return item;
	});
})();

export const TOTAL_FRAMES = timeline.reduce((n, s) => n + s.frames, 0);
