import https from "node:https";

// GRT's server uses a small DH key that Node rejects by default
// This agent lowers the security level for GRT requests only
const agent = new https.Agent({
    ciphers: "DEFAULT@SECLEVEL=1",
    keepAlive: true,
});

export function fetchBuffer(url: string, timeoutMs = 15_000): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {agent, timeout: timeoutMs}, (res) => {
            if(res.statusCode !== 200) {
                res.resume();
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            const chuncks: Buffer[] =[]
            res.on("data", (c: Buffer) => chuncks.push(c));
            res.on("end", () => resolve(new Uint8Array(Buffer.concat(chuncks))));
        });
        req.on("timeout", () => req.destroy(new Error("Request timed out")));
        req.on("error", reject);
    });
}