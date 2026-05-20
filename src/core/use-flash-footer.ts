import { useCallback, useEffect, useRef, useState } from "react";

const FOOTER_STATUS_DISMISS_MS = 2000;

export function useFlashFooter(): {
  status: string | null;
  flash: (message: string) => void;
} {
  const [status, setStatus] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((message: string) => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    setStatus(message);
    timerRef.current = setTimeout(() => {
      setStatus(null);
      timerRef.current = null;
    }, FOOTER_STATUS_DISMISS_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return { status, flash };
}
