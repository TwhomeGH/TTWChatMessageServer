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
//# sourceMappingURL=types.js.map