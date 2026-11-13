import React from 'react';
import { c, font, shadow } from '../theme';
import { Check } from './core';
import { money } from './motion';

/* Summary card: a single donation and what the nonprofit receives. */
export const DonationCard: React.FC<{
	x: number;
	y: number;
	feeIn: number;
	receive: number;
	style?: React.CSSProperties;
}> = ({ x, y, feeIn, receive, style }) => {
	const lost = receive < 49.99;
	return (
		<div
			style={{
				position: 'absolute',
				left: x,
				top: y,
				width: 600,
				background: '#fff',
				borderRadius: 24,
				boxShadow: shadow.card,
				fontFamily: font.ui,
				padding: 40,
				boxSizing: 'border-box',
				...style,
			}}
		>
			<div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
				<div
					style={{
						width: 56,
						height: 56,
						borderRadius: 28,
						background: '#f6e1cf',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						fontSize: 22,
						fontWeight: 700,
						color: '#8a4b1f',
					}}
				>
					JL
				</div>
				<div>
					<div style={{ fontSize: 22, fontWeight: 600, color: c.ink }}>Jordan Lee</div>
					<div style={{ fontSize: 18, color: c.muted }}>Donation · Riverbend Animal Rescue</div>
				</div>
			</div>
			<div style={{ fontSize: 96, fontWeight: 700, color: c.ink, letterSpacing: -3, marginTop: 28 }}>$50.00</div>
			<div style={{ height: 1, background: c.line, margin: '26px 0 20px' }} />
			<div
				style={{
					display: 'flex',
					justifyContent: 'space-between',
					fontSize: 24,
					color: c.red,
					height: 44 * feeIn,
					opacity: feeIn,
					overflow: 'hidden',
					transform: `translateX(${(1 - feeIn) * 30}px)`,
				}}
			>
				<span>Stripe processing fee</span>
				<span style={{ fontWeight: 600 }}>−$1.75</span>
			</div>
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 26, marginTop: 6 }}>
				<span style={{ color: c.text, fontWeight: 600 }}>Riverbend receives</span>
				<span
					style={{
						fontWeight: 700,
						fontSize: 34,
						color: lost ? c.red : c.green,
						display: 'flex',
						alignItems: 'center',
						gap: 10,
					}}
				>
					{!lost && <Check on={1} size={28} color={c.green} />}
					{money(receive)}
				</span>
			</div>
		</div>
	);
};

/*
 * Donor-facing payment form. Screen coords (card at x 660, y 210, w 600):
 *   fee checkbox center (710, 634)
 *   breakdown centre    (960, 710)
 *   pay button centre   (960, 942)
 */
export const FORM = { x: 660, y: 210, w: 600 };
export const DonorForm: React.FC<{
	checked: number;
	feeIn: number;
	fee: number;
	cardText: string;
}> = ({ checked, feeIn, fee, cardText }) => {
	const total = 50 + fee;
	const label = (y: number, t: string) => (
		<div style={{ position: 'absolute', left: 36, top: y, fontSize: 19, fontWeight: 600, color: c.ink }}>{t}</div>
	);
	const field = (y: number, v: string, h = 52) => (
		<div
			style={{
				position: 'absolute',
				left: 36,
				top: y,
				width: 528,
				height: h,
				border: '1px solid #c9ccd1',
				borderRadius: 8,
				boxSizing: 'border-box',
				padding: '0 16px',
				display: 'flex',
				alignItems: 'center',
				fontSize: 20,
				color: c.ink,
			}}
		>
			{v}
		</div>
	);
	const line = (y: number, l: string, v: string, bold = false, opacity = 1) => (
		<div
			style={{
				position: 'absolute',
				left: 36,
				top: y,
				width: 528,
				display: 'flex',
				justifyContent: 'space-between',
				fontSize: 21,
				fontWeight: bold ? 700 : 600,
				color: c.ink,
				opacity,
			}}
		>
			<span>{l}</span>
			<span>{v}</span>
		</div>
	);
	return (
		<div
			style={{
				position: 'absolute',
				left: FORM.x,
				top: FORM.y,
				width: FORM.w,
				height: 800,
				background: '#fff',
				borderRadius: 22,
				boxShadow: shadow.card,
				fontFamily: font.ui,
			}}
		>
			<div style={{ position: 'absolute', left: 36, top: 32, fontSize: 30, fontWeight: 700, color: c.ink }}>Support Riverbend</div>
			<div style={{ position: 'absolute', left: 36, top: 76, fontSize: 18, color: c.muted }}>Every gift feeds and shelters a rescue animal.</div>
			{['$25', '$50', '$100'].map((p, i) => (
				<div
					key={p}
					style={{
						position: 'absolute',
						left: 36 + i * 180,
						top: 122,
						width: 168,
						height: 56,
						borderRadius: 8,
						border: `2px solid ${p === '$50' ? c.green : '#c9ccd1'}`,
						background: p === '$50' ? c.greenSoft : '#fff',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						fontSize: 22,
						fontWeight: 600,
						color: p === '$50' ? c.green : c.text,
					}}
				>
					{p}
				</div>
			))}
			{label(204, 'Full Name')}
			{field(234, 'Jordan Lee')}
			{label(300, 'Email Address')}
			{field(330, 'jordan@example.com')}
			<div style={{ position: 'absolute', left: 36, top: 410, display: 'flex', alignItems: 'center', gap: 12, fontSize: 20, color: c.ink }}>
				<Check on={checked} size={28} color={c.green} />
				I will cover the processing fee
			</div>
			{line(462, 'Subtotal', '$50.00')}
			<div style={{ position: 'absolute', left: 0, top: 500, width: '100%', height: 38 * feeIn, overflow: 'hidden', opacity: feeIn }}>
				{line(0, 'Processing fee', money(fee))}
			</div>
			{line(500 + 38 * feeIn, 'Total due', money(total), true)}
			{label(590, 'Payment Method')}
			<div
				style={{
					position: 'absolute',
					left: 36,
					top: 620,
					width: 528,
					height: 56,
					border: '1px solid #c9ccd1',
					borderRadius: 8,
					display: 'flex',
					alignItems: 'center',
					padding: '0 16px',
					boxSizing: 'border-box',
					fontSize: 20,
					color: cardText ? c.ink : '#a7aaad',
					gap: 14,
				}}
			>
				<div style={{ width: 34, height: 22, borderRadius: 4, background: '#e1e3e6' }} />
				{cardText || 'Card number'}
				<span style={{ marginLeft: 'auto', color: cardText.length > 18 ? c.ink : '#a7aaad' }}>
					{cardText.length > 18 ? '12 / 29   123' : 'MM / YY  CVC'}
				</span>
			</div>
			<div
				style={{
					position: 'absolute',
					left: 36,
					top: 710,
					width: 528,
					height: 64,
					borderRadius: 8,
					background: c.green,
					color: '#fff',
					fontSize: 23,
					fontWeight: 700,
					letterSpacing: 0.5,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
				}}
			>
				DONATE {money(total)}
			</div>
		</div>
	);
};
