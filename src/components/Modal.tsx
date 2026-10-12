import { useEffect, useRef, useState, useLayoutEffect, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { X } from 'lucide-react';
import { KeyboardInputBar, type KeyboardField } from './KeyboardInputBar';

export function Modal({ title, children, onClose, footer, keyboardFields = [] }: {
  title: string; children: ReactNode; onClose: () => void; footer?: ReactNode; keyboardFields?: KeyboardField[];
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = `dialog-${title.replace(/\s/g, '-')}`;
  const keyboardRef = useRef<HTMLInputElement>(null);
  const movingFocus = useRef(false);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 639px)').matches);
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const activeIndex = keyboardFields.findIndex(field => field.id === activeFieldId);
  const activeField = mobile && activeIndex >= 0 ? keyboardFields[activeIndex] : null;

  useEffect(() => {
    const media = window.matchMedia('(max-width: 639px)');
    const change = () => {
      setMobile(media.matches);
      if (!media.matches) setActiveFieldId(null);
    };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);

  useEffect(() => {
    if (activeFieldId && activeIndex < 0) setActiveFieldId(null);
  }, [activeFieldId, activeIndex]);

  useLayoutEffect(() => {
    if (activeField) keyboardRef.current?.focus({ preventScroll: true });
  }, [activeFieldId, mobile]);

  const activateField = (id: string) => {
    // Keep focus inside the user's tap, which iOS needs to open/switch keyboards.
    movingFocus.current = true;
    flushSync(() => setActiveFieldId(id));
    keyboardRef.current?.focus({ preventScroll: true });
    movingFocus.current = false;
  };

  const finishInput = () => {
    movingFocus.current = true;
    keyboardRef.current?.blur();
    setActiveFieldId(null);
    dialogRef.current?.focus({ preventScroll: true });
    movingFocus.current = false;
  };

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const scrollY = window.scrollY;
    const body = document.body;
    const root = document.documentElement;
    const previousBodyStyles = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    const previousRootOverflow = root.style.overflow;

    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    root.style.overflow = 'hidden';

    const viewport = window.visualViewport;
    let frame = 0;
    const resize = (event?: Event) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (backdropRef.current) {
          backdropRef.current.style.height = `${viewport?.height || window.innerHeight}px`;
          backdropRef.current.style.top = `${viewport?.offsetTop || 0}px`;
        }
        const focused = document.activeElement;
        if (event?.type !== 'scroll' && focused instanceof HTMLElement && contentRef.current?.contains(focused)) {
          const field = focused.getBoundingClientRect();
          const area = contentRef.current.getBoundingClientRect();
          if (field.top < area.top || field.bottom > area.bottom) focused.scrollIntoView({ block: 'nearest' });
        }
      });
    };
    resize();
    viewport?.addEventListener('resize', resize);
    viewport?.addEventListener('scroll', resize);
    window.addEventListener('resize', resize);

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const firstFocusable = dialog?.querySelector<HTMLElement>('[data-autofocus]')
      || dialog?.querySelector<HTMLElement>(focusableSelector);
    // Show the full form first on phones; a tap opens the compact input and keyboard together.
    // Programmatic autofocus after mounting cannot reliably open iOS's software keyboard.
    const initialFocus = mobile && keyboardFields.length > 0 ? dialog : firstFocusable || dialog;
    initialFocus?.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll(focusableSelector)) as HTMLElement[];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      viewport?.removeEventListener('resize', resize);
      viewport?.removeEventListener('scroll', resize);
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(frame);
      body.style.position = previousBodyStyles.position;
      body.style.top = previousBodyStyles.top;
      body.style.left = previousBodyStyles.left;
      body.style.right = previousBodyStyles.right;
      body.style.width = previousBodyStyles.width;
      body.style.overflow = previousBodyStyles.overflow;
      root.style.overflow = previousRootOverflow;
      window.scrollTo(0, scrollY);
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div
      ref={backdropRef}
      className="modal-backdrop fixed left-0 right-0 top-0 h-[100dvh] bg-ink/40 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-5"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="modal-panel flex flex-col bg-paper border border-line rounded-t-3xl sm:rounded-2xl w-full max-w-[440px] max-h-[92%] sm:max-h-[90%] overflow-hidden shadow-lg"
        onClick={e => e.stopPropagation()}
        onBlurCapture={event => {
          if (!movingFocus.current && (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget as Node))) {
            setActiveFieldId(null);
          }
        }}
      >
        <div className="modal-heading border-b border-line flex shrink-0 items-center justify-between gap-3">
          <span id={titleId} className="modal-title">{title}</span>
          <button className="icon-btn" onClick={onClose} aria-label={`關閉${title}`}><X size={18} /></button>
        </div>
        <div ref={contentRef} className="modal-content min-h-0 overflow-y-auto p-5"
          onPointerDownCapture={event => {
            if (!mobile || event.button !== 0 || !(event.target instanceof HTMLInputElement)) return;
            const field = keyboardFields.find(field => field.id === (event.target as HTMLInputElement).id);
            if (!field) return;
            event.preventDefault();
            activateField(field.id);
          }}
          onFocusCapture={event => {
            if (!mobile) return;
            const field = event.target instanceof HTMLInputElement && keyboardFields.find(field => field.id === event.target.id);
            setActiveFieldId(field ? field.id : null);
          }}>
          {children}
        </div>
        {activeField ? <div className="shrink-0 border-t border-line">
          <KeyboardInputBar ref={keyboardRef} field={activeField} index={activeIndex} total={keyboardFields.length}
            onMove={direction => {
              const next = keyboardFields[activeIndex + direction];
              if (next) activateField(next.id);
            }} onDone={finishInput} />
        </div> : footer && <div className="modal-footer shrink-0 border-t border-line px-5 pt-3">{footer}</div>}
      </div>
    </div>
  );
}
