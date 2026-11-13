import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion';
import { c, font, shadow } from '../theme';
import { Camera, Cursor, Headline, StatCard, Check } from '../components/core';
import { count, ease, lerp, money, pop, typed } from '../components/motion';
import { AdminWindow, CONFIGURE_X, FeeModal, PM_ROW_Y, PaymentMethodsPanel } from '../components/admin';
import { ADD_BTN, FieldsPanel, MENU_TOGGLE } from '../components/fields';
import { DonationCard, DonorForm } from '../components/donor';

const Footnote: React.FC<{ text: string; at?: number }> = ({ text, at = 10 }) => {
	const frame = useCurrentFrame();
	return (
		<div
			style={{
				position: 'absolute',
				bottom: 26,
				width: '100%',
				textAlign: 'center',
				fontFamily: font.ui,
				fontSize: 18,
				color: c.muted,
				opacity: ease(frame, at, at + 15),
			}}
		>
			{text}
		</div>
	);
};

const Toast: React.FC<{ at: number; text: string }> = ({ at, text }) => {
	const frame = useCurrentFrame();
	const p = pop(frame, at, 14);
	return (
		<div
			style={{
				position: 'absolute',
				left: 960 - 260,
				top: 900,
				width: 520,
				height: 70,
				borderRadius: 35,
				background: c.ink,
				color: '#fff',
				fontFamily: font.ui,
				fontSize: 22,
				fontWeight: 500,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				gap: 12,
				boxShadow: shadow.pop,
				opacity: Math.min(1, p),
				transform: `translateY(${(1 - p) * 30}px)`,
				zIndex: 60,
			}}
		>
			<Check on={1} size={26} color={c.green} /> {text}
		</div>
	);
};

/* 1 — Hook ---------------------------------------------------------- */
export const S1: React.FC = () => {
	const frame = useCurrentFrame();
	const p = pop(frame, 10, 16);
	return (
		<AbsoluteFill>
			<Headline text="Every donation. *Fully received.*" />
			<DonationCard
				x={660}
				y={300}
				feeIn={0}
				receive={50}
				style={{ opacity: Math.min(1, p), transform: `translateY(${(1 - p) * 60 + Math.sin(frame / 25) * 6}px)` }}
			/>
		</AbsoluteFill>
	);
};

/* 2 — The pain ------------------------------------------------------ */
export const S2: React.FC = () => {
	const frame = useCurrentFrame();
	const feeIn = ease(frame, 26, 42);
	const receive = count(frame, 38, 70, 50, 48.25);
	const shift = lerp(frame, [100, 125], [0, -300]);
	const lost = count(frame, 130, 200, 0, 2100);
	const p = pop(frame, 112, 14);
	return (
		<AbsoluteFill>
			<Headline text="Not *$1.75 lost* to fees." start={2} />
			<DonationCard x={660 + shift} y={300} feeIn={feeIn} receive={receive} style={{ transform: `translateY(${Math.sin(frame / 25) * 6}px)` }} />
			<div
				style={{
					position: 'absolute',
					left: 1010,
					top: 340,
					width: 540,
					padding: 40,
					boxSizing: 'border-box',
					background: '#fff',
					borderRadius: 24,
					boxShadow: shadow.card,
					fontFamily: font.ui,
					opacity: Math.min(1, p),
					transform: `translateX(${(1 - p) * 80}px)`,
				}}
			>
				<div style={{ fontSize: 22, color: c.muted }}>1,200 donations a year</div>
				<div style={{ fontSize: 22, color: c.muted, marginTop: 4 }}>× $1.75 in fees</div>
				<div style={{ fontSize: 104, fontWeight: 700, color: c.red, letterSpacing: -3, marginTop: 18 }}>
					−{money(lost, 0)}
				</div>
				<div style={{ fontSize: 22, color: c.text, marginTop: 6 }}>gone before it reaches the animals</div>
			</div>
		</AbsoluteFill>
	);
};

/* 3 — Meet Fee Recovery -------------------------------------------- */
export const S3: React.FC = () => (
	<AbsoluteFill>
		<Headline text="Meet *Fee Recovery*" size={72} top={62} />
		<Camera keys={[{ f: 0, s: 0.93, x: 960, y: 640 }, { f: 120, s: 1, x: 960, y: 620 }]}>
			<AdminWindow tab="Payment">
				<PaymentMethodsPanel />
			</AdminWindow>
		</Camera>
	</AbsoluteFill>
);

/* 4 — Set it once (card fee settings) ------------------------------ */
export const S4: React.FC = () => {
	const frame = useCurrentFrame();
	const cardY = PM_ROW_Y(0) + 36;
	const modalOut = ease(frame, 120, 130);
	return (
		<AbsoluteFill>
			<Headline text="Set it *once*" size={72} top={62} />
			<Camera
				keys={[
					{ f: 0, s: 1, x: 960, y: 620 },
					{ f: 24, s: 1.3, x: 1400, y: cardY },
					{ f: 32, s: 1.3, x: 1400, y: cardY },
					{ f: 44, s: 1, x: 960, y: 620 },
				]}
			>
				<AdminWindow tab="Payment">
					<PaymentMethodsPanel focus="Card" dim={ease(frame, 6, 22) * (1 - ease(frame, 32, 40))} />
				</AdminWindow>
				{frame >= 30 && (
					<div style={{ opacity: 1 - modalOut }}>
						<FeeModal
							at={32}
							title={'Configure "Credit Card" Payment Method'}
							first={{ label: 'Mobile Wallets', text: 'Enable Apple Pay, Google Pay, and Microsoft Pay mobile wallets.' }}
							checked={frame >= 50 ? pop(frame, 50, 12) : 0}
							pct={typed('2.9', frame, 62, 10)}
							fixed={typed('0.30', frame, 80, 12)}
							max=""
							updateHover={frame >= 108 ? 1 : 0}
						/>
					</div>
				)}
				<Cursor
					appear={2}
					keys={[
						{ f: 0, x: 1250, y: 860 },
						{ f: 26, x: CONFIGURE_X, y: cardY, click: true },
						{ f: 46, x: 595, y: 550 },
						{ f: 50, x: 595, y: 550, click: true },
						{ f: 58, x: 682, y: 612, click: true },
						{ f: 74, x: 912, y: 612 },
						{ f: 78, x: 912, y: 612, click: true },
						{ f: 108, x: 1268, y: 786 },
						{ f: 114, x: 1268, y: 786, click: true },
						{ f: 150, x: 1320, y: 900 },
					]}
				/>
			</Camera>
			{frame >= 128 && <Toast at={128} text="Fee Recovery is on for Card" />}
		</AbsoluteFill>
	);
};

/* 5 — Let donors choose (add the toggle field) --------------------- */
export const S5: React.FC = () => {
	const frame = useCurrentFrame();
	const menuOpen = ease(frame, 27, 34) * (1 - ease(frame, 52, 58));
	const toggleIn = ease(frame, 54, 72);
	const breakdownIn = ease(frame, 100, 114);
	const dim = ease(frame, 66, 84);
	return (
		<AbsoluteFill>
			<Headline text="Let donors *choose*" size={72} top={62} />
			<Camera
				mask={ease(frame, 60, 80)}
				keys={[
					{ f: 0, s: 1, x: 960, y: 620 },
					{ f: 60, s: 1, x: 960, y: 620 },
					{ f: 92, s: 1.2, x: 1120, y: 820 },
				]}
			>
				<AdminWindow tab="Form Fields">
					<FieldsPanel menuOpen={menuOpen} hoverToggle={frame >= 42 ? 1 : 0} toggleIn={toggleIn} breakdownIn={breakdownIn} dim={dim} />
				</AdminWindow>
				<Cursor
					appear={2}
					hide={70}
					keys={[
						{ f: 0, x: 1150, y: 880 },
						{ f: 22, x: ADD_BTN.x, y: ADD_BTN.y },
						{ f: 26, x: ADD_BTN.x, y: ADD_BTN.y, click: true },
						{ f: 44, x: MENU_TOGGLE.x, y: MENU_TOGGLE.y },
						{ f: 50, x: MENU_TOGGLE.x, y: MENU_TOGGLE.y, click: true },
						{ f: 80, x: 1300, y: 760 },
					]}
				/>
			</Camera>
		</AbsoluteFill>
	);
};

/* 6 — Donors see exactly what they cover --------------------------- */
export const S6: React.FC = () => {
	const frame = useCurrentFrame();
	const checked = frame >= 44 ? pop(frame, 44, 12) : 0;
	const feeIn = ease(frame, 46, 62);
	const fee = count(frame, 48, 76, 0, 1.8);
	return (
		<AbsoluteFill>
			<Headline text="Donors see *exactly* what they cover" size={68} top={62} />
			<Camera
				mask={ease(frame, 78, 100)}
				keys={[
					{ f: 0, s: 0.92, x: 960, y: 640 },
					{ f: 78, s: 0.92, x: 960, y: 640 },
					{ f: 108, s: 1.22, x: 960, y: 700 },
				]}
			>
				<DonorForm checked={checked} feeIn={feeIn} fee={fee} cardText={typed('4242 4242 4242 4242', frame, 112, 30)} />
				<Cursor
					appear={4}
					keys={[
						{ f: 0, x: 1420, y: 900 },
						{ f: 38, x: 712, y: 636 },
						{ f: 44, x: 712, y: 636, click: true },
						{ f: 100, x: 760, y: 720 },
						{ f: 170, x: 960, y: 950 },
						{ f: 182, x: 960, y: 950, click: true },
					]}
				/>
			</Camera>
		</AbsoluteFill>
	);
};

/* 7 — Priya gets the full gift ------------------------------------- */
export const S7: React.FC = () => {
	const frame = useCurrentFrame();
	const p = pop(frame, 4, 15);
	const badge = pop(frame, 22, 10);
	const strike = ease(frame, 78, 92);
	const ghost = pop(frame, 64, 14);
	const row = (l: string, v: string, col: string = c.text, bold = false) => (
		<div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 24, color: col, fontWeight: bold ? 700 : 500, marginTop: 14 }}>
			<span>{l}</span>
			<span>{v}</span>
		</div>
	);
	return (
		<AbsoluteFill>
			<Headline text="Priya gets *$50.00.* Not $48.25." size={72} top={62} />
			<div
				style={{
					position: 'absolute',
					left: 560,
					top: 340,
					width: 640,
					padding: 44,
					boxSizing: 'border-box',
					background: '#fff',
					borderRadius: 24,
					boxShadow: shadow.card,
					fontFamily: font.ui,
					opacity: Math.min(1, p),
					transform: `translateY(${(1 - p) * 50}px)`,
				}}
			>
				<div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
					<div
						style={{
							width: 64,
							height: 64,
							borderRadius: 32,
							background: c.green,
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							transform: `scale(${badge})`,
						}}
					>
						<svg width="34" height="34" viewBox="0 0 16 16">
							<path d="M3 8.5 L6.5 12 L13 4.5" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
					</div>
					<div>
						<div style={{ fontSize: 28, fontWeight: 700, color: c.ink }}>Payment received</div>
						<div style={{ fontSize: 19, color: c.muted }}>Jordan Lee · Riverbend Donations</div>
					</div>
				</div>
				<div style={{ height: 1, background: c.line, margin: '30px 0 6px' }} />
				{row('Donor paid', '$51.80')}
				{row('Stripe processing fee', '−$1.80', c.muted)}
				<div style={{ height: 1, background: c.line, margin: '22px 0 10px' }} />
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
					<span style={{ fontSize: 26, fontWeight: 600, color: c.ink }}>Riverbend receives</span>
					<span style={{ fontSize: 76, fontWeight: 800, color: c.green, letterSpacing: -2 }}>$50.00</span>
				</div>
			</div>
			<div
				style={{
					position: 'absolute',
					left: 1250,
					top: 640,
					width: 360,
					padding: '24px 28px',
					boxSizing: 'border-box',
					background: 'rgba(255,255,255,0.75)',
					borderRadius: 18,
					boxShadow: shadow.pop,
					fontFamily: font.ui,
					opacity: Math.min(1, ghost) * 0.95,
					transform: `translateY(${(1 - ghost) * 30}px) rotate(2deg)`,
				}}
			>
				<div style={{ fontSize: 18, color: c.muted }}>Without Fee Recovery</div>
				<div style={{ position: 'relative', display: 'inline-block', fontSize: 52, fontWeight: 700, color: '#9aa0a6', marginTop: 4 }}>
					$48.25
					<div style={{ position: 'absolute', left: -4, top: '52%', height: 5, borderRadius: 3, background: c.red, width: `${strike * 104}%` }} />
				</div>
			</div>
		</AbsoluteFill>
	);
};

/* 8 — Most donors say yes ------------------------------------------ */
export const S8: React.FC = () => {
	const frame = useCurrentFrame();
	const ring = count(frame, 24, 80, 0, 72);
	const kept = count(frame, 96, 170, 0, 1512);
	const p1 = pop(frame, 6, 14);
	const p2 = pop(frame, 86, 14);
	const R = 120;
	const C = 2 * Math.PI * R;
	const bars = [70, 82, 76, 95, 104, 98, 120, 131, 126, 142, 150, 168];
	return (
		<AbsoluteFill style={{ fontFamily: font.ui }}>
			<Headline text="Most donors *say yes*" size={72} top={62} />
			<div
				style={{
					position: 'absolute',
					left: 330,
					top: 250,
					width: 580,
					height: 600,
					background: '#fff',
					borderRadius: 24,
					boxShadow: shadow.card,
					opacity: Math.min(1, p1),
					transform: `translateY(${(1 - p1) * 50}px)`,
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					justifyContent: 'center',
				}}
			>
				<div style={{ position: 'relative', width: 300, height: 300 }}>
					<svg width="300" height="300" style={{ transform: 'rotate(-90deg)' }}>
						<circle cx="150" cy="150" r={R} fill="none" stroke="#eef0f2" strokeWidth="30" />
						<circle
							cx="150"
							cy="150"
							r={R}
							fill="none"
							stroke={c.wpspBlue}
							strokeWidth="30"
							strokeLinecap="round"
							strokeDasharray={C}
							strokeDashoffset={C * (1 - ring / 100)}
						/>
					</svg>
					<div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 84, fontWeight: 800, color: c.ink, letterSpacing: -3 }}>
						{Math.round(ring)}%
					</div>
				</div>
				<div style={{ fontSize: 28, fontWeight: 600, color: c.ink, marginTop: 30 }}>of donors cover the fee</div>
				<div style={{ fontSize: 21, color: c.muted, marginTop: 8 }}>864 of 1,200 donations this year</div>
			</div>
			<div
				style={{
					position: 'absolute',
					left: 970,
					top: 250,
					width: 620,
					height: 600,
					padding: 44,
					boxSizing: 'border-box',
					background: '#fff',
					borderRadius: 24,
					boxShadow: shadow.card,
					opacity: Math.min(1, p2),
					transform: `translateY(${(1 - p2) * 50}px)`,
				}}
			>
				<div style={{ fontSize: 22, color: c.muted }}>Kept this year</div>
				<div style={{ fontSize: 112, fontWeight: 800, color: c.green, letterSpacing: -4, marginTop: 4 }}>+{money(kept, 0)}</div>
				<div style={{ fontSize: 22, color: c.text, marginTop: 2 }}>Same donors. No extra asks.</div>
				<div style={{ position: 'absolute', left: 44, right: 44, bottom: 44, height: 200, display: 'flex', alignItems: 'flex-end', gap: 12 }}>
					{bars.map((b, i) => {
						const h = ease(frame, 104 + i * 4, 124 + i * 4) * b;
						return <div key={i} style={{ flex: 1, height: h, borderRadius: 6, background: i === bars.length - 1 ? c.green : '#bfe3d6' }} />;
					})}
				</div>
			</div>
		</AbsoluteFill>
	);
};

/* 9 — Bank payments, capped ---------------------------------------- */
export const S9: React.FC = () => {
	const frame = useCurrentFrame();
	const achY = PM_ROW_Y(1) + 36;
	const back = ease(frame, 100, 116);
	const card = pop(frame, 104, 14);
	const capped = ease(frame, 128, 140);
	return (
		<AbsoluteFill>
			<Headline text="Bank payments? *Capped.*" size={72} top={62} />
			<Camera keys={[{ f: 0, s: 1, x: 960, y: 620 }, { f: 100, s: 1, x: 960, y: 620 }, { f: 120, s: 1.04, x: 700, y: 620 }]} blur={back * 5}>
				<div style={{ opacity: 1 - back * 0.35 }}>
					<AdminWindow tab="Payment">
						<PaymentMethodsPanel />
					</AdminWindow>
					{frame >= 20 && (
						<FeeModal
							at={22}
							title={'Configure "ACH Direct Debit" Payment Method'}
							first={{ label: 'Verification', text: 'Allow manual bank account entry' }}
							checked={frame >= 38 ? pop(frame, 38, 12) : 0}
							pct={typed('0.8', frame, 46, 14)}
							fixed={typed('0.00', frame, 56, 16)}
							max={typed('5.00', frame, 76, 14)}
							maxFocus={frame >= 72 ? 1 : 0}
							overlayFade={back}
						/>
					)}
					<Cursor
						appear={2}
						hide={96}
						keys={[
							{ f: 0, x: 1250, y: 860 },
							{ f: 16, x: CONFIGURE_X, y: achY, click: true },
							{ f: 34, x: 595, y: 550 },
							{ f: 38, x: 595, y: 550, click: true },
							{ f: 66, x: 772, y: 684 },
							{ f: 70, x: 772, y: 684, click: true },
						]}
					/>
				</div>
			</Camera>
			<div
				style={{
					position: 'absolute',
					left: 1110,
					top: 330,
					width: 560,
					padding: 40,
					boxSizing: 'border-box',
					background: '#fff',
					borderRadius: 24,
					boxShadow: shadow.pop,
					fontFamily: font.ui,
					opacity: Math.min(1, card),
					transform: `translateX(${(1 - card) * 120}px)`,
				}}
			>
				<div style={{ fontSize: 20, color: c.muted }}>ACH Direct Debit · $1,000 gift</div>
				{[
					['Subtotal', '$1,000.00'],
					['Processing fee', null],
					['Total due', '$1,005.00'],
				].map(([l, v], i) => (
					<div
						key={l as string}
						style={{
							display: 'flex',
							justifyContent: 'space-between',
							alignItems: 'center',
							fontSize: 26,
							fontWeight: i === 2 ? 700 : 600,
							color: c.ink,
							marginTop: 22,
						}}
					>
						<span>{l}</span>
						{v ?? (
							<span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
								<span style={{ position: 'relative', color: '#9aa0a6', fontSize: 22, fontWeight: 500 }}>
									$8.06
									<span style={{ position: 'absolute', left: -2, top: '50%', height: 3, background: c.red, width: `${capped * 110}%` }} />
								</span>
								<span style={{ opacity: capped }}>$5.00</span>
							</span>
						)}
					</div>
				))}
				<div
					style={{
						marginTop: 26,
						display: 'inline-flex',
						alignItems: 'center',
						gap: 8,
						padding: '8px 16px',
						borderRadius: 20,
						background: c.greenSoft,
						color: c.green,
						fontSize: 19,
						fontWeight: 600,
						opacity: capped,
					}}
				>
					Fee capped at $5.00
				</div>
			</div>
			<Footnote text="Fee Recovery for ACH and other non-card payment methods requires a Plus license or higher." at={110} />
		</AbsoluteFill>
	);
};

/* 10 — End card ---------------------------------------------------- */
export const S10: React.FC = () => {
	const frame = useCurrentFrame();
	const logo = pop(frame, 4, 16);
	const btn = pop(frame, 34, 13);
	return (
		<AbsoluteFill>
			<div
				style={{
					position: 'absolute',
					top: 300,
					width: '100%',
					display: 'flex',
					justifyContent: 'center',
					opacity: Math.min(1, logo),
					transform: `translateY(${(1 - logo) * 30}px)`,
				}}
			>
				<Img src={staticFile('logo.svg')} style={{ width: 620 }} />
			</div>
			<Headline text="Keep every dollar *they give.*" size={72} top={450} start={14} />
			<div
				style={{
					position: 'absolute',
					top: 620,
					width: '100%',
					display: 'flex',
					justifyContent: 'center',
					opacity: Math.min(1, btn),
					transform: `scale(${0.9 + btn * 0.1})`,
				}}
			>
				<div
					style={{
						padding: '24px 46px',
						borderRadius: 44,
						background: c.wpspBlue,
						color: '#fff',
						fontFamily: font.ui,
						fontSize: 30,
						fontWeight: 600,
						boxShadow: '0 18px 40px -12px rgba(66,139,202,0.7)',
					}}
				>
					Get WP Simple Pay →
				</div>
			</div>
			<div style={{ position: 'absolute', top: 740, width: '100%', textAlign: 'center', fontFamily: font.ui, fontSize: 24, color: c.muted, opacity: ease(frame, 44, 58) }}>
				wpsimplepay.com
			</div>
			<Footnote text="Fee Recovery is included with every license for card payments." at={50} />
		</AbsoluteFill>
	);
};

export const SCENE_COMPONENTS: Record<string, React.FC> = { s1: S1, s2: S2, s3: S3, s4: S4, s5: S5, s6: S6, s7: S7, s8: S8, s9: S9, s10: S10 };
