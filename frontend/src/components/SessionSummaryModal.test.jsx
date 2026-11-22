import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SessionSummaryModal from './SessionSummaryModal.jsx';
import { LanguageProvider } from '../context/LanguageContext.jsx';

const mockOpenSlotModal = vi.fn();
const authState = {
  user: { id: 1, email: 'test@example.com', is_pro: false },
  openSlotModal: mockOpenSlotModal,
};

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => authState,
}));

const baseSummary = {
  targetDurationSec: 180,
  actualDurationSec: 170,
  wordCount: 380,
  wpm: 134,
  pauseCount: 2,
  totalPauseSec: 3.4,
  fillerCount: 3,
  fillerBreakdown: { like: 2, um: 1 },
  pacingTimeline: [
    { sec: 10, wpm: 0 },
    { sec: 20, wpm: 140 },
  ],
  transcript: 'Hello like everyone this is like a test.',
  score: 88,
  verdict: 'Strong pacing overall.',
  defaultTitle: 'Practice Presentation',
};

describe('SessionSummaryModal', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    authState.user.is_pro = false;
  });

  it('returns null when closed or summary is missing', () => {
    const { container } = render(
      <LanguageProvider>
        <SessionSummaryModal isOpen={false} onClose={() => {}} onSave={() => {}} summary={baseSummary} />
      </LanguageProvider>
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders PRO lock overlay when not PRO and opens slot modal on click, supports Escape close', () => {
    const onClose = vi.fn();
    render(
      <LanguageProvider>
        <SessionSummaryModal
          isOpen={true}
          onClose={onClose}
          onSave={vi.fn()}
          summary={baseSummary}
          saveError="Save failed"
        />
      </LanguageProvider>
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Save failed');
    fireEvent.click(screen.getByRole('button', { name: /Unlock PRO/i }));
    expect(mockOpenSlotModal).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders pacing curve, filler words, annotated transcript for PRO users and submits title/notes', () => {
    authState.user.is_pro = true;
    const onSave = vi.fn();
    const { rerender } = render(
      <LanguageProvider>
        <SessionSummaryModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={onSave}
          summary={baseSummary}
          isSaving={false}
        />
      </LanguageProvider>
    );

    expect(screen.getByText(/×2/)).toBeInTheDocument();
    const titleInput = screen.getByLabelText(/Presentation title/i);
    const notesInput = screen.getByLabelText(/Notes/i);

    fireEvent.change(titleInput, { target: { value: '  Board Pitch  ' } });
    fireEvent.change(notesInput, { target: { value: '  Strong finish  ' } });
    fireEvent.submit(titleInput.closest('form'));

    expect(onSave).toHaveBeenCalledWith({
      title: 'Board Pitch',
      notes: 'Strong finish',
    });

    // Empty title falls back to defaultTitle & empty notes to null; also test uk lang, undefined fillerBreakdown, & isSaving Escape
    localStorage.setItem('pt_lang', 'uk');
    rerender(
      <LanguageProvider>
        <SessionSummaryModal
          isOpen={true}
          onClose={vi.fn()}
          onSave={onSave}
          summary={{
            ...baseSummary,
            fillerCount: 0,
            fillerBreakdown: undefined,
            pacingTimeline: [],
            transcript: 'Ну це типу тест',
            score: undefined,
            defaultTitle: '',
          }}
          isSaving={true}
        />
      </LanguageProvider>
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'Enter' });
    const nextTitleInput = screen.getByLabelText(/Presentation title/i);
    const nextNotesInput = screen.getByLabelText(/Notes/i);
    fireEvent.change(nextTitleInput, { target: { value: '   ' } });
    fireEvent.change(nextNotesInput, { target: { value: '' } });
    fireEvent.submit(nextTitleInput.closest('form'));
    expect(onSave).toHaveBeenLastCalledWith({
      title: 'Practice Presentation',
      notes: null,
    });
  });
});
