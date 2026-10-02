import {
  useCallback,
  useContext,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { WorkspaceContext } from "./workspace-preferences-context";

export function useWorkspacePreference<T>(
  name: string,
  createDefault: () => T,
  decode: (value: unknown) => T,
): readonly [T, Dispatch<SetStateAction<T>>] {
  const store = useContext(WorkspaceContext);
  if (!store) throw new Error("Workspace preferences require an authenticated workspace.");
  const [value, setValue] = useState(() => store.read(name, createDefault, decode));
  const current = useRef(value);
  const update = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      const resolved =
        typeof next === "function" ? (next as (previous: T) => T)(current.current) : next;
      current.current = resolved;
      // Persist before sending writes or yielding control to a page reload.
      store.write(name, resolved);
      setValue(resolved);
    },
    [name, store],
  );
  return [value, update];
}
