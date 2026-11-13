import React from 'react';
import { Composition } from 'remotion';
import { FeeRecoveryVideo } from './Video';
import { TOTAL_FRAMES } from './config';
import { FPS } from './theme';

export const RemotionRoot: React.FC = () => (
	<Composition id="FeeRecovery" component={FeeRecoveryVideo} durationInFrames={TOTAL_FRAMES} fps={FPS} width={1920} height={1080} />
);
