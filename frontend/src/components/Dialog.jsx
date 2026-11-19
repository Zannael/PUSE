import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export default function Dialog({ title, onClose, closeDisabled = false, children }) {
    const dialog = useRef(null);
    useEffect(() => {
        const element = dialog.current;
        const previousFocus = document.activeElement;
        element.showModal();
        return () => {
            element.close();
            previousFocus?.focus();
        };
    }, []);
    return <dialog ref={dialog} aria-label={title}
        onCancel={event => { event.preventDefault(); if (!closeDisabled) onClose(); }}
        onClick={event => { if (event.target === event.currentTarget && !closeDisabled) onClose(); }}
        className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-slate-600 bg-slate-900 p-5 text-slate-100 shadow-2xl backdrop:bg-slate-950/80">
        <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold">{title}</h2>
            <button type="button" disabled={closeDisabled} onClick={onClose} aria-label={`Close ${title}`} className="rounded-lg p-2 hover:bg-slate-700 disabled:opacity-50"><X size={20} /></button>
        </div>
        {children}
    </dialog>;
}
