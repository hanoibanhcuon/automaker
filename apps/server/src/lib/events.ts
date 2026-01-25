/**
 * Event emitter for streaming events to WebSocket clients
 */

import type { EventType, EventCallback } from '@automaker/types';
import { createLogger } from '@automaker/utils';

const logger = createLogger('Events');

// Re-export event types from shared package
export type { EventType, EventCallback };

export interface EventEmitter {
  emit: (type: EventType, payload: unknown) => void;
  subscribe: (callback: EventCallback) => () => void;
}

export function createEventEmitter(): EventEmitter {
  const subscribers = new Set<EventCallback>();
  const batchMs = Number.parseInt(process.env.EVENT_EMIT_BATCH_MS || '0', 10);
  const maxQueueSize = Number.parseInt(process.env.EVENT_EMIT_QUEUE_MAX || '1000', 10);
  const queue: Array<{ type: EventType; payload: unknown }> = [];
  let flushTimer: NodeJS.Timeout | null = null;

  const flushQueue = () => {
    flushTimer = null;
    if (queue.length === 0) {
      return;
    }
    const pending = queue.splice(0, queue.length);
    for (const { type, payload } of pending) {
      for (const callback of subscribers) {
        try {
          callback(type, payload);
        } catch (error) {
          logger.error('Error in event subscriber:', error);
        }
      }
    }
  };

  const scheduleFlush = () => {
    if (flushTimer) {
      return;
    }
    flushTimer = setTimeout(flushQueue, batchMs);
  };

  return {
    emit(type: EventType, payload: unknown) {
      if (!batchMs) {
        for (const callback of subscribers) {
          try {
            callback(type, payload);
          } catch (error) {
            logger.error('Error in event subscriber:', error);
          }
        }
        return;
      }

      if (queue.length >= maxQueueSize) {
        queue.shift();
      }
      queue.push({ type, payload });
      scheduleFlush();
    },

    subscribe(callback: EventCallback) {
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    },
  };
}
