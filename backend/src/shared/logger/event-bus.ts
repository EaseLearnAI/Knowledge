import { EventEmitter } from "node:events";

export type TerminalEvent = {
  id: number;
  timestamp: string;
  level: "info" | "warn" | "error";
  event: string;
  message: string;
  requestId?: string;
  taskId?: string;
  data?: Record<string, unknown>;
};

class TerminalEventBus extends EventEmitter {
  private sequence = 0;
  private readonly history: TerminalEvent[] = [];

  publish(event: Omit<TerminalEvent, "id" | "timestamp">): TerminalEvent {
    const item: TerminalEvent = {
      id: ++this.sequence,
      timestamp: new Date().toISOString(),
      ...event,
    };
    this.history.push(item);
    if (this.history.length > 500) this.history.shift();
    this.emit("terminal-event", item);
    return item;
  }

  recent(limit = 100): TerminalEvent[] {
    return this.history.slice(-limit);
  }
}

export const terminalEventBus = new TerminalEventBus();
