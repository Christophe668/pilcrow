export type DataChangeEvent =
  | { kind: "articles" }
  | { kind: "article"; id: number }
  | { kind: "tags" }
  | { kind: "annotations"; articleId: number }
  | { kind: "sync-status" };

type Listener = (event: DataChangeEvent) => void;

class Bus {
  private listeners = new Set<Listener>();
  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }
  emit(e: DataChangeEvent): void {
    for (const l of this.listeners) l(e);
  }
}

export const dataEvents = new Bus();
