import { EventEmitter } from "./EventEmitter.js";
import type { ConnectionState, EventHandler, KickChannel, EventDataMap, ExtendedKickWebSocketOptions, SubscriptionMessage, WebSocketConfig } from "./types.js";
export declare class WebSocketManager extends EventEmitter {
    private ws;
    private channelName;
    private channelId;
    private connectionState;
    private options;
    private reconnectTimer;
    private isManualDisconnect;
    private connectionResolver;
    private connectionRejector;
    private websocketUrl;
    private websocketParams;
    private customSubscriptions;
    private subscriptionMessages;
    private readonly DEFAULT_WEBSOCKET_URL;
    private readonly DEFAULT_WS_PARAMS;
    constructor(options?: ExtendedKickWebSocketOptions);
    /**
     * Conecta al WebSocket de un canal específico
     * Retorna una promesa que se resuelve cuando la conexión está lista
     */
    connect(channelName: string): Promise<void>;
    /**
     * Realiza la conexión al WebSocket
     */
    private performConnection;
    /**
     * Construye la URL del WebSocket con parámetros
     */
    private buildWebSocketUrl;
    /**
     * Actualiza la configuración del WebSocket (URL y parámetros)
     */
    setWebSocketConfig(config: WebSocketConfig): void;
    /**
     * Obtiene la configuración actual del WebSocket
     */
    getWebSocketConfig(): WebSocketConfig;
    /**
     * Restablece la configuración del WebSocket a los valores por defecto
     */
    resetWebSocketConfig(): void;
    /**
     * Añade canales de suscripción personalizados
     */
    addCustomSubscriptions(channels: string[]): void;
    /**
     * Añade mensajes de suscripción completamente personalizados
     */
    addSubscriptionMessages(messages: SubscriptionMessage[]): void;
    /**
     * Limpia todas las suscripciones personalizadas
     */
    clearCustomSubscriptions(): void;
    /**
     * Obtiene las suscripciones personalizadas actuales
     */
    getCustomSubscriptions(): {
        channels: string[];
        messages: SubscriptionMessage[];
    };
    /**
     * Configura los manejadores de eventos del WebSocket
     */
    private setupWebSocketHandlers;
    /**
     * Se suscribe a todos los canales (principal + personalizados)
     */
    private subscribeToChannels;
    /**
     * Envía un mensaje de suscripción al WebSocket
     */
    private sendSubscription;
    /**
     * Suscribe a un canal adicional después de la conexión inicial
     */
    subscribeToChannel(channel: string): void;
    /**
     * Desuscribe de un canal
     */
    unsubscribeFromChannel(channel: string): void;
    sendPing(): void;
    /**
     * Maneja los mensajes recibidos del WebSocket
     */
    private handleMessage;
    /**
     * Verifica si un evento está filtrado
     */
    private isEventFiltered;
    /**
     * Maneja la desconexión
     */
    private handleDisconnect;
    /**
     * Maneja errores de conexión
     */
    private handleConnectionError;
    /**
     * Programa una reconexión
     */
    private scheduleReconnect;
    /**
     * Desconecta manualmente
     */
    disconnect(): void;
    /**
     * Obtiene información del canal
     */
    getChannelInfo(channelName: string): Promise<KickChannel>;
    /**
     * Establece el estado de conexión
     */
    private setConnectionState;
    /**
     * Registra mensajes de debug si está habilitado
     */
    private log;
    /**
     * Registra un listener para un evento específico
     */
    on<K extends keyof EventDataMap>(event: K, handler: EventHandler<EventDataMap[K]>): void;
    /**
     * Registra un listener que se ejecuta solo una vez
     */
    once<K extends keyof EventDataMap>(event: K, handler: EventHandler<EventDataMap[K]>): void;
    /**
     * Elimina un listener
     */
    off<K extends keyof EventDataMap>(event: K, handler: EventHandler<EventDataMap[K]>): void;
    /**
     * Verifica si está conectado
     */
    isConnected(): boolean;
    /**
     * Obtiene el estado actual de conexión
     */
    getConnectionState(): ConnectionState;
    /**
     * Obtiene el nombre del canal actual
     */
    getChannelName(): string;
    /**
     * Obtiene el ID del canal actual
     */
    getChannelId(): number;
    /**
     * Actualiza las opciones en tiempo de ejecución
     */
    updateOptions(newOptions: Partial<ExtendedKickWebSocketOptions>): void;
}
//# sourceMappingURL=WebSocketManager.d.ts.map