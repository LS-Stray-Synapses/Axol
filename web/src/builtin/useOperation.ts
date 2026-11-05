import { useCallback, useEffect, useState } from "react";
import { callOperation } from "../backend";
import { useStore } from "../store";

export type OpState<T> = { status: "loading" } | { status: "ok"; data: T } | { status: "error"; error: string };

/** Call a back-end operation when connected, with a refresh function. */
export function useOperation<T>(name: string, parse: (raw: unknown) => T): [OpState<T>, () => void] {
  const connected = useStore((s) => s.connection === "open");
  const [state, setState] = useState<OpState<T>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!connected) {
      setState({ status: "error", error: "not connected" });
      return;
    }
    let alive = true; // ignore answers that arrive after unmount / a newer refresh
    setState({ status: "loading" });
    callOperation(name).then(
      (raw) => alive && setState({ status: "ok", data: parse(raw) }),
      (err: unknown) => alive && setState({ status: "error", error: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      alive = false;
    };
    // `parse` is left out on purpose: callers pass a stable module-level function.
  }, [name, connected, nonce]);

  return [state, useCallback(() => setNonce((n) => n + 1), [])];
}
