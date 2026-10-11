/**
 * 禮物名稱翻譯與快取（gift_map.json 對照表、gift_list.json 目錄）。
 *
 * 以 {@link createGiftNameStore} 建立實例；檔案 I/O 與翻譯 API 皆注入，方便測試與重用。
 */

/**
 * @typedef {Object} GiftNameStoreDeps
 * @property {import('node:fs').promises} fs 檔案 I/O（promises 版）。
 * @property {{get: Function}} axios 翻譯 API 用戶端。
 * @property {string} translateApiUrl 翻譯 API 網址。
 * @property {string} sourceLang 來源語言。
 * @property {string} targetLang 目標語言。
 * @property {number} [prefillLimit=10] 目錄回填時一次自動翻譯的上限。
 * @property {string} giftMapFile gift_map.json 路徑。
 * @property {string} giftMapExampleFile gift_map.example.json 路徑。
 * @property {string} giftListFile gift_list.json 路徑。
 * @property {Console} [logger=console] 記錄器。
 */

/**
 * @typedef {Object} GiftNameStore
 * @property {Promise<void>} ready 初始載入完成（呼叫端可 await，避免載入前就翻譯）。
 * @property {(giftName: string) => string} getTranslatedGiftNameFromMap 由對照表取得翻譯（未命中會登記為空）。
 * @property {(giftName: string) => Promise<string>} ensureGiftNameTranslation 取得或即時翻譯一個禮物名稱。
 * @property {(giftList: Array<Object>) => Promise<void>} syncGiftMapFromGiftList 把目錄中未見過的禮物加入對照表。
 * @property {(giftList: Array<Object>) => Promise<void>} backfillGiftTranslationsFromGiftList 回填目錄中尚未翻譯的名稱（受 prefillLimit 限制）。
 * @property {(giftList: Array<Object>) => Promise<void>} saveGiftCatalog 將禮物目錄寫入 gift_list.json（附目前翻譯）。
 */

/**
 * 建立禮物名稱對照表。
 * @param {GiftNameStoreDeps} deps
 * @returns {GiftNameStore}
 */
export function createGiftNameStore({
    fs,
    axios,
    translateApiUrl,
    sourceLang,
    targetLang,
    prefillLimit = 10,
    giftMapFile,
    giftMapExampleFile,
    giftListFile,
    logger = console
}) {
    let giftNameMap = {};
    const missingGiftNames = new Set();
    const pendingGiftTranslations = new Map();

    /**
     * 把目前對照表排序後寫回 gift_map.json。
     * @returns {Promise<void>}
     */
    async function saveGiftNameMap() {
        try {
            const sortedMap = Object.fromEntries(
                Object.entries(giftNameMap).sort(([a], [b]) => a.localeCompare(b))
            );
            await fs.writeFile(giftMapFile, JSON.stringify(sortedMap, null, 4), "utf-8");
        } catch (err) {
            logger.error("❌ 儲存 gift_map.json 失敗:", err);
        }
    }

    /**
     * 由對照表取得翻譯。未見過的名稱會登記為空字串並存檔（等待 ensure 補翻譯）。
     * @param {string} giftName
     * @returns {string} 翻譯後名稱；尚無翻譯時回傳空字串。
     */
    function getTranslatedGiftNameFromMap(giftName) {
        if (!giftName || typeof giftName !== 'string') {
            return giftName;
        }

        const translatedName = giftNameMap[giftName];
        if (typeof translatedName === 'string' && translatedName.trim().length > 0) {
            return translatedName;
        }

        if (!Object.prototype.hasOwnProperty.call(giftNameMap, giftName)) {
            giftNameMap[giftName] = "";
            if (!missingGiftNames.has(giftName)) {
                missingGiftNames.add(giftName);
                saveGiftNameMap();
                logger.log(`📝 發現未翻譯禮物: ${giftName}，已加入 gift_map.json`);
            }
        }

        return "";
    }

    /**
     * 呼叫翻譯 API 翻譯單一禮物名稱。
     * @param {string} giftName
     * @returns {Promise<string>} 翻譯結果；無有效翻譯時回傳空字串。
     */
    async function translateGiftNameByApi(giftName) {
        try {
            const response = await axios.get(translateApiUrl, {
                params: {
                    q: giftName,
                    langpair: `${sourceLang}|${targetLang}`
                },
                timeout: 10000
            });

            const translatedText = response?.data?.responseData?.translatedText?.trim();
            if (!translatedText || translatedText.toLowerCase() === giftName.toLowerCase()) {
                return "";
            }

            logger.log(`🌐 禮物翻譯成功: ${giftName} -> ${translatedText}`);
            return translatedText;
        } catch (err) {
            logger.error(`❌ 禮物翻譯失敗 (${giftName}):`, err.message);
            return "";
        }
    }

    /**
     * 取得或即時翻譯一個禮物名稱；相同名稱的並行請求會共用同一個 Promise。
     * @param {string} giftName
     * @returns {Promise<string>} 翻譯後名稱；翻譯不到時回傳原名。
     */
    async function ensureGiftNameTranslation(giftName) {
        if (!giftName || typeof giftName !== 'string') {
            return giftName;
        }

        const translatedName = getTranslatedGiftNameFromMap(giftName);
        if (translatedName) {
            return translatedName;
        }

        if (pendingGiftTranslations.has(giftName)) {
            return pendingGiftTranslations.get(giftName);
        }

        const translationPromise = (async () => {
            if (!Object.prototype.hasOwnProperty.call(giftNameMap, giftName)) {
                giftNameMap[giftName] = "";
                if (!missingGiftNames.has(giftName)) {
                    missingGiftNames.add(giftName);
                    await saveGiftNameMap();
                    logger.log(`📝 發現未翻譯禮物: ${giftName}，已加入 gift_map.json`);
                }
            }

            const translatedByApi = await translateGiftNameByApi(giftName);
            if (translatedByApi) {
                giftNameMap[giftName] = translatedByApi;
                await saveGiftNameMap();
                return translatedByApi;
            }

            return giftName;
        })();

        pendingGiftTranslations.set(giftName, translationPromise);

        try {
            return await translationPromise;
        } finally {
            pendingGiftTranslations.delete(giftName);
        }
    }

    /**
     * 將禮物目錄寫入 gift_list.json，附上目前對照表的翻譯。
     * @param {Array<{id: (string|number), name: string, diamond_count: (string|number)}>} giftList
     * @returns {Promise<void>}
     */
    async function saveGiftCatalog(giftList) {
        try {
            const normalizedGiftList = giftList.map(gift => ({
                id: gift.id,
                name: gift.name,
                diamond_count: gift.diamond_count,
                translatedName: giftNameMap[gift.name] || ""
            }));

            await fs.writeFile(giftListFile, JSON.stringify(normalizedGiftList, null, 4), "utf-8");
            logger.log(`✅ 已儲存 gift_list.json，共 ${normalizedGiftList.length} 筆禮物資料`);
        } catch (err) {
            logger.error("❌ 儲存 gift_list.json 失敗:", err);
        }
    }

    /**
     * 把目錄中尚未見過的禮物名稱加入對照表（空字串，待後續翻譯）。
     * @param {Array<Object>} giftList
     * @returns {Promise<void>}
     */
    async function syncGiftMapFromGiftList(giftList) {
        let hasNewGift = false;

        for (const gift of giftList) {
            if (!gift?.name) {
                continue;
            }

            if (!Object.prototype.hasOwnProperty.call(giftNameMap, gift.name)) {
                giftNameMap[gift.name] = "";
                hasNewGift = true;
            }
        }

        if (hasNewGift) {
            await saveGiftNameMap();
            logger.log("📝 已將 giftList 中尚未翻譯的禮物加入 gift_map.json");
        }
    }

    /**
     * 回填目錄中尚未翻譯的名稱，一次最多 prefillLimit 個以避免打爆翻譯 API。
     * @param {Array<Object>} giftList
     * @returns {Promise<void>}
     */
    async function backfillGiftTranslationsFromGiftList(giftList) {
        const unresolvedGiftNames = giftList
            .map(gift => gift?.name)
            .filter(name => name && !getTranslatedGiftNameFromMap(name));

        const namesToTranslate = unresolvedGiftNames.slice(0, Math.max(0, prefillLimit));
        if (namesToTranslate.length === 0) {
            return;
        }

        logger.log(`🌐 準備自動翻譯 ${namesToTranslate.length} 個禮物名稱`);

        for (const giftName of namesToTranslate) {
            await ensureGiftNameTranslation(giftName);
        }
    }

    /**
     * 載入 gift_map.json；不存在時依序以 gift_map.example.json 或空表初始化。
     * @returns {Promise<void>}
     */
    async function loadGiftNameMap() {
        try {
            const raw = await fs.readFile(giftMapFile, "utf-8");
            giftNameMap = JSON.parse(raw);
            logger.log(`✅ 載入 ${Object.keys(giftNameMap).length} 筆 gift_map 對應`);
        } catch (err) {
            if (err.code === 'ENOENT') {
                try {
                    giftNameMap = JSON.parse(await fs.readFile(giftMapExampleFile, "utf-8"));
                    await saveGiftNameMap();
                    logger.log(`⚠️ gift_map.json 不存在，已由 gift_map.example.json 初始化 ${Object.keys(giftNameMap).length} 筆對應`);
                } catch {
                    giftNameMap = {};
                    await saveGiftNameMap();
                    logger.log("⚠️ gift_map.json 與 gift_map.example.json 皆不存在，已初始化空對照表");
                }
            } else {
                logger.error("❌ 載入 gift_map.json 失敗:", err);
                giftNameMap = {};
            }
        }
    }

    /** @type {Promise<void>} 初始載入完成。 */
    const ready = loadGiftNameMap();

    return {
        ready,
        getTranslatedGiftNameFromMap,
        ensureGiftNameTranslation,
        syncGiftMapFromGiftList,
        backfillGiftTranslationsFromGiftList,
        saveGiftCatalog
    };
}
