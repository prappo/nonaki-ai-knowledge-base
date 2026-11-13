import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { c } from '../theme';
import { Check } from './core';
import { ease } from './motion';
import { PANEL } from './admin';

/*
 * Form Fields panel. Screen coords:
 *   "+ Add Field" button center (1535, 426)
 *   menu item "Fee Recovery Toggle" center (1500, 617)
 */
export const ADD_BTN = { x: 1535, y: 426 };
export const MENU_TOGGLE = { x: 1480, y: 617 };

const STEP = 64;
const ROW_H = 56;
const TOGGLE_BODY = 150;
const MENU_ITEMS = ['Text', 'Dropdown', 'Checkbox', 'Fee Recovery Toggle', 'Amount Breakdown'];

const Row: React.FC<{ y: number; label: string; type: string; isNew?: number; dim?: number; body?: number; children?: React.ReactNode }> = ({
	y,
	label,
	type,
	isNew = 0,
	dim = 0,
	body = 0,
	children,
}) => (
	<div
		style={{
			position: 'absolute',
			left: PANEL.x,
			top: y,
			width: PANEL.w - 30,
			height: ROW_H + body,
			border: `${isNew ? 2 : 1}px solid ${isNew ? c.wpspBlue : '#c3c4c7'}`,
			borderRadius: 6,
			background: '#fff',
			boxSizing: 'border-box',
			overflow: 'hidden',
			opacity: 1 - dim * 0.5,
			filter: dim ? `blur(${dim * 1.6}px)` : undefined,
			boxShadow: isNew ? `0 10px 30px -10px rgba(66,139,202,${0.5 * isNew})` : undefined,
		}}
	>
		<div style={{ height: ROW_H - 2, display: 'flex', alignItems: 'center', padding: '0 20px', gap: 16, fontSize: 20 }}>
			<span style={{ color: '#50575e', fontSize: 22 }}>≡</span>
			<span style={{ fontWeight: 600, color: c.ink }}>{label}</span>
			<span style={{ marginLeft: 'auto', color: '#787c82', fontSize: 18 }}>{type}</span>
			<span style={{ color: '#787c82', fontSize: 14 }}>{body > 10 ? '▲' : '▼'}</span>
		</div>
		{children}
	</div>
);

export const FieldsPanel: React.FC<{ menuOpen: number; hoverToggle: number; toggleIn: number; breakdownIn: number; dim: number }> = ({
	menuOpen,
	hoverToggle,
	toggleIn,
	breakdownIn,
	dim,
}) => {
	const frame = useCurrentFrame();
	const top = 470;
	const toggleH = toggleIn * (STEP + TOGGLE_BODY);
	const breakdownH = breakdownIn * STEP;
	const after = top + 3 * STEP + toggleH + breakdownH;
	void frame;
	return (
		<>
			<div style={{ position: 'absolute', left: PANEL.x, top: PANEL.y + 6, fontSize: 22, fontWeight: 600, color: c.ink }}>Form Fields</div>
			<div
				style={{
					position: 'absolute',
					left: 1440,
					top: 404,
					width: 190,
					height: 44,
					borderRadius: 6,
					border: `1px solid ${c.wpBlue}`,
					color: c.wpBlue,
					fontSize: 18,
					fontWeight: 500,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					background: menuOpen ? '#f0f6fc' : '#fff',
				}}
			>
				+ Add Field
			</div>

			<Row y={top} label="Full Name" type="Name" dim={dim} />
			<Row y={top + STEP} label="Email Address" type="Email" dim={dim} />
			<Row y={top + 2 * STEP} label="Donation Amount" type="Price Selector" dim={dim} />

			{toggleIn > 0 && (
				<div style={{ opacity: toggleIn, transform: `translateY(${(1 - toggleIn) * -14}px)` }}>
					<Row y={top + 3 * STEP} label="I will cover the processing fee" type="Fee Recovery Toggle" isNew={1} body={TOGGLE_BODY * toggleIn}>
						<div style={{ padding: '14px 20px', background: '#f6f7f7', height: TOGGLE_BODY, boxSizing: 'border-box', borderTop: '1px solid #dcdcde' }}>
							<div style={{ fontSize: 17, fontWeight: 600, color: c.text }}>Label</div>
							<div
								style={{
									marginTop: 8,
									width: 560,
									height: 44,
									border: '1px solid #8c8f94',
									borderRadius: 6,
									background: '#fff',
									display: 'flex',
									alignItems: 'center',
									padding: '0 14px',
									fontSize: 18,
									color: c.ink,
								}}
							>
								I will cover the processing fee
							</div>
							<div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, fontSize: 17, color: c.text }}>
								<span style={{ fontWeight: 600 }}>Checked by default</span>
								<Check on={0} size={20} /> Yes
							</div>
						</div>
					</Row>
				</div>
			)}

			{breakdownIn > 0 && (
				<div style={{ opacity: breakdownIn, transform: `translateY(${(1 - breakdownIn) * -14}px)` }}>
					<Row y={top + 3 * STEP + toggleH} label="Amount Breakdown" type="Amount Breakdown" isNew={1} />
				</div>
			)}

			<Row y={after} label="Payment Methods" type="Payment Methods" dim={dim} />
			<Row y={after + STEP} label="Donate" type="Payment Button" dim={dim} />

			{/* dropdown menu */}
			{menuOpen > 0 && (
				<div
					style={{
						position: 'absolute',
						left: 1370,
						top: 456,
						width: 260,
						background: '#fff',
						borderRadius: 8,
						boxShadow: '0 14px 40px -8px rgba(0,0,0,0.3)',
						border: '1px solid #dcdcde',
						overflow: 'hidden',
						opacity: menuOpen,
						transform: `translateY(${(1 - menuOpen) * -10}px)`,
						zIndex: 20,
					}}
				>
					{MENU_ITEMS.map((m) => {
						const hov = m === 'Fee Recovery Toggle' ? hoverToggle : 0;
						return (
							<div
								key={m}
								style={{
									height: 46,
									display: 'flex',
									alignItems: 'center',
									padding: '0 18px',
									fontSize: 18,
									color: hov ? '#fff' : c.text,
									background: interpolate(hov, [0, 1], [0, 1]) ? c.wpBlue : '#fff',
								}}
							>
								{m}
							</div>
						);
					})}
				</div>
			)}
		</>
	);
};

export const useEase = ease;
