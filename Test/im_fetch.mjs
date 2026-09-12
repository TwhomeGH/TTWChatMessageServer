import { WebSocketConfigDefaults, getWebSocketConfigDefaults } from 'tiktok-live-connector';
import { getRandomPresets } from 'tiktok-live-connector';
import axios from 'axios';

const presets = getRandomPresets();
const wsConfig = getWebSocketConfigDefaults(presets);
const params = {
    ...wsConfig.DEFAULT_WS_CLIENT_PARAMS,
    room_id: "7659729173387660052",
    cursor: "0",
    internal_ext: "",
};
const url = "wss://webcast-ws.tiktok.com/webcast/im/ws_proxy/ws_reuse_supplement/?" +
    new URLSearchParams(params).toString() +
    wsConfig.DEFAULT_WS_CLIENT_PARAMS_APPEND_PARAMETER;
console.log("Final URL length:", url.length);
console.log("Params count:", Object.keys(params).length);
// Print first 500
console.log(url.substring(0, 500));
