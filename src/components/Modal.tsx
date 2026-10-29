import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { KeyboardInputBar, type KeyboardField } from './KeyboardInputBar';
import { inputScrollTop, isInputEnter, modalViewport } from '../lib/keyboard';

export function Modal({ title, children, onClose, footer, keyboardFields = [], keyboardError, layout = 'sheet' }: {
  title: string; children: ReactNode; onClose: () => void; footer?: ReactNode; keyboardFields?: KeyboardField[]; keyboardError?: string; layout?: 'sheet' | 'editor';
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = `dialog-${title.replace(/\s/g, '-')}`;
  const movingFocus = useRef(false);
  const backdropPointerDown = useRef(false);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 639px)').matches);
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const activeIndex = keyboardFields.findIndex(field => field.id === activeFieldId);
  const activeField = mobile && layout === 'editor' && activeFieldId ? keyboardFields[activeIndex] || { id: activeFieldId, label: '輸入' } : null;
  const nextField = activeIndex >= 0 ? keyboardFields[activeIndex + 1] : undefined;

  useEffect(() => {
    if (layout !== 'editor' || !mobile) return;
    const body = document.body;
    const alreadyMasked = body.classList.contains('warikan-record-editor');
    body.classList.add('warikan-record-editor');
    return () => { if (!alreadyMasked) body.classList.remove('warikan-record-editor'); };
  }, [layout, mobile]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 639px)');
    const change = () => {
      setMobile(media.matches);
      const focused = document.activeElement;
      if (!media.matches) setActiveFieldId(null);
      else if (layout === 'editor' && focused instanceof HTMLInputElement && contentRef.current?.contains(focused)) setActiveFieldId(focused.id || null);
    };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);

  useEffect(() => {
    if (activeFieldId && !dialogRef.current?.contains(document.getElementById(activeFieldId))) setActiveFieldId(null);
  }, [activeFieldId, activeIndex]);

  const revealField = (field: HTMLElement) => {
    const content = contentRef.current;
    if (!content?.contains(field)) return;
    const area = content.getBoundingClientRect(), bounds = field.getBoundingClientRect();
    const next = inputScrollTop(content.scrollTop, bounds.top, bounds.bottom, area.top, area.bottom);
    // Reassigning even an unchanged scroll offset can interrupt iOS momentum scrolling.
    if (Math.abs(next - content.scrollTop) > 1) content.scrollTop = next;
  };

  useEffect(() => {
    if (!keyboardError) return;
    const frame = requestAnimationFrame(() => {
      if (document.activeElement instanceof HTMLElement) revealField(document.activeElement);
    });
    return () => cancelAnimationFrame(frame);
  }, [keyboardError]);

  const activateField = (id: string) => {
    const input = document.getElementById(id);
    if (!(input instanceof HTMLInputElement) || !contentRef.current?.contains(input)) return;
    // Focus the real field directly inside the user's tap, without replacing it.
    movingFocus.current = true;
    input.focus({ preventScroll: true });
    setActiveFieldId(id);
    revealField(input);
    movingFocus.current = false;
  };

  const finishInput = () => {
    movingFocus.current = true;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && contentRef.current?.contains(focused)) focused.blur();
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
    let revealTimer = 0;
    let revealAfterResize = false;
    const resize = (event?: Event) => {
      if (event?.type === 'resize') {
        revealAfterResize = true;
        window.clearTimeout(revealTimer);
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (viewportRef.current) {
          const layoutHeight = viewportRef.current.parentElement?.clientHeight || window.innerHeight;
          const area = modalViewport(layoutHeight, viewport);
          if (viewportRef.current.style.height !== `${area.height}px`) viewportRef.current.style.height = `${area.height}px`;
          if (viewportRef.current.style.top !== `${area.top}px`) viewportRef.current.style.top = `${area.top}px`;
          viewportRef.current.dataset.keyboardOpen = String(area.keyboardOpen);
        }
        if (revealAfterResize) {
          revealAfterResize = false;
          // Follow the keyboard's size while it animates, then reveal the field once.
          // Repeated scroll corrections during that animation make the form jump.
          revealTimer = window.setTimeout(() => {
            const focused = document.activeElement;
            if (focused instanceof HTMLElement && contentRef.current?.contains(focused)) revealField(focused);
          }, 120);
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
      const focusable = (Array.from(dialog.querySelectorAll(focusableSelector)) as HTMLElement[])
        .filter(element => !element.closest('[hidden], [inert]') && element.getClientRects().length > 0);
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
      window.clearTimeout(revealTimer);
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
      className="modal-backdrop fixed inset-0"
      data-layout={layout}
      data-input-active={!!activeField}
      onPointerDown={event => { backdropPointerDown.current = !dialogRef.current?.contains(event.target as Node); }}
      onClick={event => {
        // A selection or scroll gesture that started inside must not close us.
        if (backdropPointerDown.current && !dialogRef.current?.contains(event.target as Node)) onClose();
        backdropPointerDown.current = false;
      }}
    >
      <div ref={viewportRef} className="modal-viewport">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-layout={layout}
        data-input-active={!!activeField}
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
          onFocusCapture={event => {
            if (!mobile || layout !== 'editor') return;
            const input = event.target;
            const editable = input instanceof HTMLInputElement && !input.readOnly && input.id && (input.type === 'text' || input.type === 'number');
            setActiveFieldId(editable ? input.id : null);
            if (editable) requestAnimationFrame(() => { if (document.activeElement === input) revealField(input); });
          }}
          onKeyDownCapture={event => {
            if (!mobile || layout !== 'editor' || !(event.target instanceof HTMLInputElement) || !isInputEnter(event.nativeEvent)) return;
            const index = keyboardFields.findIndex(field => field.id === (event.target as HTMLInputElement).id);
            if (index < 0) return;
            event.preventDefault();
            const next = keyboardFields[index + 1];
            if (next) activateField(next.id); else finishInput();
          }}>
          {children}
        </div>
        {(activeField || footer) && <div className="modal-footer shrink-0 border-t border-line px-5 pt-3">
          {activeField ? <KeyboardInputBar nextLabel={nextField?.label} error={keyboardError}
            onNext={() => { if (nextField) activateField(nextField.id); }} onDone={finishInput} /> : footer}
        </div>}
      </div>
      </div>
    </div>
  );
}
