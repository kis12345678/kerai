import { useEffect, useReducer } from 'react';
import { api } from './api';
import { mapEventToActivity, type ActivityEntry } from './activity';
import type { Approval, Mission } from './types';

/**
 * Single shared WebSocket connection to the KERAI event stream. Every subscriber
 * (page) observes the same live state; the connection reconnects with backoff.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let missions: Mission[] | null = null;
let approvals: Approval[] = [];
let activity: ActivityEntry[] = [];
let ws: WebSocket | null = null;
let connecting = false;
let reconnectDelayMs = 1000;

function notify() {
  listeners.forEach(listener => listener());
}

function upsertMission(mission: Mission) {
  const list = missions ?? [];
  const index = list.findIndex(m => m.id === mission.id);
  if (index >= 0) list[index] = mission;
  else list.push(mission);
  missions = [...list].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function upsertApproval(approval: Approval) {
  const index = approvals.findIndex(a => a.id === approval.id);
  if (index >= 0) approvals[index] = approval;
  else approvals = [...approvals, approval];
}

async function refreshInitial() {
  const [missionsResult, approvalsResult, activityResult] = await Promise.allSettled([
    api.missions(),
    api.approvals(),
    api.activity(),
  ]);
  if (missionsResult.status === 'fulfilled') missions = missionsResult.value;
  if (approvalsResult.status === 'fulfilled') approvals = approvalsResult.value;
  if (activityResult.status === 'fulfilled') activity = activityResult.value.map(mapEventToActivity);
  notify();
}

function connect() {
  if (connecting || (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING))) return;
  connecting = true;
  try {
    ws = new WebSocket(api.wsUrl());
  } catch {
    connecting = false;
    window.setTimeout(connect, reconnectDelayMs);
    return;
  }
  ws.onopen = () => {
    connecting = false;
    reconnectDelayMs = 1000;
    void refreshInitial();
  };
  ws.onmessage = (event) => {
    let message: { type?: string } & Record<string, unknown>;
    try {
      message = JSON.parse(event.data as string);
    } catch {
      return;
    }
    if (message.type === 'mission' && message.mission) {
      upsertMission(message.mission as Mission);
      notify();
    } else if (message.type === 'activity' && message.entry) {
      activity = [mapEventToActivity(message.entry as never), ...activity].slice(0, 300);
      notify();
    } else if (message.type === 'approval' && message.approval) {
      upsertApproval(message.approval as Approval);
      notify();
    }
  };
  ws.onclose = () => {
    ws = null;
    connecting = false;
    window.setTimeout(connect, reconnectDelayMs);
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, 15000);
  };
  ws.onerror = () => ws?.close();
}

export interface LiveStore {
  missions: Mission[] | null;
  approvals: Approval[];
  activity: ActivityEntry[];
  refresh: () => void;
}

export function useLive(): LiveStore {
  const [, force] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    connect();
    listeners.add(force);
    return () => {
      listeners.delete(force);
    };
  }, []);

  return {
    missions,
    approvals,
    activity,
    refresh: () => void refreshInitial(),
  };
}
