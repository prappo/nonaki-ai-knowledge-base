import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { c, font, shadow } from '../theme';
import { ease, lerp, pop } from './motion';

/* ------------------------------------------------------------------ */
/* Background: warm gradient with slow drifting light blobs.           */
/* ------------------------------------------------------------------ */
export const Background: React.FC = () => {
	const frame = useCurrentFrame();
	const t = frame / 30;
	return (
		<AbsoluteFill style={{ background: `linear-gradient(180deg, ${c.bgTop} 0%, ${c.bgBottom} 100%)` }}>
			<div
				style={{
					position: 'absolute',
					width: 1100,
					height: 1100,
					borderRadius: '50%',
					left: -250 + Math.sin(t / 6) * 80,
					top: -500 + Math.cos(t / 7) * 60,
					background: 'radial-gradient(circle, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0) 65%)',
				}}
			/>
			<div
				style={{
					position: 'absolute',
					width: 1000,
					height: 1000,
					borderRadius: '50%',
					right: -300 + Math.cos(t / 5) * 70,
					bottom: -450 + Math.sin(t / 8) * 60,
					background: 'radial-gradient(circle, rgba(236,170,130,0.35) 0%, rgba(236,170,130,0) 65%)',
				}}
			/>
			<div
				style={{
					position: 'absolute',
					width: 800,
					height: 800,
					borderRadius: '50%',
					right: 100 + Math.sin(t / 9) * 60,
					top: -380,
					background: 'radial-gradient(circle, rgba(170,200,235,0.30) 0%, rgba(170,200,235,0) 65%)',
				}}
			/>
		</AbsoluteFill>
	);
};

/* ------------------------------------------------------------------ */
/* Scene wrapper: blur/fade in and out at the scene edges.             */
/* ------------------------------------------------------------------ */
export const SceneFrame: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
	const frame = useCurrentFrame();
	const inP = ease(frame, 0, 14);
	const outP = ease(frame, dur - 12, dur);
	const opacity = inP * (1 - outP);
	const blur = (1 - inP) * 14 + outP * 14;
	const scale = 0.985 + inP * 0.015 + outP * 0.02;
	return (
		<AbsoluteFill style={{ opacity, filter: `blur(${blur}px)`, transform: `scale(${scale})` }}>
			{children}
		</AbsoluteFill>
	);
};

/* ------------------------------------------------------------------ */
/* Headline: word-by-word reveal; marked words get a highlight swipe.  */
/* Mark highlighted words with *asterisks* in the text.                */
/* ------------------------------------------------------------------ */
export const Headline: React.FC<{
	text: string;
	start?: number;
	size?: number;
	top?: number;
	stagger?: number;
}> = ({ text, start = 4, size = 78, top = 70, stagger = 4 }) => {
	const frame = useCurrentFrame();
	// Parse "*highlighted phrase*" segments.
	const segments: { word: string; hl: boolean }[] = [];
	let hl = false;
	for (const raw of text.split(' ')) {
		let w = raw;
		const opens = w.startsWith('*');
		if (opens) {
			hl = true;
			w = w.slice(1);
		}
		const closes = w.endsWith('*');
		if (closes) w = w.slice(0, -1);
		segments.push({ word: w, hl });
		if (closes) hl = false;
	}
	const lastWordAt = start + (segments.length - 1) * stagger;
	const swipe = ease(frame, lastWordAt + 4, lastWordAt + 18);

	// Group consecutive highlighted words so they share one swipe.
	const groups: { words: { word: string; i: number }[]; hl: boolean }[] = [];
	segments.forEach((s, i) => {
		const g = groups[groups.length - 1];
		if (g && g.hl === s.hl && s.hl) g.words.push({ word: s.word, i });
		else groups.push({ words: [{ word: s.word, i }], hl: s.hl });
	});

	return (
		<div
			style={{
				position: 'absolute',
				top,
				left: 0,
				right: 0,
				textAlign: 'center',
				fontFamily: font.head,
				fontWeight: 800,
				fontSize: size,
				letterSpacing: -2,
				color: c.ink,
				lineHeight: 1.12,
			}}
		>
			{groups.map((g, gi) => (
				<span key={gi} style={{ position: 'relative', display: 'inline-block', whiteSpace: 'nowrap' }}>
					{g.hl && (
						<span
							style={{
								position: 'absolute',
								left: -10,
								right: -10,
								top: '12%',
								bottom: '2%',
								background: c.highlight,
								borderRadius: 10,
								transformOrigin: 'left center',
								transform: `scaleX(${swipe})`,
								zIndex: 0,
							}}
						/>
					)}
					{g.words.map(({ word, i }) => {
						const p = pop(frame, start + i * stagger, 18);
						return (
							<span
								key={i}
								style={{
									position: 'relative',
									zIndex: 1,
									display: 'inline-block',
									marginRight: '0.26em',
									opacity: interpolate(p, [0, 1], [0, 1]),
									transform: `translateY(${(1 - p) * 26}px)`,
									filter: `blur(${(1 - Math.min(p, 1)) * 8}px)`,
								}}
							>
								{word}
							</span>
						);
					})}
				</span>
			))}
		</div>
	);
};

/* ------------------------------------------------------------------ */
/* Camera: zoom around a focus point, keyframed.                       */
/* ------------------------------------------------------------------ */
export type CamKey = { f: number; s: number; x: number; y: number };
export const Camera: React.FC<{ keys: CamKey[]; blur?: number; mask?: number; children: React.ReactNode }> = ({
	keys,
	blur = 0,
	mask = 0,
	children,
}) => {
	const frame = useCurrentFrame();
	const fs = keys.map((k) => k.f);
	const s = lerp(frame, fs, keys.map((k) => k.s));
	const x = lerp(frame, fs, keys.map((k) => k.x));
	const y = lerp(frame, fs, keys.map((k) => k.y));
	// Fade the zoomed UI out under the headline so they never collide.
	const top = `rgba(0,0,0,${1 - mask})`;
	const maskImage = mask > 0 ? `linear-gradient(180deg, ${top} 0px, ${top} 165px, #000 250px)` : undefined;
	return (
		<AbsoluteFill style={{ maskImage, WebkitMaskImage: maskImage }}>
			<AbsoluteFill
				style={{
					transform: `translate(${x}px, ${y}px) scale(${s}) translate(${-x}px, ${-y}px)`,
					filter: blur ? `blur(${blur}px)` : undefined,
				}}
			>
				{children}
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

/* ------------------------------------------------------------------ */
/* Cursor: moves through keyframed points, pulses on click.            */
/* ------------------------------------------------------------------ */
export type CursorKey = { f: number; x: number; y: number; click?: boolean };
export const Cursor: React.FC<{ keys: CursorKey[]; appear?: number; hide?: number }> = ({ keys, appear = 0, hide }) => {
	const frame = useCurrentFrame();
	const fs = keys.map((k) => k.f);
	const x = lerp(frame, fs, keys.map((k) => k.x));
	const y = lerp(frame, fs, keys.map((k) => k.y));
	const clicks = keys.filter((k) => k.click);
	let press = 0;
	let ring = 0;
	let ringP = 1;
	for (const k of clicks) {
		const d = frame - k.f;
		if (d >= -3 && d <= 4) press = 1 - Math.abs(d) / 4;
		if (d >= 0 && d <= 16) {
			ring = 1;
			ringP = d / 16;
		}
	}
	const visible = ease(frame, appear, appear + 8) * (hide !== undefined ? 1 - ease(frame, hide, hide + 8) : 1);
	return (
		<div style={{ position: 'absolute', left: x, top: y, opacity: visible, zIndex: 100, pointerEvents: 'none' }}>
			{ring > 0 && (
				<div
					style={{
						position: 'absolute',
						left: -22,
						top: -22,
						width: 44,
						height: 44,
						borderRadius: '50%',
						border: `3px solid ${c.wpspBlue}`,
						opacity: 1 - ringP,
						transform: `scale(${0.4 + ringP * 1.1})`,
					}}
				/>
			)}
			<svg
				width="34"
				height="40"
				viewBox="0 0 24 28"
				style={{ transform: `scale(${1 - press * 0.15})`, transformOrigin: '2px 2px', filter: 'drop-shadow(0 3px 5px rgba(0,0,0,0.3))' }}
			>
				<path d="M2 2 L2 22 L7.5 17 L11 25.5 L14.5 24 L11 15.8 L18.5 15.5 Z" fill="#111" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
			</svg>
		</div>
	);
};

/* ------------------------------------------------------------------ */
/* Small UI atoms.                                                     */
/* ------------------------------------------------------------------ */
export const Check: React.FC<{ on: number; size?: number; color?: string }> = ({ on, size = 24, color = c.wpBlue }) => (
	<div
		style={{
			width: size,
			height: size,
			borderRadius: 4,
			border: `2px solid ${on > 0.5 ? color : '#8c8f94'}`,
			background: on > 0.5 ? color : '#fff',
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			flexShrink: 0,
		}}
	>
		<svg width={size * 0.7} height={size * 0.7} viewBox="0 0 16 16" style={{ transform: `scale(${on})` }}>
			<path d="M3 8.5 L6.5 12 L13 4.5" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	</div>
);

export const Card: React.FC<{ style?: React.CSSProperties; children: React.ReactNode }> = ({ style, children }) => (
	<div style={{ position: 'absolute', background: c.white, borderRadius: 22, boxShadow: shadow.card, fontFamily: font.ui, ...style }}>
		{children}
	</div>
);

/** Floating stat card that pops in. */
export const StatCard: React.FC<{
	at: number;
	x: number;
	y: number;
	label: string;
	value: React.ReactNode;
	sub?: string;
	accent?: string;
	width?: number;
}> = ({ at, x, y, label, value, sub, accent = c.ink, width = 300 }) => {
	const frame = useCurrentFrame();
	const p = pop(frame, at, 12);
	const { fps } = useVideoConfig();
	const float = Math.sin((frame - at) / fps) * 4;
	return (
		<div
			style={{
				position: 'absolute',
				left: x,
				top: y + float,
				width,
				padding: '22px 26px',
				background: c.white,
				borderRadius: 18,
				boxShadow: shadow.pop,
				fontFamily: font.ui,
				opacity: Math.min(1, p),
				transform: `translateY(${(1 - p) * 30}px) scale(${0.85 + p * 0.15})`,
				zIndex: 50,
			}}
		>
			<div style={{ fontSize: 18, color: c.muted, fontWeight: 500 }}>{label}</div>
			<div style={{ fontSize: 44, fontWeight: 700, color: accent, letterSpacing: -1, marginTop: 4 }}>{value}</div>
			{sub && <div style={{ fontSize: 17, color: c.muted, marginTop: 4 }}>{sub}</div>}
		</div>
	);
};
