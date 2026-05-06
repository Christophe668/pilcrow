export type SnackbarAction = {
  label: string;
  onPress: () => void;
};

export type SnackbarItem = {
  id: number;
  message: string;
  action?: SnackbarAction;
  // Auto-dismiss after this many ms. Default 5000.
  durationMs?: number;
};

type Listener = (item: SnackbarItem | null) => void;

let nextId = 1;
let current: SnackbarItem | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();

function notify() {
  for (const l of listeners) l(current);
}

function clearTimer() {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

export function showSnackbar(args: {
  message: string;
  action?: SnackbarAction;
  durationMs?: number;
}): number {
  clearTimer();
  current = {
    id: nextId++,
    message: args.message,
    ...(args.action !== undefined ? { action: args.action } : {}),
    durationMs: args.durationMs ?? 5000,
  };
  notify();
  timer = setTimeout(() => {
    current = null;
    timer = null;
    notify();
  }, current.durationMs);
  return current.id;
}

export function dismissSnackbar(): void {
  clearTimer();
  current = null;
  notify();
}

export function subscribeSnackbar(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}

export function _testReset(): void {
  clearTimer();
  current = null;
  listeners.clear();
}
