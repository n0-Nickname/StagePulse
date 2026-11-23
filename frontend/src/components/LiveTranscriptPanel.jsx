import React, { memo } from 'react';

function LiveTranscriptPanel({ title, transcript }) {
  if (!transcript) return null;
  return (
    <div className="obsidian-glass rounded-2xl p-4">
      <div className="text-xs font-medium text-[#9CA3AF] mb-1.5">{title}</div>
      <p className="text-sm text-[#F4F5F7] leading-relaxed">{transcript}</p>
    </div>
  );
}

export default memo(LiveTranscriptPanel);
