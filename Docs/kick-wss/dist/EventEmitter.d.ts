export declare class EventEmitter {
    private events;
    private maxListeners;
    /**
     * Registra un listener para un evento
     */
    on(event: string, listener: Function): void;
    /**
     * Registra un listener que se ejecuta solo una vez
     */
    once(event: string, listener: Function): void;
    /**
     * Elimina un listener de un evento
     */
    off(event: string, listener: Function): void;
    /**
     * Elimina todos los listeners de un evento o de todos los eventos
     */
    removeAllListeners(event?: string): void;
    /**
     * Emite un evento con los datos proporcionados
     */
    emit(event: string, ...args: any[]): boolean;
    /**
     * Obtiene el número de listeners para un evento
     */
    listenerCount(event: string): number;
    /**
     * Obtiene los nombres de todos los eventos registrados
     */
    eventNames(): string[];
    /**
     * Establece el número máximo de listeners por evento
     */
    setMaxListeners(n: number): void;
    /**
     * Obtiene el número máximo de listeners por evento
     */
    getMaxListeners(): number;
    /**
     * Agrega un listener al principio de la cola
     */
    prependListener(event: string, listener: Function): void;
    /**
     * Agrega un listener que se ejecuta solo una vez al principio de la cola
     */
    prependOnceListener(event: string, listener: Function): void;
}
//# sourceMappingURL=EventEmitter.d.ts.map