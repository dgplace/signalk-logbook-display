/**
 * Function: createEventBus
 * Description: Instantiate a lightweight publish/subscribe helper that exposes `on`, `off`, and `emit` methods.
 * Parameters: None.
 * Returns: object - Event bus API providing subscription and emission helpers.
 */
export function createEventBus() {
  const listeners = new Map();

  const addListener = (eventName, handler) => {
    if (!listeners.has(eventName)) {
      listeners.set(eventName, new Set());
    }
    listeners.get(eventName).add(handler);
  };

  const removeListener = (eventName, handler) => {
    if (!listeners.has(eventName)) return;
    const handlers = listeners.get(eventName);
    handlers.delete(handler);
    if (handlers.size === 0) {
      listeners.delete(eventName);
    }
  };

  const emitEvent = (eventName, payload) => {
    if (!listeners.has(eventName)) return;
    const handlers = Array.from(listeners.get(eventName));
    handlers.forEach((handler) => {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[events] handler for "${eventName}" failed`, err);
      }
    });
  };

  return {
    /**
     * Function: on
     * Description: Subscribe a handler to the supplied event name.
     * Parameters:
     *   eventName (string): Event identifier to subscribe to.
     *   handler (Function): Callback invoked whenever the event is emitted.
     * Returns: Function - Unsubscribe function that removes the handler when called.
     */
    on(eventName, handler) {
      if (typeof eventName !== 'string' || typeof handler !== 'function') return () => {};
      addListener(eventName, handler);
      return () => removeListener(eventName, handler);
    },

    /**
     * Function: off
     * Description: Remove a previously subscribed handler for the supplied event name.
     * Parameters:
     *   eventName (string): Event identifier.
     *   handler (Function): Previously registered callback to detach.
     * Returns: void.
     */
    off(eventName, handler) {
      if (typeof eventName !== 'string' || typeof handler !== 'function') return;
      removeListener(eventName, handler);
    },

    /**
     * Function: emit
     * Description: Notify all subscribers of the supplied event, passing an optional payload.
     * Parameters:
     *   eventName (string): Event identifier to broadcast.
     *   payload (any): Optional payload forwarded to subscribers.
     * Returns: void.
     */
    emit(eventName, payload) {
      if (typeof eventName !== 'string') return;
      emitEvent(eventName, payload);
    }
  };
}

/**
 * Function: createSharedEventBus
 * Description: Provide a singleton event bus instance reused across the application.
 * Parameters: None.
 * Returns: object - Singleton bus instance supporting on/off/emit.
 */
function createSharedEventBus() {
  return createEventBus();
}

export const sharedEventBus = createSharedEventBus();

/**
 * Function: on
 * Description: Subscribe to an event on the shared bus.
 * Parameters:
 *   eventName (string): Event identifier to subscribe to.
 *   handler (Function): Callback invoked when the event fires.
 * Returns: Function - Unsubscribe helper for the subscription.
 */
export function on(eventName, handler) {
  return sharedEventBus.on(eventName, handler);
}

/**
 * Function: off
 * Description: Remove a handler from the shared bus for the given event.
 * Parameters:
 *   eventName (string): Event identifier.
 *   handler (Function): Previously registered callback.
 * Returns: void.
 */
export function off(eventName, handler) {
  sharedEventBus.off(eventName, handler);
}

/**
 * Function: emit
 * Description: Emit an event on the shared bus and forward an optional payload to subscribers.
 * Parameters:
 *   eventName (string): Event identifier to broadcast.
 *   payload (any): Optional payload forwarded to subscribers.
 * Returns: void.
 */
export function emit(eventName, payload) {
  sharedEventBus.emit(eventName, payload);
}

/**
 * Function: getEventNames
 * Description: Provide well-known event name constants used across modules.
 * Parameters: None.
 * Returns: object - Dictionary of application-wide event identifiers.
 */
export function getEventNames() {
  return {
    VOYAGE_SELECT_REQUESTED: 'voyage:select-requested',
    VOYAGE_SELECTED: 'voyage:selected',
    VOYAGE_MAX_SPEED_REQUESTED: 'voyage:max-speed-requested',
    SEGMENT_SELECT_REQUESTED: 'segment:select-requested',
    SEGMENT_MAX_SPEED_REQUESTED: 'segment:max-speed-requested',
    SELECTION_RESET_REQUESTED: 'selection:reset-requested',
    SELECTION_RESET_COMPLETE: 'selection:reset-complete'
  };
}

export const EVENTS = getEventNames();

export default sharedEventBus;
