import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { RoverLaunch } from './video';

const Root: React.FC = () => (
  <Composition
    id="RoverLaunch"
    component={RoverLaunch}
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={810}
  />
);

registerRoot(Root);
