import axios from 'axios';

import { config } from 'dotenv';
import { franc,francAll} from 'franc';

import {iso6393, iso6393To1, iso6393To2B, iso6393To2T} from 'iso-639-3'

import langs from "langs";


config()

function parseBool(val, defaultValue = false) {
    if (!val) return defaultValue;
    return val.toLowerCase() === "true";
}

const TRANSLATE_DEBUG = parseBool(process.env.TRANSLATE_DEBUG) || false

const TRANSLATE_API_URL = process.env.TRANSLATE_API_URL || "https://api.mymemory.translated.net/get";
const TRANSLATE_SOURCE_LANG = process.env.TRANSLATE_SOURCE_LANG || "en";
const TRANSLATE_TARGET_LANG = process.env.TRANSLATE_TARGET_LANG || "zh-TW";

const TRANSLATE_MIN_LENGTH = process.env.TRANSLATE_MIN_LENGTH || 5;

const BING_TRANSLATE_API_KEY = process.env.BING_TRANSLATE_API_KEY || '';
const GOOGLE_TRANSLATE_API_KEY = process.env.GOOGLE_TRANSLATE_API_KEY || '';


/**
 * @brief 判斷是否中文franc 回傳 cmn 表示中文普通話
    
 * @param {*} text
 * @return {*} langISO6393語言代碼 lang對應代碼 isChinese是中文嗎
 *  */




// 補釘表：專門處理 franc 常見代碼
const francFixMap = {
    cmn: "zh-TW", // Mandarin Chinese
    yue: "zh-HANT", // Cantonese
    nan: "zh-CN", // Min Nan
    wuu: "zh-CN", // Wu Chinese
};


function self_logTo(...DATA){

    if (TRANSLATE_DEBUG){
        console.log("[翻譯API]",...DATA)
    }
}

function iso6393To1Code(code3 )  {
    return iso6393To1[code3] || francFixMap[code3] ||  null;
}



function detectLanguage(text)  {
    // 先檢查是否純英文 (只含 A-Z, a-z, 空白)
    if (/^[A-Za-z\s]+$/.test(text)) {
        return "en";
    }

    // 檢查是否包含日文假名 (平假名 + 片假名)
    if (/[\u3040-\u30FF\uFF66-\uFF9F]/.test(text)) {
        return "ja";
    }

    // 檢查是否包含中文 (漢字範圍)
    if (/[\u4e00-\u9fff]/.test(text)) {
        return "zh-CN";
    }

    // 其他情況交給 franc 偵測
    const res = franc(text, { minLength: text.length });
    let RES393 = iso6393To1Code(res)
    return RES393 || "en"; // und = undefined
}


function isChinese(text) {
    let RES = detectLanguage(text)
    
    self_logTo("ISO",RES)
    self_logTo("Detect Language:",RES,text, )


    return {

        "langISO6393":RES,
        "lang":RES,
        "isChinese":RES === "cmn" || String(RES).startsWith("zh")
    };

}


/**
 * 
 * @param Chat 要翻譯的訊息
 * @returns 
 */
async function translateByMyMemory(Chat, sourceLang) {
    const resp = await axios.get(TRANSLATE_API_URL, {
        params: { q: Chat, langpair: `${sourceLang}|${TRANSLATE_TARGET_LANG}` },
        timeout: 10000
    });
    return resp?.data?.responseData?.translatedText?.trim() || null;
}

async function translateByGoogle(Chat) {
    const resp = await axios.get("https://translate.googleapis.com/translate_a/single", {
        params: { client: "gtx", sl: "auto", tl: TRANSLATE_TARGET_LANG, dt: "t", q: Chat },
        timeout: 10000
    });
    if (resp?.data?.[0]?.[0]?.[0]) {
        return resp.data[0][0][0].trim();
    }
    return null;
}

async function translateByBing(Chat, sourceLang) {
    if (!BING_TRANSLATE_API_KEY) return null;
    const resp = await axios.post(
        `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=${sourceLang}&to=${TRANSLATE_TARGET_LANG}`,
        [{ Text: Chat }],
        {
            headers: {
                'Ocp-Apim-Subscription-Key': BING_TRANSLATE_API_KEY,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        }
    );
    return resp?.data?.[0]?.translations?.[0]?.text?.trim() || null;
}

async function translateByApi(Chat) {
    if (Chat.length < TRANSLATE_MIN_LENGTH) {
        console.log(`太短了取消翻譯 < ${TRANSLATE_MIN_LENGTH}`)
        return Chat
    }
    let CheckLang = isChinese(Chat)

    self_logTo("LangISO6393",CheckLang.langISO6393,"LangCode",CheckLang.lang)

    if (CheckLang.isChinese) {
        self_logTo(`${Chat} -> 這已經是中文`)
        return Chat;
    }

    const apis = [
        { name: "MyMemory", fn: () => translateByMyMemory(Chat, CheckLang.lang) },
        { name: "Google", fn: () => translateByGoogle(Chat) },
    ];

    if (BING_TRANSLATE_API_KEY) {
        apis.push({ name: "Bing", fn: () => translateByBing(Chat, CheckLang.lang) });
    }

    for (const api of apis) {
        try {
            const result = await api.fn();
            if (result && result.toLowerCase() !== Chat.toLowerCase()) {
                self_logTo(`🌐 ${api.name} 翻譯成功: ${Chat} -> ${result}`);
                return result;
            }
            if (result) {
                self_logTo(`${api.name} 回傳相同內容，嘗試下一個`);
            }
        } catch (err) {
            self_logTo(`${api.name} 翻譯失敗: ${err.message}`);
        }
    }

    self_logTo(`❌ 所有翻譯API皆無法翻譯: ${Chat}`);
    return Chat;
}

async function TranslateText(params="TEST") {
    let RES = await translateByApi(params)
    return RES
}


export default {
    isChinese,
    TranslateText,
    translateByApi,
    detectLanguage
}