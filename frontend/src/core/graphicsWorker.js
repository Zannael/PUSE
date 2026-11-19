import { extractGraphics } from './graphicsCodec.js';
self.onmessage = async ({ data }) => {
    try {
        const pack = await extractGraphics(new Uint8Array(data.rom), data.profileId, progress => self.postMessage({ progress }));
        self.postMessage({ pack });
    } catch (error) { self.postMessage({ error: error.message }); }
};
