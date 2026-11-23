import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import LiveTranscriptPanel from './LiveTranscriptPanel.jsx';
import { LanguageProvider } from '../context/LanguageContext.jsx';
import { createSpeechStore, buildCommittedBlocks } from '../stores/speechStore.js';

describe('LiveTranscriptPanel', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when transcript and blocks are empty', () => {
    const store = createSpeechStore();
    const { container } = render(
      <LanguageProvider>
        <LiveTranscriptPanel title="Live transcript" store={store} />
      </LanguageProvider>
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders 1,500+ words in memoized committed blocks with content-visibility and filler highlights without re-rendering earlier blocks', () => {
    const store = createSpeechStore();
    const words1500 = Array.from({ length: 1500 }, (_, i) => ({
      text: i === 5 ? 'basically' : `token${i}`,
      join: false,
    }));
    const blocks = buildCommittedBlocks(words1500, []);

    act(() => {
      store.patch({
        isPro: true,
        userFillerWords: ['basically'],
        committedWords: words1500,
        committedBlocks: blocks,
        committedText: words1500.map((w) => w.text).join(' '),
        partialText: 'active tail word',
        fullText: `${words1500.map((w) => w.text).join(' ')} active tail word`,
        activeLang: 'en-US',
      });
    });

    render(
      <LanguageProvider>
        <LiveTranscriptPanel title="Live transcript" store={store} speechLang="en-US" />
      </LanguageProvider>
    );

    const renderedBlocks = screen.getAllByTestId('committed-transcript-block');
    expect(renderedBlocks.length).toBe(blocks.length);
    // Earlier blocks use content-visibility: auto + contain-intrinsic-size
    expect(renderedBlocks[0].style.contentVisibility).toBe('auto');
    expect(renderedBlocks[0].style.containIntrinsicSize).toContain('auto');
    // Filler highlight inside block 0
    const marks = renderedBlocks[0].querySelectorAll('mark');
    expect(marks.length).toBe(1);
    expect(marks[0].textContent).toBe('basically');

    // Tail renders partial hypothesis
    const tail = screen.getByTestId('live-transcript-tail');
    expect(tail).toHaveTextContent('active tail word');

    // Update ONLY partial tail -> committed block DOM nodes remain identical
    const firstBlockEl = renderedBlocks[0];
    act(() => {
      store.patch({
        partialText: 'updated tail hypothesis',
        fullText: `${words1500.map((w) => w.text).join(' ')} updated tail hypothesis`,
      });
    });
    expect(screen.getByTestId('live-transcript-tail')).toHaveTextContent('updated tail hypothesis');
    expect(screen.getAllByTestId('committed-transcript-block')[0]).toBe(firstBlockEl);

    // Clear partial tail while committed blocks stay rendered -> LiveTranscriptTail returns null
    act(() => {
      store.patch({
        partialText: '',
        fullText: words1500.map((w) => w.text).join(' '),
      });
    });
    expect(screen.queryByTestId('live-transcript-tail')).toBeNull();
  });

  it('supports smart auto-scroll anchoring and pauses auto-scroll when user scrolls up', () => {
    const store = createSpeechStore();
    act(() => {
      store.patch({
        partialText: 'initial phrase',
        fullText: 'initial phrase',
      });
    });

    render(
      <LanguageProvider>
        <LiveTranscriptPanel title="Live transcript" store={store} />
      </LanguageProvider>
    );

    const scroller = screen.getByTestId('transcript-scroll-container');
    Object.defineProperty(scroller, 'scrollHeight', { value: 600, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(scroller, 'scrollTop', { value: 400, writable: true, configurable: true });

    // Simulate user scrolling up near top -> pauses auto-scroll and shows resume button
    scroller.scrollTop = 50;
    fireEvent.scroll(scroller);

    act(() => {
      store.patch({
        partialText: 'more words arriving',
        fullText: 'more words arriving',
      });
    });
    expect(scroller.scrollTop).toBe(50);

    const resumeBtn = screen.getByRole('button', { name: /Jump to latest|До кінця/i });
    fireEvent.click(resumeBtn);
    expect(scroller.scrollTop).toBe(600);
  });

  it('supports one-click Copy and Export (.txt) transcript actions', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const createObjectURL = vi.fn(() => 'blob:transcript-url');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(
      <LanguageProvider>
        <LiveTranscriptPanel
          title="Live transcript"
          transcript="Hello world like test"
          speechLang="en-US"
        />
      </LanguageProvider>
    );

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Copy/i }));
    });
    expect(writeText).toHaveBeenCalledWith('Hello world like test');
    expect(screen.getByRole('button', { name: /Copied/i })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1900);
    });
    expect(screen.getByRole('button', { name: /Copy/i })).toBeInTheDocument();
    vi.useRealTimers();

    fireEvent.click(screen.getByRole('button', { name: /Export \.txt/i }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:transcript-url');

    // Clipboard failure falls back cleanly without crashing
    writeText.mockRejectedValueOnce(new Error('Clipboard blocked'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Copy|Copied/i }));
    });
  });

  it('produces zero transcript highlights when !isPro or when userFillerWords is empty', () => {
    const store = createSpeechStore();
    const words = [
      { text: 'like', join: false },
      { text: 'ну', join: false },
      { text: 'basically', join: false },
    ];
    const blocks = buildCommittedBlocks(words, []);

    act(() => {
      store.patch({
        isPro: false,
        userFillerWords: ['like', 'ну'],
        committedWords: words,
        committedBlocks: blocks,
        committedText: 'like ну basically',
        fullText: 'like ну basically',
      });
    });

    render(
      <LanguageProvider>
        <LiveTranscriptPanel title="Live transcript" store={store} />
      </LanguageProvider>
    );

    expect(screen.getByTestId('committed-transcript-block').querySelectorAll('mark')).toHaveLength(0);

    // PRO with empty dictionary -> still zero highlights
    act(() => {
      store.patch({ isPro: true, userFillerWords: [] });
    });
    expect(screen.getByTestId('committed-transcript-block').querySelectorAll('mark')).toHaveLength(0);

    // PRO with custom dictionary -> highlights strictly custom words
    act(() => {
      store.patch({ isPro: true, userFillerWords: ['ну'] });
    });
    const marks = screen.getByTestId('committed-transcript-block').querySelectorAll('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('ну');
  });
});
