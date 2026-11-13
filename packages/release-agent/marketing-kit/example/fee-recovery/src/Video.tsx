import React from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile } from 'remotion';
import { Background, SceneFrame } from './components/core';
import { SCENE_COMPONENTS } from './scenes';
import { TOTAL_FRAMES, timeline } from './config';

const MUSIC_FULL = 0.3;
const MUSIC_DUCKED = 0.14;

/** Music volume: fade in, duck under each voiceover line, fade out at the end. */
const musicVolume = (f: number) => {
	let duck = 0;
	for (const s of timeline) {
		const d = interpolate(f, [s.voFrom - 8, s.voFrom, s.voTo, s.voTo + 12], [0, 1, 1, 0], {
			extrapolateLeft: 'clamp',
			extrapolateRight: 'clamp',
		});
		duck = Math.max(duck, d);
	}
	const base = MUSIC_FULL - (MUSIC_FULL - MUSIC_DUCKED) * duck;
	const fade = interpolate(f, [0, 20, TOTAL_FRAMES - 70, TOTAL_FRAMES - 2], [0, 1, 1, 0], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	return base * fade;
};

export const FeeRecoveryVideo: React.FC = () => (
	<AbsoluteFill>
		<Background />
		<Audio src={staticFile('music.mp3')} volume={musicVolume} />
		{timeline.map((s) => {
			const Scene = SCENE_COMPONENTS[s.id];
			return (
				<Sequence key={s.id} from={s.from} durationInFrames={s.frames} name={s.id}>
					<SceneFrame dur={s.frames}>
						<Scene />
					</SceneFrame>
				</Sequence>
			);
		})}
		{timeline.map((s) => (
			<Sequence key={`vo-${s.id}`} from={s.voFrom} name={`vo-${s.id}`}>
				<Audio src={staticFile(`vo/${s.id}.mp3`)} volume={1} />
			</Sequence>
		))}
	</AbsoluteFill>
);
