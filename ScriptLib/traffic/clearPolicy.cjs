/** 清理預覽與刪除共用身份、來源及格式驗證。 */
function clearAccess(req,authorized) {
 if(!authorized)return 401;
 const origin=(req.socket?.encrypted?'https://':'http://')+req.headers.host;
 if(req.headers.origin!==origin || !req.headers['content-type']?.startsWith('application/json'))return 403;
 return 0;
}
module.exports={clearAccess};
