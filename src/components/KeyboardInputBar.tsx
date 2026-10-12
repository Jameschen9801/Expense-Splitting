import { ChevronRight } from 'lucide-react';

export type KeyboardField = { id: string; label: string };

// Keep focus on the original input. The toolbar never creates another input.
export function KeyboardInputBar({ nextLabel, error, onNext, onDone }: {
  nextLabel?: string; error?: string; onNext: () => void; onDone: () => void;
}) {
  return <div className="keyboard-input-bar" role="toolbar" aria-label="記帳輸入工具">
    <div className="keyboard-input-actions">
      {nextLabel && <button type="button" className="btn btn-ghost btn-sm" aria-label={`下一欄：${nextLabel}`}
        onPointerDown={event => event.preventDefault()} onClick={onNext}>下一欄<ChevronRight size={18} aria-hidden="true" /></button>}
      <button type="button" className="btn btn-primary btn-sm keyboard-done" aria-label="完成輸入"
        onPointerDown={event => event.preventDefault()} onClick={onDone}>完成輸入</button>
    </div>
    {error && <p className="form-error mt-3" role="alert">{error}</p>}
  </div>;
}
