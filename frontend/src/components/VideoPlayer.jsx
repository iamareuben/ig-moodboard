import React, { useRef, useEffect } from 'react';
import { videoUrl } from '../api.js';

export default function VideoPlayer({ videoId, onTimeUpdate, seekTo }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (seekTo !== undefined && videoRef.current) {
      videoRef.current.currentTime = seekTo;
    }
  }, [seekTo]);

  return (
    <video
      ref={videoRef}
      src={videoUrl(videoId)}
      controls
      style={{
        width: '100%',
        display: 'block',
        background: '#000',
        maxHeight: '360px',
      }}
      onTimeUpdate={() => {
        if (videoRef.current && onTimeUpdate) {
          onTimeUpdate(videoRef.current.currentTime);
        }
      }}
    />
  );
}
