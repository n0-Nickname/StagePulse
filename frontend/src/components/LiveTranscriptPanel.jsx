import React, { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Copy, Check, Download, ArrowDown } from 'lucide-react';
import { useTranslation } from '../context/LanguageContext.jsx';
import {
  speechStore,
  useTranscriptCommitted,
  useTranscriptTail,
  useFillerMetrics,
  segmentTextByFillers,
} from '../stores/speechStore.js';

const CommittedTranscriptBlock = memo(function CommittedTranscriptBlock({
  block,
  isPro,
  userFillerWords,
  deferOffscreen,
}) {
  const segments = useMemo(
    () => segmentTextByFillers(block.text, userFillerWords, isPro),
    [block.text, userFillerWords, isPro]
  );

  return (
    <span
      data-testid="committed-transcript-block"
      className="inline"
      style={
        deferOffscreen
          ? { contentVisibility: 'auto', containIntrinsicSize: 'auto 3.5rem' }
          : undefined
      }
    >
      {segments.map((seg, idx) =>
        seg.isFiller ? (
          <mark
            key={idx}
            className="bg-[#FF6363]/20 text-[#FCA5A5] px-1 rounded font-medium"
          >
            {seg.text}
          </mark>
        ) : (
          <React.Fragment key={idx}>{seg.text}</React.Fragment>
        )
      )}{' '}
    </span>
  );
});

const LiveTranscriptTail = memo(function LiveTranscriptTail({
  store,
  partialOverride,
  onTailChange,
}) {
  const { partialText } = useTranscriptTail(store);
  const text = partialOverride !== undefined ? partialOverride : partialText;

  useEffect(() => {
    onTailChange?.(text);
  }, [onTailChange, text]);

  if (!text) return null;
  return (
    <span
      data-testid="live-transcript-tail"
      className="text-[#C4B5FD]/90 italic"
    >
      {text}
    </span>
  );
});

function LiveTranscriptPanel({
  title,
  transcript: transcriptProp,
  isPro: isProProp,
  userFillerWords: userFillerWordsProp,
  store = speechStore,
}) {
  const { t } = useTranslation();
  const { committedBlocks, committedText } = useTranscriptCommitted(store);
  const fillerMetrics = useFillerMetrics(store);
  const isPro = isProProp !== undefined ? isProProp : fillerMetrics.isPro;
  const userFillerWords =
    userFillerWordsProp !== undefined ? userFillerWordsProp : fillerMetrics.userFillerWords;
  const scrollContainerRef = useRef(null);
  const isUserScrolledUpRef = useRef(false);
  const [showJumpBtn, setShowJumpBtn] = useState(false);
  const [copied, setCopied] = useState(false);

  const hasPropOverride = transcriptProp !== undefined;
  const storeHasContent = useSyncExternalStore(
    store.subscribe,
    () => Boolean(store.getState().fullText || store.getState().committedBlocks.length)
  );
  const hasBlocks = !hasPropOverride && committedBlocks.length > 0;
  const hasContent = hasPropOverride ? Boolean(transcriptProp) : storeHasContent;

  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    el.scrollTop = el.scrollHeight;
    isUserScrolledUpRef.current = false;
    setShowJumpBtn(false);
  }, []);

  const scrollToBottomIfAnchored = useCallback(() => {
    if (isUserScrolledUpRef.current) return;
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  useEffect(() => {
    if (!hasContent) return;
    scrollToBottomIfAnchored();
  }, [hasContent, committedBlocks.length, transcriptProp, scrollToBottomIfAnchored]);

  if (!hasContent) return null;

  const handleScroll = (e) => {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const scrolledUp = distanceFromBottom > 24;
    isUserScrolledUpRef.current = scrolledUp;
    setShowJumpBtn(scrolledUp);
  };

  const handleCopy = async () => {
    const textToCopy = hasPropOverride
      ? transcriptProp
      : store.getState().fullText || committedText;
    try {
      await navigator.clipboard?.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const handleExportTxt = () => {
    const textToExport = hasPropOverride
      ? transcriptProp
      : store.getState().fullText || committedText;
    const blob = new Blob([textToExport], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `stagepulse-transcript-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="obsidian-glass rounded-2xl p-4 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-medium text-[#9CA3AF]">{title}</div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium obsidian-inset text-[#D1D5DB] hover:text-[#F4F5F7] hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-[#10B981]" />
                {t('transcript.copied')}
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                {t('transcript.copy')}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleExportTxt}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium obsidian-inset text-[#D1D5DB] hover:text-[#F4F5F7] hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            {t('transcript.exportTxt')}
          </button>
        </div>
      </div>

      <div className="relative">
        <div
          ref={scrollContainerRef}
          data-testid="transcript-scroll-container"
          onScroll={handleScroll}
          className="max-h-56 sm:max-h-64 overflow-y-auto pr-1 text-sm text-[#F4F5F7] leading-relaxed"
        >
          {hasBlocks &&
            committedBlocks.map((block, idx) => (
              <CommittedTranscriptBlock
                key={block.id}
                block={block}
                isPro={isPro}
                userFillerWords={userFillerWords}
                deferOffscreen={idx < committedBlocks.length - 1}
              />
            ))}
          <LiveTranscriptTail
            store={store}
            partialOverride={hasPropOverride ? transcriptProp : undefined}
            onTailChange={scrollToBottomIfAnchored}
          />
        </div>

        {showJumpBtn && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-2 right-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#181920]/95 border border-white/[0.14] text-[#F4F5F7] shadow-lg hover:bg-[#232530] cursor-pointer"
          >
            <ArrowDown className="h-3 w-3 text-[#8B5CF6]" />
            {t('transcript.jumpToLatest')}
          </button>
        )}
      </div>
    </div>
  );
}

export default memo(LiveTranscriptPanel);
