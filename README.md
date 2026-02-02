# Reddit Comments Scraper

Scrape all comments from any Reddit post using the official Reddit JSON API. Extract structured comment data including author, body, score, timestamps, and nested replies.

## Features

- Extracts all comments and nested replies from Reddit posts
- Uses official Reddit JSON API for reliable data access
- Handles comment threading and parent-child relationships
- Includes comment scores, timestamps, and permalinks
- Lightweight HTTP-based scraping with no browser required

## Use Cases

- Social media analysis and sentiment tracking
- Community discussion monitoring
- Content moderation and spam detection
- Research on user engagement patterns
- Data collection for NLP and machine learning projects

## Input Parameters

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `startUrl` | string | The URL of the Reddit post to scrape comments from | Required |
| `results_wanted` | integer | Maximum number of comments to collect | 100 |
| `proxyConfiguration` | object | Proxy settings for reliable scraping | Residential proxy |

## Output Data

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique comment identifier |
| `author` | string | Reddit username of the commenter |
| `body` | string | Full text content of the comment |
| `score` | number | Upvote score of the comment |
| `created_utc` | number | Unix timestamp of comment creation |
| `parent_id` | string | ID of parent comment (null for top-level) |
| `permalink` | string | Direct link to the comment |

## Usage Examples

### Basic Usage
```json
{
  "startUrl": "https://www.reddit.com/r/webscraping/comments/1qs66k0/couldnt_find_proxy_directory_with_filters_so/"
}
```

### With Custom Limits
```json
{
  "startUrl": "https://www.reddit.com/r/webscraping/comments/1qs66k0/couldnt_find_proxy_directory_with_filters_so/",
  "results_wanted": 50
}
```

## Sample Output

```json
{
  "id": "abc123",
  "author": "webscraper_pro",
  "body": "Great discussion on proxy configurations!",
  "score": 15,
  "created_utc": 1703123456,
  "parent_id": null,
  "permalink": "/r/webscraping/comments/1qs66k0/couldnt_find_proxy_directory_with_filters_so/abc123/"
}
```

## Tips

- Use residential proxies for best results with Reddit
- Comments are returned in chronological order
- Nested replies are flattened with parent_id references
- Large threads may have thousands of comments

## Integrations

- Export data to CSV/JSON for analysis
- Connect with data processing pipelines
- Integrate with NLP tools for sentiment analysis
- Use with business intelligence platforms

## FAQ

**Q: Does this work with private subreddits?**  
A: No, this scraper only works with public Reddit posts.

**Q: Are deleted comments included?**  
A: Deleted comments are not returned by the Reddit API.

**Q: What's the rate limit?**  
A: Reddit API has rate limits; use proxies and reasonable delays.

## Legal Notice

This scraper is for educational and research purposes only. Respect Reddit's Terms of Service and robots.txt. Do not use for spam, harassment, or unauthorized data collection. Ensure compliance with local laws and regulations.