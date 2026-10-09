export const REQUEST_TIMEOUT_MS = 30_000;

export class RequestTimeoutError extends Error {
  constructor() {
    super("Request deadline exceeded");
    this.name = "RequestTimeoutError";
  }
}

/** One deadline covers headers and body, and cancels the underlying network request. */
export async function withRequestDeadline<T>(
  task: (signal: AbortSignal) => Promise<T>,
  callerSignal?: AbortSignal | null,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  callerSignal?.throwIfAborted();
  const controller = new AbortController();
  let interrupt: ((reason: unknown) => void) | undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    interrupt = (reason) => {
      controller.abort(reason);
      // AbortSignal allows arbitrary caller reasons; preserve them unchanged.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      reject(reason);
    };
  });
  const cancel = () => {
    interrupt?.(callerSignal?.reason);
  };
  callerSignal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => {
    interrupt?.(new RequestTimeoutError());
  }, timeoutMs);
  try {
    // Racing also bounds transports or test streams that fail to honor abort signals.
    return await Promise.race([
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return task(controller.signal);
      }),
      interrupted,
    ]);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", cancel);
  }
}
