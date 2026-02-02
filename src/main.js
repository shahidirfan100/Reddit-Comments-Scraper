// Reddit Comments Scraper - JSON API implementation
import { Actor, log } from 'apify';
import { Dataset } from 'crawlee';
import { gotScraping } from 'got-scraping';
import { HeaderGenerator } from 'header-generator';

// Single-entrypoint main
await Actor.init();

async function main() {
    try {
        const input = (await Actor.getInput()) || {};

        // Fallback to reading INPUT.json directly for local testing
        if (!input.startUrl) {
            try {
                const fs = await import('fs');
                const inputPath = './INPUT.json';
                if (fs.existsSync(inputPath)) {
                    const inputData = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
                    Object.assign(input, inputData);
                }
            } catch (err) {
                log.error('Could not load INPUT.json:', err.message);
            }
        }
        const {
            startUrl,
            results_wanted: RESULTS_WANTED_RAW = 20,
            proxyConfiguration,
        } = input;

        const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : Number.MAX_SAFE_INTEGER;

        if (!startUrl) {
            throw new Error('startUrl is required');
        }

        const jsonUrl = startUrl.endsWith('/') ? startUrl + '.json' : startUrl + '/.json';
        log.info(`Fetching from: ${jsonUrl}`);

        const proxyConf = proxyConfiguration ? await Actor.createProxyConfiguration({ ...proxyConfiguration }) : undefined;
        if (proxyConf) {
            log.info('Using Apify Proxy');
        } else {
            log.info('Running without proxy');
        }

        let saved = 0;

        const headerGenerator = new HeaderGenerator({
            browsers: [
                { name: 'chrome', minVersion: 120, maxVersion: 130 },
            ],
            devices: ['desktop'],
            operatingSystems: ['windows'],
            locales: ['en-US'],
        });

        // Use simple headers that work well with Reddit's JSON API
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json,text/plain,*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
        };

        // Fetch the JSON directly with retry logic
        log.info('Starting fetch request...');
        let response;
        let lastError;
        
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                log.info(`Fetch attempt ${attempt}/3...`);
                response = await gotScraping(jsonUrl, {
                    headers,
                    proxyUrl: proxyConf ? await proxyConf.newUrl() : undefined,
                    timeout: {
                        request: 30000, // 30 seconds total timeout
                    },
                    http2: false, // Disable HTTP/2 to avoid protocol errors with proxies
                    retry: {
                        limit: 0, // We handle retries manually
                    },
                });
                log.info(`Fetch successful, status: ${response.statusCode}`);
                break; // Success, exit retry loop
            } catch (error) {
                lastError = error;
                log.warning(`Fetch attempt ${attempt} failed: ${error.message}`);
                if (attempt < 3) {
                    const delay = attempt * 2000; // 2s, 4s
                    log.info(`Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        
        if (!response) {
            throw new Error(`Failed to fetch after 3 attempts: ${lastError.message}`);
        }

        if (response.statusCode !== 200) {
            throw new Error(`Failed to fetch Reddit data: HTTP ${response.statusCode}`);
        }

        const data = JSON.parse(response.body);
        log.info(`Parsed JSON, found ${data.length} top-level items`);

        if (!Array.isArray(data) || data.length < 2) {
            throw new Error('Invalid Reddit JSON response');
        }

        const commentsListing = data[1]; // Comments are in the second element
        const comments = commentsListing.data.children;

        const flattenedComments = [];

        function extractComments(commentsArray, parentId = null) {
            for (const comment of commentsArray) {
                if (comment.kind !== 't1') continue; // t1 is comment

                const data = comment.data;
                const commentData = {
                    id: data.id,
                    author: data.author,
                    body: data.body,
                    score: data.score,
                    created_utc: data.created_utc,
                    parent_id: parentId,
                    permalink: data.permalink,
                };

                flattenedComments.push(commentData);

                if (data.replies && data.replies.data && data.replies.data.children) {
                    extractComments(data.replies.data.children, data.id);
                }
            }
        }

        extractComments(comments);

        const toSave = flattenedComments.slice(0, RESULTS_WANTED);
        await Dataset.pushData(toSave);
        saved = toSave.length;

        log.info(`Extracted ${flattenedComments.length} comments, saved ${saved}`);
    } catch (error) {
        log.error(`Error during scraping: ${error.message}`);
        log.error(error.stack);
        throw error;
    } finally {
        await Actor.exit();
    }
}

main().catch(err => { 
    log.error('Fatal error in main():', err.message);
    console.error(err); 
    process.exit(1); 
});