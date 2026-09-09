import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';

export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose(): void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  // 用 ref 保存 onClose，避免内联箭头函数引用变化导致 effect 每次渲染都重跑（进而抢焦点）。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const node = dialog.current;
    if (!open || !node) return;
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const nativeDialog = typeof node.showModal === 'function';
    if (nativeDialog) node.showModal();
    else node.setAttribute('open', '');
    // 输入框优先；确认弹窗没有输入框时，DOM 顺序保证取消按钮先获得焦点。
    queueMicrotask(() => node.querySelector<HTMLElement>('[autofocus], input, textarea, select, .confirm-dialog button:not([disabled])')?.focus());
    const cancel = (event: Event) => { event.preventDefault(); onCloseRef.current(); };
    const fallbackKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCloseRef.current(); };
    node.addEventListener('cancel', cancel);
    if (!nativeDialog) document.addEventListener('keydown', fallbackKey);
    return () => {
      node.removeEventListener('cancel', cancel);
      if (!nativeDialog) document.removeEventListener('keydown', fallbackKey);
      if (node.open) {
        if (typeof node.close === 'function') node.close();
        else node.removeAttribute('open');
      }
      const previous = restoreFocus.current;
      restoreFocus.current = null;
      queueMicrotask(() => previous?.focus());
    };
  }, [open]);

  if (!open) return null;
  return (
    <dialog className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialog} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal__header">
          <h2 id={titleId}>{title}</h2>
          <button aria-label="关闭" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
