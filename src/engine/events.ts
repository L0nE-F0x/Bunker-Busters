type Handler<T> = (payload: T) => void;

/** Tiny typed event bus so UI, audio and game systems stay decoupled. */
export class EventBus<Events extends Record<string, unknown>> {
  private handlers: { [K in keyof Events]?: Handler<Events[K]>[] } = {};

  on<K extends keyof Events>(type: K, fn: Handler<Events[K]>) {
    (this.handlers[type] ??= []).push(fn);
    return () => this.off(type, fn);
  }
  off<K extends keyof Events>(type: K, fn: Handler<Events[K]>) {
    const list = this.handlers[type];
    if (list) this.handlers[type] = list.filter((h) => h !== fn);
  }
  emit<K extends keyof Events>(type: K, payload: Events[K]) {
    this.handlers[type]?.forEach((h) => h(payload));
  }
}
