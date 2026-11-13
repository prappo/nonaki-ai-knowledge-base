import { Easing, interpolate, spring } from 'remotion';
import { FPS } from '../theme';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** 0→1 eased progress between two frames. */
export const ease = (frame: number, from: number, to: number) =>
	interpolate(frame, [from, to], [0, 1], { ...clamp, easing: Easing.bezier(0.33, 0, 0.2, 1) });

/** Linear map with clamping. */
export const lerp = (frame: number, input: number[], output: number[]) =>
	interpolate(frame, input, output, { ...clamp, easing: Easing.bezier(0.45, 0, 0.25, 1) });

/** Springy 0→1 starting at a frame. */
export const pop = (frame: number, start: number, damping = 14) =>
	spring({ frame: frame - start, fps: FPS, config: { damping, mass: 0.7, stiffness: 140 } });

/** Text typed out character by character. */
export const typed = (text: string, frame: number, start: number, cps = 18) => {
	const n = Math.max(0, Math.floor(((frame - start) / FPS) * cps));
	return text.slice(0, n);
};

/** Count from a to b between frames, formatted. */
export const count = (frame: number, start: number, end: number, a: number, b: number) =>
	interpolate(frame, [start, end], [a, b], { ...clamp, easing: Easing.out(Easing.cubic) });

export const money = (v: number, decimals = 2) =>
	'$' + v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
