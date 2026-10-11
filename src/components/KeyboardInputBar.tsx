import { forwardRef } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

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
  field: KeyboardField; index: number; total: number;
  onMove: (direction: -1 | 1) => void; onDone: () => void;
}>(function KeyboardInputBar({ field, index, total, onMove, onDone }, ref) {
  return <div className="keyboard-input-bar" aria-label="鍵盤上方輸入列">
    <div className="flex items-center justify-between gap-2 mb-1.5 text-xs text-ink-2">
      <label htmlFor="keyboard-field">{field.label}</label>
      <span>{index + 1}／{total}</span>
    </div>
    <div className="flex items-center gap-1.5">
      <button type="button" className="icon-btn shrink-0" aria-label="上一欄" disabled={index === 0}
        onPointerDown={event => event.preventDefault()} onClick={() => onMove(-1)}>
        <ChevronUp size={20} aria-hidden="true" />
      </button>
      <input
        key={field.id}
        ref={ref}
        id="keyboard-field"
        aria-label={`鍵盤上方：${field.label}`}
        className="keyboard-accessory-input min-w-0 flex-1"
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
      <button type="button" className="icon-btn shrink-0" aria-label="下一欄" disabled={index === total - 1}
        onPointerDown={event => event.preventDefault()} onClick={() => onMove(1)}>
        <ChevronDown size={20} aria-hidden="true" />
      </button>
      <button type="button" className="btn btn-primary btn-sm shrink-0" onPointerDown={event => event.preventDefault()} onClick={onDone}>完成</button>
    </div>
  </div>;
});
