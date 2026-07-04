import { useState, useEffect, useRef, useCallback } from 'react';
import {
    isLinkedSaveActive,
    readLinkedFile,
} from '../core/linkedSave.js';

const POLL_INTERVAL_MS = 1500;
const DEBOUNCE_MS = 500;

export function useLinkedSaveWatch({ isLoaded, isDirtyFn, onReload }) {
    const [externalChangePending, setExternalChangePending] = useState(false);
    const lastMtimeRef = useRef(null);
    const debounceTimerRef = useRef(null);

    const handleReload = useCallback(async () => {
        if (!isLinkedSaveActive()) return;
        const file = await readLinkedFile();
        lastMtimeRef.current = file.lastModified;
        setExternalChangePending(false);
        await onReload(file);
    }, [onReload]);

    const handleDismiss = useCallback(() => {
        setExternalChangePending(false);
    }, []);

    useEffect(() => {
        if (!isLoaded || !isLinkedSaveActive()) return;

        let cancelled = false;

        async function seedMtime() {
            try {
                const file = await readLinkedFile();
                lastMtimeRef.current = file.lastModified;
            } catch {
                // handle not available yet
            }
        }
        seedMtime();

        const id = setInterval(async () => {
            if (cancelled || !isLinkedSaveActive()) return;
            try {
                const file = await readLinkedFile();
                const mtime = file.lastModified;
                if (lastMtimeRef.current !== null && mtime !== lastMtimeRef.current) {
                    lastMtimeRef.current = mtime;
                    clearTimeout(debounceTimerRef.current);
                    debounceTimerRef.current = setTimeout(() => {
                        if (cancelled) return;
                        if (isDirtyFn()) {
                            setExternalChangePending(true);
                        } else {
                            onReload(file);
                        }
                    }, DEBOUNCE_MS);
                }
            } catch {
                // file may be locked by emulator
            }
        }, POLL_INTERVAL_MS);

        return () => {
            cancelled = true;
            clearInterval(id);
            clearTimeout(debounceTimerRef.current);
        };
    }, [isLoaded, isDirtyFn, onReload]);

    return {
        externalChangePending,
        onReloadExternal: handleReload,
        onDismissExternal: handleDismiss,
    };
}
