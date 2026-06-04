export declare enum KickEvent {
    ChatMessage = "App\\Events\\ChatMessageEvent",
    MessageDeleted = "App\\Events\\MessageDeletedEvent",
    UserBanned = "App\\Events\\UserBannedEvent",
    UserUnbanned = "App\\Events\\UserUnbannedEvent",
    Subscription = "App\\Events\\SubscriptionEvent",
    GiftedSubscriptions = "App\\Events\\GiftedSubscriptionsEvent",
    PinnedMessageCreated = "App\\Events\\PinnedMessageCreatedEvent",
    StreamHost = "App\\Events\\StreamHostEvent",
    PollUpdate = "App\\Events\\PollUpdateEvent",
    PollDelete = "App\\Events\\PollDeleteEvent",
    RewardRedeemed = "RewardRedeemedEvent",
    KicksGifted = "KicksGifted"
}
export declare enum KickEvents {
    ChatMessage = "ChatMessage",
    MessageDeleted = "MessageDeleted",
    UserBanned = "UserBanned",
    UserUnbanned = "UserUnbanned",
    Subscription = "Subscription",
    GiftedSubscriptions = "GiftedSubscriptions",
    PinnedMessageCreated = "PinnedMessageCreated",
    StreamHost = "StreamHost",
    PollUpdate = "PollUpdate",
    PollDelete = "PollDelete",
    RewardRedeemed = "RewardRedeemed",
    KicksGifted = "KicksGifted",
    PointsUpdated = "PointsUpdated",
    SubscriptionSucceeded = "pusher_internal:subscription_succeeded",
    Ready = "ready",
    Disconnect = "disconnect",
    Error = "error",
    RawMessage = "rawMessage"
}
export declare const LEGACY_EVENT_MAPPING: Record<string, string>;
export interface KickMessage {
    id: string;
    content: string;
    type: "message";
    created_at: string;
    sender: {
        id: number;
        username: string;
        slug: string;
        identity: {
            color: string;
            badges: string[];
        };
    };
    chatroom: {
        id: number;
        channel_id: number;
    };
}
export interface KickUser {
    id: number;
    username: string;
    slug: string;
    identity: {
        color: string;
        badges: string[];
    };
}
export interface KickChannel {
    id: number;
    slug: string;
    user: {
        username: string;
    };
    chatroom: {
        id: number;
    };
}
export interface ChatMessageEvent {
    id: string;
    content: string;
    type: "message";
    created_at: string;
    sender: KickUser;
    chatroom: {
        id: number;
    };
}
export interface MessageDeletedEvent {
    message_id: string;
    chatroom_id: number;
    type: "message_deleted";
}
export interface UserBannedEvent {
    username: string;
    type: "user_banned";
}
export interface UserUnbannedEvent {
    username: string;
    type: "user_unbanned";
}
export interface SubscriptionEvent {
    username: string;
    type: "subscription";
}
export interface GiftedSubscriptionsEvent {
    gifted_by: string;
    recipients: string[];
    type: "gifted_subscriptions";
}
export interface PinnedMessageCreatedEvent {
    message: ChatMessageEvent;
    type: "pinned_message_created";
}
export interface StreamHostEvent {
    hoster: string;
    hosted_channel: string;
    type: "stream_host";
}
export interface PollUpdateEvent {
    poll_id: string;
    question: string;
    options: Array<{
        id: string;
        text: string;
        votes: number;
    }>;
    type: "poll_update";
}
export interface PollDeleteEvent {
    poll_id: string;
    type: "poll_delete";
}
export interface RewardRedeemedEvent {
    reward_title: string;
    user_id: number;
    channel_id: number;
    username: string;
    user_input: string;
    reward_background_color: string;
    type: "reward_redeemed";
}
export interface KicksGiftedEvent {
    gift_transaction_id: string;
    message: string;
    sender: {
        id: number;
        username: string;
        username_color: string;
    };
    gift: {
        gift_id: string;
        name: string;
        amount: number;
        type: string;
        tier: string;
        character_limit: number;
        pinned_time: number;
    };
    type: "kicks_gifted";
}
export interface PointsUpdatedEvent {
    reason: string;
    points: number;
    balance: number;
    user_id: number;
    channel_id: number;
    type: "points_updated";
}
export interface SubscriptionSucceededEvent {
    channel: string;
    type: "subscription_succeeded";
}
export declare const KICK_EVENTS: readonly ["ChatMessage", "MessageDeleted", "UserBanned", "UserUnbanned", "Subscription", "GiftedSubscriptions", "PinnedMessageCreated", "StreamHost", "PollUpdate", "PollDelete", "RewardRedeemed", "KicksGifted", "PointsUpdated", "ready", "disconnect", "error", "rawMessage", "subscriptionSucceeded"];
export type KickEventType = (typeof KICK_EVENTS)[number];
export interface EventDataMap {
    ChatMessage: ChatMessageEvent;
    MessageDeleted: MessageDeletedEvent;
    UserBanned: UserBannedEvent;
    UserUnbanned: UserUnbannedEvent;
    Subscription: SubscriptionEvent;
    GiftedSubscriptions: GiftedSubscriptionsEvent;
    PinnedMessageCreated: PinnedMessageCreatedEvent;
    StreamHost: StreamHostEvent;
    PollUpdate: PollUpdateEvent;
    PollDelete: PollDeleteEvent;
    RewardRedeemed: RewardRedeemedEvent;
    KicksGifted: KicksGiftedEvent;
    PointsUpdated: PointsUpdatedEvent;
    subscriptionSucceeded: SubscriptionSucceededEvent;
    ready: {
        channel: string;
    };
    disconnect: {
        reason?: string;
    };
    error: Error;
    rawMessage: string;
}
export type KickEventData = ChatMessageEvent | MessageDeletedEvent | UserBannedEvent | UserUnbannedEvent | SubscriptionEvent | GiftedSubscriptionsEvent | PinnedMessageCreatedEvent | StreamHostEvent | PollUpdateEvent | PollDeleteEvent | RewardRedeemedEvent | KicksGiftedEvent | PointsUpdatedEvent | SubscriptionSucceededEvent | {
    channel: string;
} | {
    reason?: string;
} | Error | string;
export interface KickWebSocketOptions {
    debug?: boolean;
    autoReconnect?: boolean;
    reconnectInterval?: number;
    connectionTimeout?: number;
    filteredEvents?: KickEventType[];
}
export interface WebSocketMessage {
    event: string;
    data: string;
    channel?: string;
}
export type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting" | "error";
export type EventHandler<T = unknown> = (data: T) => void;
export interface IKickWebSocket {
    connect(channelName: string): Promise<void>;
    disconnect(): void;
    on<T = KickEventData>(event: KickEventType, handler: EventHandler<T>): void;
    off<T = KickEventData>(event: KickEventType, handler: EventHandler<T>): void;
    isConnected(): boolean;
    getConnectionState(): ConnectionState;
}
export interface RawChatMessageData {
    id: string;
    content: string;
    created_at: string;
    sender: {
        id: number;
        username: string;
        slug: string;
        identity?: {
            color?: string;
            badges?: string[];
        };
    };
    chatroom?: {
        id: number;
    };
}
export interface RawMessageDeletedData {
    message_id: string;
    chatroom_id: number;
}
export interface RawUserBannedData {
    username?: string;
    banned_username?: string;
}
export interface RawUserUnbannedData {
    username?: string;
    unbanned_username?: string;
}
export interface RawSubscriptionData {
    username?: string;
    user?: {
        username: string;
    };
}
export interface RawGiftedSubscriptionsData {
    gifted_by?: string;
    gifter?: {
        username: string;
    };
    recipients?: Array<string | {
        username: string;
    }>;
}
export interface RawPinnedMessageCreatedData {
    message: RawChatMessageData;
}
export interface RawStreamHostData {
    hoster?: string | {
        username: string;
    };
    hosted_channel?: string | {
        username: string;
    };
}
export interface RawPollUpdateData {
    id: string;
    question: string;
    options?: Array<{
        id: string;
        text: string;
        votes?: number;
    }>;
}
export interface RawPollDeleteData {
    id: string;
}
export interface RawRewardRedeemedData {
    reward_title: string;
    user_id: number;
    channel_id: number;
    username: string;
    user_input: string;
    reward_background_color: string;
}
export interface RawKicksGiftedData {
    gift_transaction_id: string;
    message: string;
    sender: {
        id: number;
        username: string;
        username_color: string;
    };
    gift: {
        gift_id: string;
        name: string;
        amount: number;
        type: string;
        tier: string;
        character_limit: number;
        pinned_time: number;
    };
}
export interface SubscriptionMessage {
    event: string;
    data?: {
        auth?: string;
        channel?: string;
    };
}
export interface WebSocketConfig {
    url?: string;
    params?: Record<string, string>;
}
export interface ExtendedKickWebSocketOptions extends KickWebSocketOptions {
    websocketConfig?: WebSocketConfig;
    customSubscriptions?: string[];
    subscriptionMessages?: SubscriptionMessage[];
}
//# sourceMappingURL=types.d.ts.map