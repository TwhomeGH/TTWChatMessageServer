import type { KickEventType, KickEventData } from "./types.js";
export declare class MessageParser {
    /**
     * Parsea un mensaje raw del WebSocket y devuelve el evento procesado
     */
    static parseMessage(rawMessage: string): {
        type: KickEventType;
        data: KickEventData;
        legacyType?: string;
    } | null;
    /**
     * Parsea un evento de mensaje de chat
     */
    private static parseChatMessage;
    /**
     * Parsea un evento de mensaje eliminado
     */
    private static parseMessageDeleted;
    /**
     * Parsea un evento de usuario baneado
     */
    private static parseUserBanned;
    /**
     * Parsea un evento de usuario desbaneado
     */
    private static parseUserUnbanned;
    /**
     * Parsea un evento de suscripción
     */
    private static parseSubscription;
    /**
     * Parsea un evento de suscripciones regaladas
     */
    private static parseGiftedSubscriptions;
    /**
     * Parsea un evento de mensaje fijado
     */
    private static parsePinnedMessageCreated;
    /**
     * Parsea un evento de host de stream
     */
    private static parseStreamHost;
    /**
     * Parsea un evento de actualización de encuesta
     */
    private static parsePollUpdate;
    /**
     * Parsea un evento de eliminación de encuesta
     */
    private static parsePollDelete;
    /**
     * Parsea un evento de recompensa canjeada
     */
    private static parseRewardRedeemed;
    /**
     * Parsea un evento de Kicks regalados
     */
    private static parseKicksGifted;
    /**
     * Limpia los códigos de emote del contenido del mensaje
     */
    private static cleanEmotes;
    /**
     * Verifica si un mensaje es válido
     */
    static isValidMessage(message: string): boolean;
    /**
     * Extrae el tipo de evento de un mensaje raw
     */
    static extractEventType(rawMessage: string): string | null;
}
//# sourceMappingURL=MessageParser.d.ts.map