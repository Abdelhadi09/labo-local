// Minimal HeroUI-shaped toast queue. No @heroui/react dependency — this
// project hand-rolls HeroUI's visual language in plain CSS elsewhere (see
// /styles/heroModal.css), so the toast system follows the same pattern:
// match HeroUI's anatomy (indicator/title/description/action/close) and
// its `toast()` call signature, without pulling in the package.
//
// State lives outside React (a plain array + subscriber list) so `toast()`
// can be called from anywhere — event handlers, catch blocks, anywhere —
// exactly like HeroUI's ToastQueue is designed to work.

let toasts = [];
const listeners = new Set();

const notify = () => listeners.forEach(fn => fn(toasts));

let counter = 0;
const nextId = () => `toast-${Date.now()}-${counter++}`;

const DEFAULT_TIMEOUT = 4000;

function add(content, options = {}) {
  const id = nextId();
  const {
    description,
    variant = 'default',
    indicator,
    actionProps,
    isLoading = false,
    timeout = DEFAULT_TIMEOUT,
    onClose,
  } = options;

  const entry = {
    id,
    title: content,
    description,
    variant,
    indicator,
    actionProps,
    isLoading,
    onClose,
    createdAt: Date.now(),
  };

  toasts = [entry, ...toasts];
  notify();

  if (timeout > 0) {
    setTimeout(() => close(id), timeout);
  }

  return id;
}

function close(id) {
  const entry = toasts.find(t => t.id === id);
  if (!entry) return;
  toasts = toasts.filter(t => t.id !== id);
  notify();
  entry.onClose?.();
}

function clear() {
  const closing = toasts;
  toasts = [];
  notify();
  closing.forEach(t => t.onClose?.());
}

// Swap a toast in place (used by promise() to turn a loading toast into
// its resolved success/error state without a flicker of add-then-remove).
function update(id, content, options = {}) {
  const idx = toasts.findIndex(t => t.id === id);
  if (idx === -1) return;
  const { description, variant, indicator, actionProps, isLoading = false, timeout = DEFAULT_TIMEOUT, onClose } = options;
  toasts = toasts.map((t, i) => i === idx
    ? { ...t, title: content, description, variant, indicator, actionProps, isLoading, onClose }
    : t);
  notify();
  if (timeout > 0) {
    setTimeout(() => close(id), timeout);
  }
}

function subscribe(fn) {
  listeners.add(fn);
  fn(toasts);
  return () => listeners.delete(fn);
}

function base(content, options) {
  return add(content, options);
}

base.success = (content, options = {}) => add(content, { ...options, variant: 'success' });
base.info = (content, options = {}) => add(content, { ...options, variant: 'accent' });
base.warning = (content, options = {}) => add(content, { ...options, variant: 'warning' });
base.danger = (content, options = {}) => add(content, { ...options, variant: 'danger' });

base.close = close;
base.clear = clear;

// toast.promise(promise, { loading, success, error }) — shows a loading
// toast immediately, then swaps it to success/danger once the promise
// settles. success/error may be a string or a function of the resolved
// value / thrown error, matching HeroUI's API.
base.promise = (promise, { loading, success, error }) => {
  const id = add(loading, { isLoading: true, timeout: 0 });
  return promise.then(
    (data) => {
      const msg = typeof success === 'function' ? success(data) : success;
      update(id, msg, { variant: 'success' });
      return data;
    },
    (err) => {
      const msg = typeof error === 'function' ? error(err) : error;
      update(id, msg, { variant: 'danger' });
      throw err;
    }
  );
};

export const toast = base;
export const toastStore = { subscribe, close, clear };
export default toast;