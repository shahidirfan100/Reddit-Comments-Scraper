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

        const postData = data[0].data.children[0];
        const postId = postData.data.name; // e.g., "t3_1pqgcx9"
        const subreddit = postData.data.subreddit;
        
        log.info(`Post ID: ${postId}, Subreddit: ${subreddit}`);

        const commentsListing = data[1]; // Comments are in the second element
        const comments = commentsListing.data.children;

        let totalExtracted = 0;
        const batch = [];
        const moreCommentIds = []; // Track "more" comment IDs for pagination

        // Helper function to push batch when it reaches 20 items
        async function pushBatch() {
            if (batch.length > 0) {
                await Dataset.pushData([...batch]);
                saved += batch.length;
                log.info(`Pushed batch of ${batch.length} comments (total saved: ${saved})`);
                batch.length = 0; // Clear batch
            }
        }

        // Extract comments recursively and collect "more" objects
        async function extractComments(commentsArray, parentId = null) {
            for (const comment of commentsArray) {
                if (saved >= RESULTS_WANTED) {
                    return; // Stop if we've reached the limit
                }

                if (comment.kind === 't1') { // t1 is comment
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

                    batch.push(commentData);
                    totalExtracted++;

                    // Push batch when it reaches 20
                    if (batch.length >= 20) {
                        await pushBatch();
                    }

                    // Process nested replies
                    if (data.replies && data.replies.data && data.replies.data.children) {
                        await extractComments(data.replies.data.children, data.id);
                    }
                } else if (comment.kind === 'more' && saved < RESULTS_WANTED) {
                    // Collect "more" comment IDs for pagination
                    const moreIds = comment.data.children || [];
                    moreCommentIds.push(...moreIds);
                }
            }
        }

        // Process initial comments
        await extractComments(comments);

        // Push any remaining comments in batch
        await pushBatch();

        log.info(`Initial extraction: ${totalExtracted} comments from main thread`);

        // Fetch additional comments if "more" IDs exist and we need more comments
        if (moreCommentIds.length > 0 && saved < RESULTS_WANTED) {
            log.info(`Found ${moreCommentIds.length} additional comment IDs to fetch`);
            
            // Reddit API limit: fetch up to 100 comment IDs per request
            const batchSize = 100;
            let fetchedFromMore = 0;
            
            for (let i = 0; i < moreCommentIds.length && saved < RESULTS_WANTED; i += batchSize) {
                const idBatch = moreCommentIds.slice(i, i + batchSize);
                const idsToFetch = idBatch.slice(0, Math.min(batchSize, RESULTS_WANTED - saved));
                
                if (idsToFetch.length === 0) break;
                
                log.info(`Fetching batch ${Math.floor(i / batchSize) + 1}: ${idsToFetch.length} comments...`);
                
                try {
                    // Use Reddit's morechildren API
                    const moreUrl = `https://www.reddit.com/api/morechildren.json?api_type=json&link_id=${postId}&children=${idsToFetch.join(',')}&limit_children=false`;
                    
                    let moreResponse;
                    for (let attempt = 1; attempt <= 3; attempt++) {
                        try {
                            moreResponse = await gotScraping(moreUrl, {
                                headers,
                                proxyUrl: proxyConf ? await proxyConf.newUrl() : undefined,
                                timeout: { request: 30000 },
                                http2: false,
                                retry: { limit: 0 },
                            });
                            break;
                        } catch (error) {
                            if (attempt === 3) throw error;
                            await new Promise(resolve => setTimeout(resolve, 2000));
                        }
                    }

                    const moreData = JSON.parse(moreResponse.body);
                    
                    if (moreData.json && moreData.json.data && moreData.json.data.things) {
                        const things = moreData.json.data.things;
                        
                        for (const thing of things) {
                            if (saved >= RESULTS_WANTED) break;
                            
                            if (thing.kind === 't1') {
                                const data = thing.data;
                                const commentData = {
                                    id: data.id,
                                    author: data.author,
                                    body: data.body,
                                    score: data.score,
                                    created_utc: data.created_utc,
                                    parent_id: data.parent_id,
                                    permalink: data.permalink,
                                };

                                batch.push(commentData);
                                totalExtracted++;
                                fetchedFromMore++;

                                // Push batch when it reaches 20
                                if (batch.length >= 20) {
                                    await pushBatch();
                                }
                            }
                        }
                    }
                    
                    // Rate limiting: wait between batches
                    if (i + batchSize < moreCommentIds.length && saved < RESULTS_WANTED) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                } catch (error) {
                    log.warning(`Failed to fetch more comments batch: ${error.message}`);
                }
            }
            
            // Push final batch
            await pushBatch();
            
            log.info(`Fetched ${fetchedFromMore} additional comments from "more" API`);
        }

        log.info(`Total extracted: ${totalExtracted} comments, saved: ${saved}`);
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