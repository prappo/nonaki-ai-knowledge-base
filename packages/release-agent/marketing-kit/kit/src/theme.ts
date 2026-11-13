import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadJakarta } from '@remotion/google-fonts/PlusJakartaSans';

const inter = loadInter('normal', { weights: ['400', '500', '600', '700'], subsets: ['latin'] });
const jakarta = loadJakarta('normal', { weights: ['600', '700', '800'], subsets: ['latin'] });

export const FPS = 30;

export const font = {
	ui: inter.fontFamily,
	head: jakarta.fontFamily,
};

export const c = {
	bgTop: '#f8f3ec',
	bgBottom: '#f3dcc8',
	ink: '#1d2327',
	text: '#3c434a',
	muted: '#646970',
	line: '#dcdcde',
	soft: '#f6f7f7',
	wpBlue: '#2271b1',
	wpspBlue: '#428BCA',
	sidebar: '#1d2327',
	sidebarActive: '#2271b1',
	green: '#10846a',
	greenSoft: '#e3f4ee',
	red: '#d63638',
	redSoft: '#fcebeb',
	highlight: '#cde3ff',
	white: '#ffffff',
};

export const shadow = {
	card: '0 30px 80px -20px rgba(80, 50, 20, 0.28), 0 8px 24px -8px rgba(80, 50, 20, 0.18)',
	pop: '0 24px 60px -12px rgba(30, 40, 60, 0.35), 0 6px 18px -6px rgba(30, 40, 60, 0.2)',
};
