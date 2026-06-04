// EventEmitter ligero sin dependencias externas
class EventEmitter {
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



class MessageParser {
    /**
     * Parsea un mensaje raw del WebSocket y devuelve el evento procesado
     */
    static parseMessage(rawMessage) {
        try {
            if (!rawMessage || rawMessage.trim() === "") {
                return null;
            }
            const message = JSON.parse(rawMessage);
            if (!message.event || message.data === undefined) {
                return null;
            }
            // Ignorar mensajes de sistema del WebSocket
            if (message.event.startsWith("pusher:") ||
                message.event.startsWith("pusher_internal:")) {
                return null;
            }
            if (message.event === "" || message.data === "") {
                return null;
            }
            // Parsear los datos del evento
            let eventData;
            try {
                if (message.data === undefined || message.data === "") {
                    return null;
                }
                eventData = JSON.parse(message.data);
            }
            catch (e) {
                console.error("Error parsing event data:", e);
                return null;
            }
            // Normalizar evento: soporta ambos formatos (con y sin namespace)
            const normalizedEvent = LEGACY_EVENT_MAPPING[message.event] || message.event;
            // Guardar el formato original para retrocompatibilidad
            const originalEvent = message.event;
            const isLegacyFormat = message.event !== normalizedEvent;
            // Mapear eventos usando el enum
            let result = null;
            switch (normalizedEvent) {
                case KickEvent.ChatMessage:
                    result = {
                        type: "ChatMessage",
                        data: this.parseChatMessage(eventData),
                    };
                    break;
                case KickEvent.MessageDeleted:
                    result = {
                        type: "MessageDeleted",
                        data: this.parseMessageDeleted(eventData),
                    };
                    break;
                case KickEvent.UserBanned:
                    result = {
                        type: "UserBanned",
                        data: this.parseUserBanned(eventData),
                    };
                    break;
                case KickEvent.UserUnbanned:
                    result = {
                        type: "UserUnbanned",
                        data: this.parseUserUnbanned(eventData),
                    };
                    break;
                case KickEvent.Subscription:
                    result = {
                        type: "Subscription",
                        data: this.parseSubscription(eventData),
                    };
                    break;
                case KickEvent.GiftedSubscriptions:
                    result = {
                        type: "GiftedSubscriptions",
                        data: this.parseGiftedSubscriptions(eventData),
                    };
                    break;
                case KickEvent.PinnedMessageCreated:
                    result = {
                        type: "PinnedMessageCreated",
                        data: this.parsePinnedMessageCreated(eventData),
                    };
                    break;
                case KickEvent.StreamHost:
                    result = {
                        type: "StreamHost",
                        data: this.parseStreamHost(eventData),
                    };
                    break;
                case KickEvent.PollUpdate:
                    result = {
                        type: "PollUpdate",
                        data: this.parsePollUpdate(eventData),
                    };
                    break;
                case KickEvent.PollDelete:
                    result = {
                        type: "PollDelete",
                        data: this.parsePollDelete(eventData),
                    };
                    break;
                case KickEvent.RewardRedeemed:
                    result = {
                        type: "RewardRedeemed",
                        data: this.parseRewardRedeemed(eventData),
                    };
                    break;
                case KickEvent.KicksGifted:
                    result = {
                        type: "KicksGifted",
                        data: this.parseKicksGifted(eventData),
                    };
                    break;
                default:
                    if (!message.event?.startsWith("pusher:") &&
                        !message.event?.startsWith("pusher_internal:")) {
                        console.warn("Unknown event type:", message.event);
                    }
                    return null;
            }
            // Si el evento venía en formato legacy, incluir ambos formatos
            if (result && isLegacyFormat) {
                result.legacyType = originalEvent;
            }
            return result;
        }
        catch (error) {
            console.error("Error parsing message:", error);
            return null;
        }
    }
    /**
     * Parsea un evento de mensaje de chat
     */
    static parseChatMessage(data) {
        return {
            id: data.id,
            content: this.cleanEmotes(data.content),
            type: "message",
            created_at: data.created_at,
            sender: {
                id: data.sender.id,
                username: data.sender.username,
                slug: data.sender.slug,
                identity: {
                    color: data.sender.identity?.color || "#ffffff",
                    badges: data.sender.identity?.badges || [],
                },
            },
            chatroom: {
                id: data.chatroom?.id || 0,
            },
        };
    }
    /**
     * Parsea un evento de mensaje eliminado
     */
    static parseMessageDeleted(data) {
        return {
            message_id: data.message_id,
            chatroom_id: data.chatroom_id,
            type: "message_deleted",
        };
    }
    /**
     * Parsea un evento de usuario baneado
     */
    static parseUserBanned(data) {
        return {
            username: data.username || data.banned_username || "unknown",
            type: "user_banned",
        };
    }
    /**
     * Parsea un evento de usuario desbaneado
     */
    static parseUserUnbanned(data) {
        return {
            username: data.username || data.unbanned_username || "unknown",
            type: "user_unbanned",
        };
    }
    /**
     * Parsea un evento de suscripción
     */
    static parseSubscription(data) {
        return {
            username: data.username || data.user?.username || "unknown",
            type: "subscription",
        };
    }
    /**
     * Parsea un evento de suscripciones regaladas
     */
    static parseGiftedSubscriptions(data) {
        const gifter = data.gifted_by ||
            (typeof data.gifter === "object" ? data.gifter.username : data.gifter) ||
            "unknown";
        const recipients = Array.isArray(data.recipients)
            ? data.recipients.map((r) => typeof r === "string" ? r : r.username || "unknown")
            : [];
        return {
            gifted_by: gifter,
            recipients,
            type: "gifted_subscriptions",
        };
    }
    /**
     * Parsea un evento de mensaje fijado
     */
    static parsePinnedMessageCreated(data) {
        return {
            message: this.parseChatMessage(data.message),
            type: "pinned_message_created",
        };
    }
    /**
     * Parsea un evento de host de stream
     */
    static parseStreamHost(data) {
        const hoster = typeof data.hoster === "string"
            ? data.hoster
            : data.hoster?.username || "unknown";
        const hostedChannel = typeof data.hosted_channel === "string"
            ? data.hosted_channel
            : data.hosted_channel?.username || "unknown";
        return {
            hoster,
            hosted_channel: hostedChannel,
            type: "stream_host",
        };
    }
    /**
     * Parsea un evento de actualización de encuesta
     */
    static parsePollUpdate(data) {
        return {
            poll_id: data.id,
            question: data.question,
            options: (data.options || []).map((opt) => ({
                id: opt.id,
                text: opt.text,
                votes: opt.votes || 0,
            })),
            type: "poll_update",
        };
    }
    /**
     * Parsea un evento de eliminación de encuesta
     */
    static parsePollDelete(data) {
        return {
            poll_id: data.id,
            type: "poll_delete",
        };
    }
    /**
     * Parsea un evento de recompensa canjeada
     */
    static parseRewardRedeemed(data) {
        return {
            reward_title: data.reward_title,
            user_id: data.user_id,
            channel_id: data.channel_id,
            username: data.username,
            user_input: data.user_input,
            reward_background_color: data.reward_background_color,
            type: "reward_redeemed",
        };
    }
    /**
     * Parsea un evento de Kicks regalados
     */
    static parseKicksGifted(data) {
        return {
            gift_transaction_id: data.gift_transaction_id,
            message: data.message,
            sender: {
                id: data.sender.id,
                username: data.sender.username,
                username_color: data.sender.username_color,
            },
            gift: {
                gift_id: data.gift.gift_id,
                name: data.gift.name,
                amount: data.gift.amount,
                type: data.gift.type,
                tier: data.gift.tier,
                character_limit: data.gift.character_limit,
                pinned_time: data.gift.pinned_time,
            },
            type: "kicks_gifted",
        };
    }
    /**
     * Limpia los códigos de emote del contenido del mensaje
     */
    static cleanEmotes(content) {
        if (!content)
            return "";
        return content.replace(/\[emote:(\d+):(\w+)\]/g, "$2");
    }
    /**
     * Verifica si un mensaje es válido
     */
    static isValidMessage(message) {
        try {
            if (!message || message.trim() === "") {
                return false;
            }
            const parsed = JSON.parse(message);
            return (!!parsed.event &&
                parsed.data !== undefined &&
                parsed.event !== "" &&
                parsed.data !== "");
        }
        catch {
            return false;
        }
    }
    /**
     * Extrae el tipo de evento de un mensaje raw
     */
    static extractEventType(rawMessage) {
        try {
            if (!rawMessage || rawMessage.trim() === "") {
                return null;
            }
            const message = JSON.parse(rawMessage);
            if (!message.event) {
                return null;
            }
            if (message.event.startsWith("pusher:") ||
                message.event.startsWith("pusher_internal:")) {
                return null;
            }
            if (message.event === "") {
                return null;
            }
            return message.event;
        }
        catch {
            return null;
        }
    }
}


// Gestor principal de conexión WebSocket para Kick.com



// Mapeo de eventos de Kick a tipos estándar
const EVENT_TYPE_MAP = {
    [KickEvent.ChatMessage]: "ChatMessage",
    [KickEvent.MessageDeleted]: "MessageDeleted",
    [KickEvent.UserBanned]: "UserBanned",
    [KickEvent.UserUnbanned]: "UserUnbanned",
    [KickEvent.Subscription]: "Subscription",
    [KickEvent.GiftedSubscriptions]: "GiftedSubscriptions",
    [KickEvent.PinnedMessageCreated]: "PinnedMessageCreated",
    [KickEvent.StreamHost]: "StreamHost",
    [KickEvent.PollUpdate]: "PollUpdate",
    [KickEvent.PollDelete]: "PollDelete",
    [KickEvent.KicksGifted]: "KicksGifted",
};
class WebSocketManager extends EventEmitter {
    constructor(options = {}) {
        super();
        this.ws = null;
        this.channelName = "";
        this.channelId = 0;
        this.connectionState = "disconnected";
        this.reconnectTimer = null;
        this.isManualDisconnect = false;
        this.connectionResolver = null;
        this.connectionRejector = null;
        // Suscripciones personalizadas
        this.customSubscriptions = [];
        this.subscriptionMessages = [];
        // Valores por defecto
        this.DEFAULT_WEBSOCKET_URL = "wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679";
        this.DEFAULT_WS_PARAMS = {
            protocol: "7",
            client: "js",
            version: "8.4.0",
            flash: "false",
        };
        // Configurar opciones básicas
        this.options = {
            debug: false,
            autoReconnect: true,
            reconnectInterval: 5000,
            connectionTimeout: 10000,
            filteredEvents: [],
            ...options,
        };
        // Configurar WebSocket URL y parámetros
        this.websocketUrl = options.websocketConfig?.url || this.DEFAULT_WEBSOCKET_URL;
        this.websocketParams = {
            ...this.DEFAULT_WS_PARAMS,
            ...options.websocketConfig?.params,
        };
        // Configurar suscripciones personalizadas
        this.customSubscriptions = options.customSubscriptions || [];
        this.subscriptionMessages = options.subscriptionMessages || [];
        this.log("WebSocketManager initialized with config:", {
            url: this.websocketUrl,
            params: this.websocketParams,
            customSubscriptions: this.customSubscriptions,
            subscriptionMessages: this.subscriptionMessages,
        });
    }
    /**
     * Conecta al WebSocket de un canal específico
     * Retorna una promesa que se resuelve cuando la conexión está lista
     */
    async connect(channelName) {
        if (this.connectionState === "connected" ||
            this.connectionState === "connecting") {
            this.log("Already connected or connecting");
            return;
        }
        this.channelName = channelName;
        this.isManualDisconnect = false;
        return new Promise((resolve, reject) => {
            this.connectionResolver = resolve;
            this.connectionRejector = reject;
            // Timeout para evitar que la promesa nunca se resuelva
            const timeout = setTimeout(() => {
                if (this.connectionState !== "connected") {
                    const error = new Error(`Connection timeout after ${this.options.connectionTimeout}ms`);
                    this.handleConnectionError(error);
                    reject(error);
                }
            }, this.options.connectionTimeout);
            // Limpiar timeout cuando se conecte
            const cleanupTimeout = () => clearTimeout(timeout);
            this.once("ready", cleanupTimeout);
            this.once("error", cleanupTimeout);
            this.performConnection().catch((error) => {
                clearTimeout(timeout);
                reject(error);
            });
        });
    }
    /**
     * Realiza la conexión al WebSocket
     */
    async performConnection() {
        this.setConnectionState("connecting");
        this.log(`Connecting to channel: ${this.channelName}`);
        try {
            // Obtener información del canal
            const channelInfo = await this.getChannelInfo(this.channelName);
            this.channelId = channelInfo.chatroom.id;
            // Construir URL del WebSocket
            const wsUrl = this.buildWebSocketUrl();
            // Crear conexión WebSocket
            this.ws = new WebSocket(wsUrl);
            // Configurar manejadores de eventos
            this.setupWebSocketHandlers();
        }
        catch (error) {
            this.handleConnectionError(error);
            throw error;
        }
    }
    /**
     * Construye la URL del WebSocket con parámetros
     */
    buildWebSocketUrl() {
        const params = new URLSearchParams(this.websocketParams);
        return `${this.websocketUrl}?${params.toString()}`;
    }
    /**
     * Actualiza la configuración del WebSocket (URL y parámetros)
     */
    setWebSocketConfig(config) {
        if (config.url) {
            this.websocketUrl = config.url;
            this.log(`WebSocket URL updated: ${config.url}`);
        }
        if (config.params) {
            this.websocketParams = { ...this.websocketParams, ...config.params };
            this.log(`WebSocket params updated:`, this.websocketParams);
        }
    }
    /**
     * Obtiene la configuración actual del WebSocket
     */
    getWebSocketConfig() {
        return {
            url: this.websocketUrl,
            params: { ...this.websocketParams },
        };
    }
    /**
     * Restablece la configuración del WebSocket a los valores por defecto
     */
    resetWebSocketConfig() {
        this.websocketUrl = this.DEFAULT_WEBSOCKET_URL;
        this.websocketParams = { ...this.DEFAULT_WS_PARAMS };
        this.log("WebSocket configuration reset to defaults");
    }
    /**
     * Añade canales de suscripción personalizados
     */
    addCustomSubscriptions(channels) {
        this.customSubscriptions.push(...channels);
        this.log(`Custom subscriptions added:`, channels);
    }
    /**
     * Añade mensajes de suscripción completamente personalizados
     */
    addSubscriptionMessages(messages) {
        this.subscriptionMessages.push(...messages);
        this.log(`Subscription messages added:`, messages);
    }
    /**
     * Limpia todas las suscripciones personalizadas
     */
    clearCustomSubscriptions() {
        this.customSubscriptions = [];
        this.subscriptionMessages = [];
        this.log("Custom subscriptions cleared");
    }
    /**
     * Obtiene las suscripciones personalizadas actuales
     */
    getCustomSubscriptions() {
        return {
            channels: [...this.customSubscriptions],
            messages: [...this.subscriptionMessages],
        };
    }
    /**
     * Configura los manejadores de eventos del WebSocket
     */
    setupWebSocketHandlers() {
        if (!this.ws)
            return;
        this.ws.onopen = () => {
            this.log("WebSocket connection opened");
            this.subscribeToChannels();
        };
        this.ws.onmessage = (event) => {
            this.handleMessage(event.data);
        };
        this.ws.onclose = (event) => {
            this.log(`WebSocket closed: ${event.code} - ${event.reason}`);
            this.handleDisconnect(event.code, event.reason);
        };
        this.ws.onerror = (error) => {
            this.log("WebSocket error:", error);
            this.emit("error", error);
            this.connectionRejector?.(new Error("WebSocket error"));
        };
    }
    /**
     * Se suscribe a todos los canales (principal + personalizados)
     */
    subscribeToChannels() {
        if (!this.ws)
            return;
        // Crear un Set para trackear canales ya suscritos
        const subscribedChannels = new Set();
        /*
        {"event":"pusher:subscribe","data":{"auth":"","channel":"chatroom_56235532"}}
        {"event":"pusher:subscribe","data":{"auth":"","channel":"chatrooms.56235532.v2"}}
        {"event":"pusher:subscribe","data":{"auth":"","channel":"channel_56523912"}}
        {"event":"pusher:subscribe","data":{"auth":"","channel":"chatrooms.56235532"}}
        {"event":"pusher:subscribe","data":{"auth":"","channel":"channel.56523912"}}
        {"event":"pusher:subscribe","data":{"auth":"","channel":"predictions-channel-56523912"}}
    
        */
        this.customSubscriptions.push(`chatroom_${this.channelId}`);
        this.customSubscriptions.push(`chatrooms.${this.channelId}.v2`);
        this.customSubscriptions.push(`channel_${this.channelId}`);
        this.customSubscriptions.push(`chatrooms.${this.channelId}`);
        this.customSubscriptions.push(`channel.${this.channelId}`);
        this.customSubscriptions.push(`predictions-channel-${this.channelId}`);
        // Suscripciones a canales personalizados (evitando duplicados)
        for (const channel of this.customSubscriptions) {
            if (!subscribedChannels.has(channel)) {
                const subscribeMessage = {
                    event: "pusher:subscribe",
                    data: {
                        auth: "",
                        channel: channel,
                    },
                };
                this.sendSubscription(subscribeMessage);
                subscribedChannels.add(channel);
                this.log(`Subscribed to custom channel: ${channel}`);
            }
            else {
                this.log(`Skipping duplicate subscription: ${channel}`);
            }
        }
        // Enviar mensajes de suscripción completamente personalizados (evitando duplicados)
        for (const message of this.subscriptionMessages) {
            const channel = message.data?.channel;
            if (channel && !subscribedChannels.has(channel)) {
                this.sendSubscription(message);
                subscribedChannels.add(channel);
                this.log(`Sent custom subscription message:`, message);
            }
            else {
                this.log(`Skipping duplicate subscription message for channel: ${channel}`);
            }
        }
        // Marcar como conectado después de todas las suscripciones
        this.setConnectionState("connected");
        this.emit("ready", {
            channel: this.channelName,
            customSubscriptions: Array.from(subscribedChannels),
        });
        // Resolver la promesa de conexión
        this.connectionResolver?.();
        this.connectionResolver = null;
        this.connectionRejector = null;
    }
    /**
     * Envía un mensaje de suscripción al WebSocket
     */
    sendSubscription(message) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.log("Cannot send subscription: WebSocket not open");
            return;
        }
        try {
            this.ws.send(JSON.stringify(message));
            this.emit("subscriptionSent", message);
        }
        catch (error) {
            this.log("Error sending subscription:", error);
            this.emit("subscriptionError", { message, error });
        }
    }
    /**
     * Suscribe a un canal adicional después de la conexión inicial
     */
    subscribeToChannel(channel) {
        if (!this.isConnected()) {
            this.log("Cannot subscribe: not connected");
            return;
        }
        const subscribeMessage = {
            event: "pusher:subscribe",
            data: {
                auth: "",
                channel: channel,
            },
        };
        this.sendSubscription(subscribeMessage);
        this.log(`Dynamically subscribed to channel: ${channel}`);
    }
    /**
     * Desuscribe de un canal
     */
    unsubscribeFromChannel(channel) {
        if (!this.isConnected()) {
            this.log("Cannot unsubscribe: not connected");
            return;
        }
        const unsubscribeMessage = {
            event: "pusher:unsubscribe",
            data: {
                channel: channel,
            },
        };
        if (this.ws) {
            this.ws.send(JSON.stringify(unsubscribeMessage));
            this.log(`Unsubscribed from channel: ${channel}`);
        }
    }
    sendPing() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.log("Cannot send ping: WebSocket not open");
            return;
        }
        try {
            this.ws.send(JSON.stringify({ event: "pusher:ping", data: "{}" }));
            this.emit("pingSent");
        }
        catch (error) {
            this.log("Error sending ping:", error);
            this.emit("pingError", error);
        }
    }
    /**
     * Maneja los mensajes recibidos del WebSocket
     */
    handleMessage(rawMessage) {
        // Emitir mensaje raw primero
        this.emit("rawMessage", rawMessage);
        // Filtrar eventos de sistema de Pusher temprano
        try {
            const message = JSON.parse(rawMessage);
            if (message.event?.startsWith("pusher:") ||
                message.event?.startsWith("pusher_internal:")) {
                if (message.event === "pusher:pong") {
                    this.sendPing();
                }
                this.log(`Ignoring Pusher system event: ${message.event}`);
                return;
            }
        }
        catch (e) {
            // Si no es JSON válido, continuamos con el procesamiento normal
        }
        // Verificar si el evento está filtrado
        const eventType = MessageParser.extractEventType(rawMessage);
        if (eventType && this.isEventFiltered(eventType)) {
            this.log(`Event filtered: ${eventType}`);
            return;
        }
        // Parsear el mensaje
        const parsedMessage = MessageParser.parseMessage(rawMessage);
        if (parsedMessage) {
            this.log(`Parsed event: ${parsedMessage.type}`);
            this.emit(parsedMessage.type, parsedMessage.data);
        }
    }
    /**
     * Verifica si un evento está filtrado
     */
    isEventFiltered(eventType) {
        if (this.options.filteredEvents.length === 0) {
            return false;
        }
        // Verificar compatibilidad con nombres antiguos
        const normalizedEventType = LEGACY_EVENT_MAPPING[eventType] || eventType;
        const standardEventType = EVENT_TYPE_MAP[normalizedEventType];
        return standardEventType
            ? !this.options.filteredEvents.includes(standardEventType)
            : false;
    }
    /**
     * Maneja la desconexión
     */
    handleDisconnect(code, reason) {
        this.setConnectionState("disconnected");
        this.emit("disconnect", { code, reason });
        // Rechazar promesa de conexión si existe
        this.connectionRejector?.(new Error(`Disconnected: ${code} - ${reason}`));
        this.connectionResolver = null;
        this.connectionRejector = null;
        // Reconexión automática si no es desconexión manual
        if (this.options.autoReconnect && !this.isManualDisconnect) {
            this.scheduleReconnect();
        }
    }
    /**
     * Maneja errores de conexión
     */
    handleConnectionError(error) {
        this.setConnectionState("error");
        this.emit("error", error);
        // Rechazar promesa de conexión si existe
        this.connectionRejector?.(error);
        this.connectionResolver = null;
        this.connectionRejector = null;
        if (this.options.autoReconnect && !this.isManualDisconnect) {
            this.scheduleReconnect();
        }
    }
    /**
     * Programa una reconexión
     */
    scheduleReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
        this.setConnectionState("reconnecting");
        this.log(`Scheduling reconnect in ${this.options.reconnectInterval}ms`);
        this.reconnectTimer = setTimeout(() => {
            this.log("Attempting to reconnect...");
            this.performConnection().catch((error) => {
                this.log("Reconnection failed:", error);
            });
        }, this.options.reconnectInterval);
    }
    /**
     * Desconecta manualmente
     */
    disconnect() {
        this.isManualDisconnect = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            this.ws.close(1000, "Manual disconnect");
            this.ws = null;
        }
        this.setConnectionState("disconnected");
        this.log("Manual disconnect completed");
    }
    /**
     * Obtiene información del canal
     */
    async getChannelInfo(channelName) {
        const url = `https://kick.com/api/v2/channels/${channelName}`;
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const data = (await response.json());
            return data;
        }
        catch (error) {
            this.log("Error fetching channel info:", error);
            throw new Error(`Failed to fetch channel info for ${channelName}: ${String(error)}`);
        }
    }
    /**
     * Establece el estado de conexión
     */
    setConnectionState(state) {
        const oldState = this.connectionState;
        this.connectionState = state;
        this.log(`Connection state changed: ${oldState} -> ${state}`);
    }
    /**
     * Registra mensajes de debug si está habilitado
     */
    log(...args) {
        if (this.options.debug) {
            console.log("[KickWebSocket]", ...args);
        }
    }
    /**
     * Registra un listener para un evento específico
     */
    on(event, handler) {
        super.on(event, handler);
    }
    /**
     * Registra un listener que se ejecuta solo una vez
     */
    once(event, handler) {
        super.once(event, handler);
    }
    /**
     * Elimina un listener
     */
    off(event, handler) {
        super.off(event, handler);
    }
    // ==================== GETTERS ====================
    /**
     * Verifica si está conectado
     */
    isConnected() {
        return (this.connectionState === "connected" &&
            this.ws?.readyState === WebSocket.OPEN);
    }
    /**
     * Obtiene el estado actual de conexión
     */
    getConnectionState() {
        return this.connectionState;
    }
    /**
     * Obtiene el nombre del canal actual
     */
    getChannelName() {
        return this.channelName;
    }
    /**
     * Obtiene el ID del canal actual
     */
    getChannelId() {
        return this.channelId;
    }
    /**
     * Actualiza las opciones en tiempo de ejecución
     */
    updateOptions(newOptions) {
        this.options = { ...this.options, ...newOptions };
        if (newOptions.websocketConfig) {
            this.setWebSocketConfig(newOptions.websocketConfig);
        }
        if (newOptions.customSubscriptions) {
            this.addCustomSubscriptions(newOptions.customSubscriptions);
        }
        if (newOptions.subscriptionMessages) {
            this.addSubscriptionMessages(newOptions.subscriptionMessages);
        }
        this.log("Options updated:", this.options);
    }
}


// Definiciones de tipos para la librería WebSocket de Kick.com
// Enum para eventos de Kick (centralizado para mantener consistencia)
export var KickEvent;
(function (KickEvent) {
    KickEvent["ChatMessage"] = "App\\Events\\ChatMessageEvent";
    KickEvent["MessageDeleted"] = "App\\Events\\MessageDeletedEvent";
    KickEvent["UserBanned"] = "App\\Events\\UserBannedEvent";
    KickEvent["UserUnbanned"] = "App\\Events\\UserUnbannedEvent";
    KickEvent["Subscription"] = "App\\Events\\SubscriptionEvent";
    KickEvent["GiftedSubscriptions"] = "App\\Events\\GiftedSubscriptionsEvent";
    KickEvent["PinnedMessageCreated"] = "App\\Events\\PinnedMessageCreatedEvent";
    KickEvent["StreamHost"] = "App\\Events\\StreamHostEvent";
    KickEvent["PollUpdate"] = "App\\Events\\PollUpdateEvent";
    KickEvent["PollDelete"] = "App\\Events\\PollDeleteEvent";
    KickEvent["RewardRedeemed"] = "RewardRedeemedEvent";
    KickEvent["KicksGifted"] = "KicksGifted";
})(KickEvent || (KickEvent = {}));
// Enum simple para nombres de eventos (usado en on())
export var KickEvents;
(function (KickEvents) {
    KickEvents["ChatMessage"] = "ChatMessage";
    KickEvents["MessageDeleted"] = "MessageDeleted";
    KickEvents["UserBanned"] = "UserBanned";
    KickEvents["UserUnbanned"] = "UserUnbanned";
    KickEvents["Subscription"] = "Subscription";
    KickEvents["GiftedSubscriptions"] = "GiftedSubscriptions";
    KickEvents["PinnedMessageCreated"] = "PinnedMessageCreated";
    KickEvents["StreamHost"] = "StreamHost";
    KickEvents["PollUpdate"] = "PollUpdate";
    KickEvents["PollDelete"] = "PollDelete";
    KickEvents["RewardRedeemed"] = "RewardRedeemed";
    KickEvents["KicksGifted"] = "KicksGifted";
    KickEvents["PointsUpdated"] = "PointsUpdated";
    KickEvents["SubscriptionSucceeded"] = "pusher_internal:subscription_succeeded";
    KickEvents["Ready"] = "ready";
    KickEvents["Disconnect"] = "disconnect";
    KickEvents["Error"] = "error";
    KickEvents["RawMessage"] = "rawMessage";
})(KickEvents || (KickEvents = {}));
// Mapeo para compatibilidad con nombres antiguos
export const LEGACY_EVENT_MAPPING = {
    "App\\Events\\ChatMessageEvent": "ChatMessageEvent",
    "App\\Events\\MessageDeletedEvent": "MessageDeletedEvent",
    "App\\Events\\UserBannedEvent": "UserBannedEvent",
    "App\\Events\\UserUnbannedEvent": "UserUnbannedEvent",
    "App\\Events\\SubscriptionEvent": "SubscriptionEvent",
    "App\\Events\\GiftedSubscriptionsEvent": "GiftedSubscriptionsEvent",
    "App\\Events\\PinnedMessageCreatedEvent": "PinnedMessageCreatedEvent",
    "App\\Events\\StreamHostEvent": "StreamHostEvent",
    "App\\Events\\PollUpdateEvent": "PollUpdateEvent",
    "App\\Events\\PollDeleteEvent": "PollDeleteEvent",
    "App\\Events\\RewardRedeemedEvent": "RewardRedeemedEvent",
    "App\\Events\\KicksGiftedEvent": "KicksGiftedEvent",
};
// Array de todos los eventos disponibles
export const KICK_EVENTS = [
    "ChatMessage",
    "MessageDeleted",
    "UserBanned",
    "UserUnbanned",
    "Subscription",
    "GiftedSubscriptions",
    "PinnedMessageCreated",
    "StreamHost",
    "PollUpdate",
    "PollDelete",
    "RewardRedeemed",
    "KicksGifted",
    "PointsUpdated",
    "ready",
    "disconnect",
    "error",
    "rawMessage",
    "subscriptionSucceeded",
];


// Archivo principal de exportación de la librería WebSocket de Kick.com



// Exportar enums
export * from "./types.js";
// Clase principal simplificada para uso fácil


/**
 * Clase principal para conectar a los WebSockets de Kick.com
 *
 * Ejemplo de uso:
 * ```typescript
 * import { KickWebSocket } from './websocket-lib';
 *
 * const kickWS = new KickWebSocket({ debug: true });
 *
 * kickWS.connect('nombre-del-canal');
 *
 * kickWS.on('ChatMessage', (message) => {
 *   console.log('Nuevo mensaje:', message.content);
 * });
 *
 * kickWS.on('ready', () => {
 *   console.log('Conectado exitosamente');
 * });
 * ```
 */
export class KickWebSocket extends WebSocketManager {
    constructor(options = {}) {
        super(options);
    }
    /**
     * Método de conveniencia para escuchar todos los eventos
     */
    onAllEvents(handler) {
        const events = [
            "ChatMessage",
            "MessageDeleted",
            "UserBanned",
            "UserUnbanned",
            "Subscription",
            "GiftedSubscriptions",
            "PinnedMessageCreated",
            "StreamHost",
            "PollUpdate",
            "PollDelete",
            "RewardRedeemed",
            "KicksGifted",
            "PointsUpdated",
            "subscriptionSucceeded",
            "rawMessage",
            "ready",
            "error",
            "disconnect",
        ];
        events.forEach((event) => {
            this.on(event, handler);
        });
    }
    /**
     * Método de conveniencia para escuchar solo eventos de chat
     */
    onChatEvents(handler) {
        const chatEvents = [
            "ChatMessage",
            "MessageDeleted",
            "PinnedMessageCreated",
        ];
        chatEvents.forEach((event) => {
            this.on(event, handler);
        });
    }
    /**
     * Método de conveniencia para escuchar solo eventos de usuarios
     */
    onUserEvents(handler) {
        const userEvents = [
            "UserBanned",
            "UserUnbanned",
            "Subscription",
            "GiftedSubscriptions",
        ];
        userEvents.forEach((event) => {
            this.on(event, handler);
        });
    }
    /**
     * Método de conveniencia para escuchar solo eventos de stream
     */
    onStreamEvents(handler) {
        const streamEvents = [
            "StreamHost",
            "PollUpdate",
            "PollDelete",
        ];
        streamEvents.forEach((event) => {
            this.on(event, handler);
        });
    }
    /**
     * Crea una instancia configurada para modo de debug
     */
    static createDebug(channelName) {
        const ws = new KickWebSocket({
            debug: true,
            autoReconnect: true,
            reconnectInterval: 3000,
        });
        if (channelName) {
            ws.connect(channelName).catch(console.error);
        }
        return ws;
    }
}
// Exportar por defecto la clase principal
export default KickWebSocket;
// =====================================================
// EJEMPLOS DE USO / USAGE EXAMPLES
// =====================================================
/**
 * Ejemplo 1: Usando enums para escuchar eventos específicos
 * Example 1: Using enums to listen to specific events
 *
 * ```typescript
 * import { KickWebSocket, KickEvents } from './websocket-lib';
 *
 * const kickWS = new KickWebSocket({ debug: true });
 *
 * // Usar enum para escuchar mensajes de chat
 * // Using enum to listen to chat messages
 * kickWS.on(KickEvents.ChatMessage, (data) => {
 *   console.log('Nuevo mensaje de chat:', data.content);
 *   console.log('Usuario:', data.sender?.username);
 * });
 *
 * // Usar enum para escuchar mensajes eliminados
 * kickWS.on(KickEvents.MessageDeleted, (data) => {
 *   console.log('Mensaje eliminado:', data.message_id);
 * });
 *
 * // Usar enum para escuchar bans
 * kickWS.on(KickEvents.UserBanned, (data) => {
 *   console.log('Usuario baneado:', data.username);
 * });
 *
 * // Usar enum para escuchar suscripciones
 * kickWS.on(KickEvents.Subscription, (data) => {
 *   console.log('Nueva suscripción de:', data.username);
 * });
 *
 * // Conectar al canal
 * kickWS.connect('nombre-canal');
 * ```
 */
/**
 * Ejemplo 2: Usando forEach para escuchar todos los eventos
 * Example 2: Using forEach to listen to all events
 *
 * ```typescript
 * import { KickWebSocket, KickEvents, KICK_EVENTS } from './websocket-lib';
 *
 * const kickWS = new KickWebSocket({ debug: true });
 *
 * // Escuchar todos los eventos con forEach
 * // Listen to all events with forEach
 * KICK_EVENTS.forEach((event) => {
 *   kickWS.on(event, (data) => {
 *     console.log(`Evento: ${event}`, data);
 *   });
 * });
 *
 * // O usando el enum KickEvents con Object.values()
 * // Or using the KickEvents enum with Object.values()
 * Object.values(KickEvents).forEach((event) => {
 *   kickWS.on(event as any, (data) => {
 *     console.log(`Evento: ${event}`, data);
 *   });
 * });
 *
 * kickWS.connect('nombre-canal');
 * ```
 */
/**
 * Ejemplo 3: Función helper para emitir todos los eventos
 * Example 3: Helper function to emit all events
 *
 * ```typescript
 * import { KickWebSocket, KickEvents } from './websocket-lib';
 *
 * const kickWS = new KickWebSocket({ debug: true });
 *
 * // Función para escuchar y re-emitir todos los eventos
 * // Function to listen and re-emit all events
 * function listenToAllEvents(ws: KickWebSocket) {
 *   const events = Object.values(KickEvents);
 *
 *   events.forEach((event) => {
 *     ws.on(event as any, (data) => {
 *       console.log('────────────── EVENTO ──────────────');
 *       console.log('Tipo:', event);
 *       console.log('Datos:', JSON.stringify(data, null, 2));
 *       console.log('────────────────────────────────────');
 *     });
 *   });
 * }
 *
 * // Usar la función helper
 * listenToAllEvents(kickWS);
 *
 * kickWS.connect('nombre-canal');
 * ```
 */
/**
 * Ejemplo 4: Uso con categorías de eventos
 * Example 4: Usage with event categories
 *
 * ```typescript
 * import { KickWebSocket, KickEvents, EventDataMap } from './websocket-lib';
 *
 * const kickWS = new KickWebSocket({ debug: true });
 *
 * // Eventos de chat
 * const chatEvents = [KickEvents.ChatMessage, KickEvents.MessageDeleted, KickEvents.PinnedMessageCreated];
 *
 * // Eventos de usuario (ban, suscripción, etc.)
 * const userEvents = [KickEvents.UserBanned, KickEvents.UserUnbanned, KickEvents.Subscription, KickEvents.GiftedSubscriptions];
 *
 * // Eventos de stream
 * const streamEvents = [KickEvents.StreamHost, KickEvents.PollUpdate, KickEvents.PollDelete];
 *
 * // Escuchar eventos de chat
 * chatEvents.forEach((event) => {
 *   kickWS.on(event, (data: EventDataMap[typeof event]) => {
 *     console.log(`[CHAT] ${event}:`, data);
 *   });
 * });
 *
 * // Escuchar eventos de usuario
 * userEvents.forEach((event) => {
 *   kickWS.on(event, (data: EventDataMap[typeof event]) => {
 *     console.log(`[USER] ${event}:`, data);
 *   });
 * });
 *
 * // Escuchar eventos de stream
 * streamEvents.forEach((event) => {
 *   kickWS.on(event, (data: EventDataMap[typeof event]) => {
 *     console.log(`[STREAM] ${event}:`, data);
 *   });
 * });
 *
 * kickWS.connect('nombre-canal');
 * ```
 */ 
