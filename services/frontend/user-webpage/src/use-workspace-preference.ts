import {
  useCallback,
  useContext,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { WorkspaceContext } from "./workspace-preferences-context";

/**
 * A workspace preference with two setters: the first records a user's change (a new history entry
 * when the URL changes); the second corrects the value to the loaded data, such as a stale linked
 * selection, and replaces the current history entry so Back does not return to the stale value.
 */
export function useWorkspacePreference<T>(
  name: string,
  createDefault: () => T,
  decode: (value: unknown) => T,
): readonly [T, Dispatch<SetStateAction<T>>, Dispatch<SetStateAction<T>>] {
  const store = useContext(WorkspaceContext);
  if (!store) throw new Error("Workspace preferences require an authenticated workspace.");
  const [value, setValue] = useState(() => store.read(name, createDefault, decode));
  const current = useRef(value);
  const write = useCallback(
    (next: SetStateAction<T>, replace: boolean) => {
      const resolved =
        typeof next === "function" ? (next as (previous: T) => T)(current.current) : next;
      current.current = resolved;
      // Schedule rendering before the navigation store's URL microtask so a newly
      // opened tab can restore its saved scope before that scope is serialized.
      setValue(resolved);
      // Persist before sending writes or yielding control to a page reload.
      store.write(name, resolved, { replace });
    },
    [name, store],
  );
  const update = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      write(next, false);
    },
    [write],
  );
  const correct = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      write(next, true);
    },
    [write],
  );
  return [value, update, correct];
}
