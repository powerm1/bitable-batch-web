export default async function handler(request, response) {
  // Handle CORS
  response.setHeader('Access-Control-Allow-Credentials', true);
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  response.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (request.method === 'OPTIONS') {
    response.status(200).end();
    return;
  }

  // Target base URL for Feishu Open API
  const targetBase = 'https://open.feishu.cn';
  
  // Parse incoming URL
  // Vercel might strip the rewrite prefix, but to be safe we extract the intended path.
  // We expect requests like /api/proxy/open-apis/bitable/v1/... or /api/proxy/bitable/v1/...
  // The frontend BitableClient appends path to proxyUrl.
  // If proxyUrl is '/api/proxy', axios sends '/api/proxy/open-apis/...' or '/api/proxy/bitable/...'
  // Original script uses BASE_URL = "https://open.feishu.cn/open-apis"
  // So client requests: [Proxy] + "/open-apis/..." ??
  // Let's check bitable.ts:
  // BASE_URL = "https://open.feishu.cn/open-apis";
  // getUrl returns proxyUrl + BASE_URL + endpoint
  // So if proxyUrl is /api/proxy, url is /api/proxyhttps://open.feishu.cn/open-apis/...
  // Wait, BitableClient.ts: `return ${this.config.proxyUrl}${target}`;`
  // If proxyUrl is "/api/proxy/", then url is "/api/proxy/https://open.feishu.cn/open-apis/..."
  // My local_proxy.py handled full URL in path? No, local_proxy.py: `target_url = f"{TARGET_BASE}{self.path}"`
  // where TARGET_BASE = "https://open.feishu.cn".
  // So local proxy expects path to start with /open-apis/... 
  // Let's adjust bitable.ts to NOT prepend https://open.feishu.cn if proxy is set? 
  // OR make the proxy handle the full URL if passed.
  
  // Actually, BitableClient.ts logic:
  // target = "https://open.feishu.cn/open-apis" + endpoint
  // url = proxyUrl + target
  // If proxyUrl="http://localhost:8080/", url="http://localhost:8080/https://open.feishu.cn/open-apis/..."
  // BUT local_proxy.py logic: `target_url = f"{TARGET_BASE}{self.path}"`
  // It IGNORES the path parts that look like a URL scheme if the client sends them?
  // No, standard http.server path is just the path part.
  // If axios sends "http://localhost:8080/https://open.feishu.cn/..."
  // The path received by python is "/https://open.feishu.cn/..."
  // Python script joins "https://open.feishu.cn" + "/https://open.feishu.cn/..." -> Wrong!
  
  // Wait, the previous user test with local proxy worked.
  // Let's re-read BitableClient.ts logic.
  // `const target = ${BASE_URL}${endpoint};` -> target = "https://open.feishu.cn/open-apis/..."
  // `return ${this.config.proxyUrl}${target}`;`
  // If proxyUrl is empty, returns target.
  // If proxyUrl is "http://localhost:8080", returns "http://localhost:8080https://open.feishu.cn/..." -> This is invalid URL!
  // Axios/Browser might fix it? No.
  // Unless proxyUrl ends with / and user input "http://localhost:8080/"?
  // "http://localhost:8080/https://open.feishu.cn/..."
  
  // Ah, the Python proxy I wrote earlier:
  // `target_url = f"{TARGET_BASE}{self.path}"`
  // If request is `/open-apis/bitable...` it works.
  // But if request path is `/https://open.feishu.cn...` it fails.
  
  // Check ConfigPanel placeholder: "https://cors-anywhere.herokuapp.com/"
  // Cors-anywhere expects the target URL appended.
  // So: https://cors-anywhere.herokuapp.com/https://open.feishu.cn/open-apis/... works.
  
  // My local_proxy.py logic:
  // `target_url = f"{TARGET_BASE}{self.path}"`
  // `TARGET_BASE = "https://open.feishu.cn"`
  // If `self.path` is `/open-apis/bitable/v1...`, result is `https://open.feishu.cn/open-apis/bitable/v1...`. Correct.
  
  // So if using local_proxy, the frontend MUST NOT include "https://open.feishu.cn" in the path sent to proxy?
  // But BitableClient currently DOES include it.
  // `const target = ${BASE_URL}${endpoint};` (BASE_URL includes https://...)
  
  // Conclusion: The current BitableClient implementation is compatible with cors-anywhere, 
  // BUT incompatible with my local_proxy.py UNLESS local_proxy.py strips the protocol.
  // Re-reading local_proxy.py source from history...
  // `target_url = f"{TARGET_BASE}{self.path}"`
  // If frontend sends `http://localhost:8080/https://open.feishu.cn/open-apis/...`
  // `self.path` is `/https://open.feishu.cn/open-apis/...`
  // `target_url` becomes `https://open.feishu.cn/https://open.feishu.cn/open-apis/...` -> 404/Error.
  
  // The user said "Connection reset" or "Timeout" earlier, maybe it never worked with my python script properly?
  // Or maybe I should fix BitableClient logic to support both.
  
  // FOR VERCEL PROXY:
  // I will make the Vercel proxy smart. It should look for `/open-apis/` in the path.
  // If the path contains `https://open.feishu.cn`, strip it.
  
  const urlObj = new URL(request.url, `http://${request.headers.host}`);
  let path = urlObj.pathname.replace(/^\/api\/proxy/, ''); // Strip own prefix
  
  // Handle cors-anywhere style (full url in path)
  // e.g. /https://open.feishu.cn/open-apis/...
  if (path.includes('open.feishu.cn')) {
     const match = path.match(/open\.feishu\.cn(.*)/);
     if (match) {
         path = match[1];
     }
  }
  
  // Ensure target starts with /open-apis/
  // The endpoint passed from BitableClient is usually `/auth/...` or `/bitable/...`.
  // Wait, BitableClient.ts: `BASE_URL = "https://open.feishu.cn/open-apis"`
  // `endpoint` starts with `/` (e.g. `/auth/v3...`).
  // So full URL is `https://open.feishu.cn/open-apis/auth/v3...`
  
  // If the proxy receives `/open-apis/...`, we can append to `https://open.feishu.cn`.
  
  const finalUrl = 'https://open.feishu.cn' + path + urlObj.search;

  try {
    const body = request.body && Object.keys(request.body).length > 0 ? JSON.stringify(request.body) : null;
    
    const res = await fetch(finalUrl, {
      method: request.method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': request.headers.authorization || '',
      },
      body: body,
    });

    const data = await res.text();
    response.status(res.status).send(data);
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
}
