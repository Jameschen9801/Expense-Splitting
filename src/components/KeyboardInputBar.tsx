import { forwardRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export type KeyboardField = {
  id: string;
  label: string;
  value: string;
  type?: 'text' | 'number';
  inputMode?: 'text' | 'decimal';
  placeholder?: string;
  maxLength?: number;
  onChange: (value: string) => void;
};

export const KeyboardInputBar = forwardRef<HTMLInputElement, {
  field: KeyboardField; index: number; total: number; error?: string;
  onMove: (direction: -1 | 1) => void; onDone: () => void;
}>(function KeyboardInputBar({ field, index, total, error, onMove, onDone }, ref) {
  return <div className="keyboard-input-bar" aria-label="鍵盤上方輸入列">
    <div className="keyboard-input-heading">
      <label id="keyboard-field-label" className="keyboard-field-label" htmlFor="keyboard-field">{field.label}</label>
      <span id="keyboard-field-step" className="sr-only">第 {index + 1} 欄，共 {total} 欄</span>
      <div className="keyboard-field-actions" role="group" aria-label="欄位切換">
        <button type="button" className="icon-btn" aria-label="上一欄" disabled={index === 0}
          onPointerDown={event => event.preventDefault()} onClick={() => onMove(-1)}>
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <button type="button" className="icon-btn" aria-label="下一欄" disabled={index === total - 1}
          onPointerDown={event => event.preventDefault()} onClick={() => onMove(1)}>
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </div>
      <button type="button" className="btn btn-primary btn-sm keyboard-done" onPointerDown={event => event.preventDefault()} onClick={onDone}>完成</button>
    </div>
    <div className="keyboard-input-control">
      <input
        key={field.id}
        ref={ref}
        id="keyboard-field"
        aria-label={`鍵盤上方：${field.label}`}
        aria-describedby={`keyboard-field-step${error ? ' keyboard-input-error' : ''}`}
        className={`keyboard-accessory-input ${field.type === 'number' ? 'keyboard-number-input' : ''}`}
        type={field.type || 'text'}
        inputMode={field.inputMode || 'text'}
        step={field.type === 'number' ? '0.01' : undefined}
        min={field.type === 'number' ? '0' : undefined}
        value={field.value}
        placeholder={field.placeholder}
        maxLength={field.maxLength}
        autoComplete="off"
        enterKeyHint={index < total - 1 ? 'next' : 'done'}
        onChange={event => field.onChange(event.target.value)}
        onKeyDown={event => {
          // Enter used to confirm Chinese composition must not move to another field.
          if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
            event.preventDefault();
            index < total - 1 ? onMove(1) : onDone();
          }
        }}
      />
    </div>
    {error && <p id="keyboard-input-error" className="form-error mt-3" role="alert">{error}</p>}
  </div>;
});
