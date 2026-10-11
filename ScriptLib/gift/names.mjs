/**
 * 禮物名稱翻譯與快取（gift_map.json 對照表、gift_list.json 目錄）。
 * 以 createGiftNameStore 建立實例；檔案 I/O 與翻譯 API 皆注入，方便測試與重用。
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

    /** 載入完成（供呼叫端 await，避免在載入前就翻譯）。 */
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
