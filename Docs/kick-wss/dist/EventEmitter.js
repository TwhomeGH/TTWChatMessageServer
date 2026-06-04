// EventEmitter ligero sin dependencias externas
export class EventEmitter {
    constructor() {
        this.events = new Map();
        this.maxListeners = 10;
    }
    /**
     * Registra un listener para un evento
     */
    on(event, listener) {
        if (!this.events.has(event)) {
            this.events.set(event, new Set());
        }
        const listeners = this.events.get(event);
        listeners.add(listener);
    }
    /**
     * Registra un listener que se ejecuta solo una vez
     */
    once(event, listener) {
        const onceWrapper = (...args) => {
            this.off(event, onceWrapper);
            listener(...args);
        };
        this.on(event, onceWrapper);
    }
    /**
     * Elimina un listener de un evento
     */
    off(event, listener) {
        const listeners = this.events.get(event);
        if (listeners) {
            listeners.delete(listener);
            if (listeners.size === 0) {
                this.events.delete(event);
            }
        }
    }
    /**
     * Elimina todos los listeners de un evento o de todos los eventos
     */
    removeAllListeners(event) {
        if (event) {
            this.events.delete(event);
        }
        else {
            this.events.clear();
        }
    }
    /**
     * Emite un evento con los datos proporcionados
     */
    emit(event, ...args) {
        const listeners = this.events.get(event);
        if (!listeners || listeners.size === 0) {
            return false;
        }
        // Crear una copia para evitar problemas si se modifican los listeners durante la ejecución
        const listenersArray = Array.from(listeners);
        for (const listener of listenersArray) {
            try {
                listener(...args);
            }
            catch (error) {
                console.error(`Error in event listener for "${event}":`, error);
            }
        }
        return true;
    }
    /**
     * Obtiene el número de listeners para un evento
     */
    listenerCount(event) {
        const listeners = this.events.get(event);
        return listeners ? listeners.size : 0;
    }
    /**
     * Obtiene los nombres de todos los eventos registrados
     */
    eventNames() {
        return Array.from(this.events.keys());
    }
    /**
     * Establece el número máximo de listeners por evento
     */
    setMaxListeners(n) {
        this.maxListeners = n;
    }
    /**
     * Obtiene el número máximo de listeners por evento
     */
    getMaxListeners() {
        return this.maxListeners;
    }
    /**
     * Agrega un listener al principio de la cola
     */
    prependListener(event, listener) {
        if (!this.events.has(event)) {
            this.events.set(event, new Set());
        }
        const listeners = this.events.get(event);
        const listenersArray = Array.from(listeners);
        listeners.clear();
        listeners.add(listener);
        listenersArray.forEach((l) => listeners.add(l));
    }
    /**
     * Agrega un listener que se ejecuta solo una vez al principio de la cola
     */
    prependOnceListener(event, listener) {
        const onceWrapper = (...args) => {
            this.off(event, onceWrapper);
            listener(...args);
        };
        this.prependListener(event, onceWrapper);
    }
}
//# sourceMappingURL=EventEmitter.js.map