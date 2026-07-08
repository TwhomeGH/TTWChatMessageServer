import { initDirectSigner, directSign, closeDirectSigner } from './SignServer/direct-signer.mjs';

try {
    const ready = await initDirectSigner();
    if (!ready) {
        console.log('FAILED to init signer');
        process.exit(1);
    }

    const url = 'https://webcast.tiktok.com/webcast/im/fetch/?room_id=7659729173387660052&cursor=0&aid=1988';

    const result = await directSign(url);
    console.log('Sign result:', JSON.stringify(result));
} catch (e) {
    console.log('Error:', e.message);
    console.log('Stack:', e.stack?.substring(0, 500));
}

await closeDirectSigner();
