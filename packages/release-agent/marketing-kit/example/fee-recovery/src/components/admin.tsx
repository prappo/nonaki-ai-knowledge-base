import React from 'react';
import { useCurrentFrame } from 'remotion';
import { c, font, shadow } from '../theme';
import { Check } from './core';
import { ease, pop } from './motion';

/*
 * Screen-space layout (1920x1080). Everything is absolutely positioned so the
 * animated cursor can target exact coordinates.
 *
 * Window:  x 210..1710, y 190..1020
 * Metabox: x 420..1680, y 380..990  (tabs 420..640, panel 664..1656)
 */
export const WIN = { x: 210, y: 190, w: 1500, h: 830 };
export const PANEL = { x: 664, y: 404, w: 992 };
export const PM_ROW_Y = (i: number) => 470 + i * 72; // payment method row top
export const CONFIGURE_X = 1556;

const abs = (x: number, y: number, w?: number, h?: number): React.CSSProperties => ({
	position: 'absolute',
	left: x,
	top: y,
	width: w,
	height: h,
});

/* ------------------------------------------------------------------ */
const MENU = ['Dashboard', 'Posts', 'Media', 'Pages', 'Comments', 'WP Simple Pay', 'Appearance', 'Plugins', 'Users', 'Settings'];
const TABS = ['General', 'Payment', 'Form Fields', 'Confirmation', 'Email Notifications'];

export const AdminWindow: React.FC<{ tab: 'Payment' | 'Form Fields'; children?: React.ReactNode }> = ({ tab, children }) => (
	<>
		{/* window */}
		<div
			style={{
				...abs(WIN.x, WIN.y, WIN.w, WIN.h),
				borderRadius: 18,
				overflow: 'hidden',
				background: '#f0f0f1',
				boxShadow: shadow.card,
				fontFamily: font.ui,
			}}
		>
			{/* admin bar */}
			<div style={{ ...abs(0, 0, WIN.w, 34), background: c.sidebar, display: 'flex', alignItems: 'center', gap: 14, paddingLeft: 16 }}>
				<div style={{ display: 'flex', gap: 7 }}>
					{['#ff5f57', '#febc2e', '#28c840'].map((col) => (
						<div key={col} style={{ width: 12, height: 12, borderRadius: 6, background: col }} />
					))}
				</div>
				<div style={{ color: '#c3c4c7', fontSize: 15, marginLeft: 18 }}>Riverbend Animal Rescue</div>
			</div>
			{/* sidebar */}
			<div style={{ ...abs(0, 34, 180, WIN.h - 34), background: c.sidebar, paddingTop: 12 }}>
				{MENU.map((m) => (
					<div
						key={m}
						style={{
							padding: '11px 18px',
							fontSize: 15,
							color: m === 'WP Simple Pay' ? '#fff' : '#c3c4c7',
							background: m === 'WP Simple Pay' ? c.sidebarActive : 'transparent',
							fontWeight: m === 'WP Simple Pay' ? 600 : 400,
						}}
					>
						{m}
					</div>
				))}
			</div>
			{/* page heading + title */}
			<div style={{ ...abs(210, 62), fontSize: 30, fontWeight: 600, color: c.ink }}>Edit Payment Form</div>
			<div
				style={{
					...abs(210, 110, 1260, 54),
					background: '#fff',
					border: `1px solid #c3c4c7`,
					borderRadius: 6,
					fontSize: 22,
					color: c.ink,
					padding: '12px 16px',
					boxSizing: 'border-box',
				}}
			>
				Riverbend Donations
			</div>
			{/* metabox */}
			<div style={{ ...abs(210, 190, 1260, 610), background: '#fff', border: '1px solid #dcdcde', borderRadius: 6, overflow: 'hidden' }}>
				<div style={{ ...abs(0, 0, 220, 610), background: '#f6f7f7', borderRight: '1px solid #dcdcde' }}>
					{TABS.map((t) => (
						<div
							key={t}
							style={{
								height: 56,
								display: 'flex',
								alignItems: 'center',
								paddingLeft: 20,
								fontSize: 16,
								fontWeight: t === tab ? 600 : 400,
								color: t === tab ? c.ink : c.wpBlue,
								background: t === tab ? '#fff' : 'transparent',
								borderBottom: '1px solid #e2e4e7',
								borderLeft: t === tab ? `4px solid ${c.wpBlue}` : '4px solid transparent',
							}}
						>
							{t}
						</div>
					))}
				</div>
			</div>
		</div>
		{/* panel content is in screen space, clipped to the metabox */}
		<div style={{ ...abs(0, 0, 1920, 1080), clipPath: 'inset(381px 240px 91px 641px round 0 6px 6px 0)', fontFamily: font.ui }}>
			{children}
		</div>
	</>
);

/* ------------------------------------------------------------------ */
const METHODS: { name: string; icon: string; bg: string; fg: string }[] = [
	{ name: 'Card', icon: '▭', bg: '#e9ecef', fg: '#50575e' },
	{ name: 'ACH Direct Debit', icon: '🏛', bg: '#e9ecef', fg: '#50575e' },
	{ name: 'Alipay', icon: '支', bg: '#1677ff', fg: '#fff' },
	{ name: 'Klarna (buy now, pay later)', icon: 'K.', bg: '#ffb3c7', fg: '#111' },
	{ name: 'Afterpay (buy now, pay later)', icon: '↻', bg: '#b2fce4', fg: '#111' },
];

export const PaymentMethodsPanel: React.FC<{ enabled?: string[]; focus?: string; dim?: number }> = ({
	enabled = ['Card', 'ACH Direct Debit'],
	focus,
	dim = 0,
}) => (
	<>
		<div style={{ ...abs(PANEL.x, PANEL.y + 6), fontSize: 22, fontWeight: 600, color: c.ink }}>Payment Methods</div>
		<div
			style={{
				...abs(PANEL.x + 220, PANEL.y, 150, 44),
				border: '1px solid #8c8f94',
				borderRadius: 6,
				fontSize: 18,
				display: 'flex',
				alignItems: 'center',
				paddingLeft: 14,
				color: c.text,
			}}
		>
			Popular ⌄
		</div>
		<div style={{ ...abs(PANEL.x, PM_ROW_Y(0), PANEL.w - 30, 72 * METHODS.length), border: '1px solid #c3c4c7', borderRadius: 6 }} />
		{METHODS.map((m, i) => {
			const isFocus = focus === m.name;
			return (
				<div
					key={m.name}
					style={{
						...abs(PANEL.x, PM_ROW_Y(i), PANEL.w - 30, 72),
						display: 'flex',
						alignItems: 'center',
						borderTop: i ? '1px solid #dcdcde' : undefined,
						opacity: focus && !isFocus ? 1 - dim * 0.55 : 1,
						filter: focus && !isFocus ? `blur(${dim * 1.5}px)` : undefined,
						background: isFocus ? `rgba(66,139,202,${0.06 * dim})` : undefined,
					}}
				>
					<div style={{ width: 54, textAlign: 'center', fontSize: 22, color: '#50575e' }}>≡</div>
					<div
						style={{
							width: 44,
							height: 44,
							borderRadius: 8,
							background: m.bg,
							color: m.fg,
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							fontWeight: 800,
							fontSize: 20,
						}}
					>
						{m.icon}
					</div>
					<div style={{ marginLeft: 16 }}>
						<Check on={enabled.includes(m.name) ? 1 : 0} />
					</div>
					<div style={{ marginLeft: 14, fontSize: 20, color: c.text }}>{m.name}</div>
					<div style={{ marginLeft: 'auto', marginRight: 24, fontSize: 19, color: c.wpBlue, display: 'flex', alignItems: 'center', gap: 8 }}>
						Configure <span style={{ fontSize: 24 }}>⚙</span>
					</div>
				</div>
			);
		})}
	</>
);

/* ------------------------------------------------------------------ */
/* Configure payment method modal. Screen coords: x 550..1370, y 300..830
 *   fee checkbox center   (595, 550)
 *   percent input center  (682, 612)
 *   fixed input center    (912, 612)
 *   max amount center     (772, 684)
 *   Update button center  (1268, 785)
 */
export const MODAL = { x: 550, y: 300, w: 820, h: 530 };
export const FeeModal: React.FC<{
	at: number;
	title: string;
	first: { label: string; text: string };
	checked: number;
	pct: string;
	fixed: string;
	max: string;
	maxFocus?: number;
	updateHover?: number;
	overlayFade?: number;
}> = ({ at, title, first, checked, pct, fixed, max, maxFocus = 0, updateHover = 0, overlayFade = 0 }) => {
	const frame = useCurrentFrame();
	const p = pop(frame, at, 15);
	const overlay = ease(frame, at - 4, at + 8) * (1 - overlayFade);
	const input = (x: number, y: number, w: number, value: string, placeholder: string, suffix?: string, active = 0): React.ReactNode => (
		<div
			style={{
				...abs(x, y, w, 56),
				border: `${active ? 2 : 1}px solid ${active ? c.wpBlue : '#8c8f94'}`,
				borderRadius: 6,
				display: 'flex',
				alignItems: 'center',
				padding: '0 16px',
				boxSizing: 'border-box',
				fontSize: 22,
				color: value ? c.ink : '#a7aaad',
				background: '#fff',
			}}
		>
			{value || placeholder}
			{suffix && <span style={{ marginLeft: 'auto', color: c.text }}>{suffix}</span>}
		</div>
	);
	return (
		<>
			<div style={{ ...abs(0, 0, 1920, 1080), background: `rgba(20,24,30,${0.35 * overlay})` }} />
			<div
				style={{
					...abs(MODAL.x, MODAL.y, MODAL.w, MODAL.h),
					background: '#fff',
					borderRadius: 10,
					boxShadow: shadow.pop,
					fontFamily: font.ui,
					opacity: Math.min(1, p * 1.4),
					transform: `scale(${0.92 + p * 0.08})`,
				}}
			>
				<div style={{ ...abs(32, 0, 756, 80), display: 'flex', alignItems: 'center', fontSize: 27, fontWeight: 600, color: c.ink }}>
					{title}
					<span style={{ marginLeft: 'auto', color: '#787c82', fontSize: 30 }}>×</span>
				</div>
				<div style={{ ...abs(0, 80, MODAL.w, 1), background: '#dcdcde' }} />
				<div style={{ ...abs(32, 108), fontSize: 21, fontWeight: 600, color: c.text }}>{first.label}</div>
				<div style={{ ...abs(32, 144), fontSize: 20, color: c.text, display: 'flex', gap: 12, alignItems: 'center' }}>
					<Check on={0} size={26} />
					{first.text}
				</div>
				<div style={{ ...abs(32, 200), fontSize: 21, fontWeight: 600, color: c.text }}>Fee Recovery</div>
				<div style={{ ...abs(32, 236), fontSize: 20, color: c.text, display: 'flex', gap: 12, alignItems: 'center' }}>
					<Check on={checked} size={26} />
					Add an additional fee to payments made with this payment method
				</div>
				<div style={{ opacity: 0.35 + checked * 0.65 }}>
					{input(32, 284, 200, pct, '2.9', '%', pct && !fixed ? 1 : 0)}
					<div style={{ ...abs(242, 296), fontSize: 24, color: c.text }}>+</div>
					{input(272, 284, 180, fixed, '0.30', undefined, fixed && !max ? 1 : 0)}
					<div style={{ ...abs(32, 356, 380, 56), border: `${maxFocus ? 2 : 1}px solid ${maxFocus ? c.wpBlue : '#8c8f94'}`, borderRadius: 6, display: 'flex', alignItems: 'center', padding: '0 16px', boxSizing: 'border-box', fontSize: 21, color: c.text }}>
						Maximum Amount
						<span style={{ marginLeft: 14, color: max ? c.ink : '#a7aaad', fontSize: 22 }}>{max || '100'}</span>
					</div>
				</div>
				<div style={{ ...abs(0, 440, MODAL.w, 1), background: '#dcdcde' }} />
				<div style={{ ...abs(32, 470), fontSize: 19, color: c.wpBlue }}>ⓘ Learn more about fee recovery</div>
				<div
					style={{
						...abs(MODAL.w - 32 - 140, 458, 140, 56),
						background: updateHover ? '#135e96' : c.wpBlue,
						borderRadius: 6,
						color: '#fff',
						fontSize: 21,
						fontWeight: 500,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
					}}
				>
					Update
				</div>
			</div>
		</>
	);
};
