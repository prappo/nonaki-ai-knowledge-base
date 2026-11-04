import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Release Console UI, served by the Nonaki app at /release-console/ and
// talking to an agent's console through ?api=<tunnel path>.
export default defineConfig( {
	root: 'console/web',
	base: './',
	plugins: [ react() ],
	build: {
		outDir: '../../dist-ui',
		emptyOutDir: true,
	},
} );
