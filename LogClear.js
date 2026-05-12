const fs = require("fs");


/**
 * 用來清理 TikTokRun.log 中類似以下內容的日誌：
 * 2026/5/12 下午7:16:17 - DEBUG View:\n
 * [object Object]
 * @param {*} file 
 */
function extractObjectLogs(file = "TikTokRun.log") {
    var content = fs.readFileSync(file, "utf8");

    console.log("原始內容：");
    console.log(content);
    
    //清理類似內容的日誌
    //2026/5/12 下午7:16:17 - DEBUG View:
    //[object Object]

    // 抓出含有 DEBUG View: [object Object] 的區塊
    /// 同時匹配時間戳記 + DEBUG View 區塊
    const regex = /^\d{4}\/\d{1,2}\/\d{1,2}\s+(上午|下午)\d{1,2}:\d{2}:\d{2} - \s*DEBUG View:\s*\n\s*\[object Object\]\s\r?\n*/gm;

    const matches = content.match(regex);



  if (matches) {
    console.log("找到以下類似日誌：");
    console.log(matches.join("\n"));
    // 刪掉這些行
    content = content.replace(regex, "");

    console.log("已刪除這些日誌，新的內容如下：");
    console.log(content);

    fs.writeFileSync(file, content, "utf8");
    console.log("已將新的內容寫回文件。");

  } else {
    console.log("沒有找到符合的日誌");
  }
}

extractObjectLogs();
