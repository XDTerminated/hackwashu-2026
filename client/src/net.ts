// WebSocket link to the agent server. The game still runs (walk, decorate)
// when the server is down; villagers just can't take tasks.

import type { ClientMessage, SeqEvent, ServerMessage } from "../../shared/game";

export type PhoneLinkMsg = Extract<ServerMessage, { type: "phone_link" }>;
import { applyEvent, applySnapshot, setConnected } from "./store";

const URL = `ws://${location.hostname || "localhost"}:8787`;
const eventListeners = new Set<(e: SeqEvent) => void>();
const noticeListeners = new Set<(text: string) => void>();
const snapshotListeners = new Set<() => void>();
const phoneLinkListeners = new Set<(msg: PhoneLinkMsg) => void>();
let ws: WebSocket | null = null;

export function connect() {
  try {
    ws = new WebSocket(URL);
  } catch {
    setTimeout(connect, 3000);
    return;
  }
  ws.onopen = () => {
    setConnected(true);
    send({ type: "hello" });
  };
  ws.onmessage = (ev) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (msg.type === "snapshot") {
      applySnapshot(msg.snapshot);
      snapshotListeners.forEach((fn) => fn());
    } else if (msg.type === "event") {
      applyEvent(msg.event);
      eventListeners.forEach((fn) => fn(msg.event));
    } else if (msg.type === "notice") {
      noticeListeners.forEach((fn) => fn(msg.text));
    } else if (msg.type === "phone_link") {
      phoneLinkListeners.forEach((fn) => fn(msg));
    }
  };
  ws.onclose = () => {
    setConnected(false);
    setTimeout(connect, 3000);
  };
  ws.onerror = () => ws?.close();
}

export function isConnected() {
  return ws?.readyState === WebSocket.OPEN;
}

export function send(msg: ClientMessage): boolean {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
    return true;
  }
  return false;
}

export function onEvent(fn: (e: SeqEvent) => void) {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
}

export function onNotice(fn: (text: string) => void) {
  noticeListeners.add(fn);
  return () => noticeListeners.delete(fn);
}

export function onSnapshot(fn: () => void) {
  snapshotListeners.add(fn);
  return () => snapshotListeners.delete(fn);
}

export function onPhoneLink(fn: (msg: PhoneLinkMsg) => void) {
  phoneLinkListeners.add(fn);
  return () => phoneLinkListeners.delete(fn);
}
