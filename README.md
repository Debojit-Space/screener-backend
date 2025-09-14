# Screener-backend Chat Service

A Node.js chat service that uses Pinecone for vector search and OpenAI for embeddings and LLM responses, deployable to Cloudflare Workers.

## Features

- `/chat` endpoint for natural language queries
- Pinecone vector search with configurable index
- OpenAI embeddings (text-embedding-3-small) and LLM integration
- Fully configurable via environment variables
- Local development support
- CORS enabled for frontend integration

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

#### For Local Development:
```bash
cp .env.example .env
# Edit .env with your actual API keys and configuration
```

#### For Cloudflare Deployment:
```bash
# Set secrets (sensitive data)
wrangler secret put OPENAI_API_KEY
wrangler secret put PINECONE_API_KEY
wrangler secret put PINECONE_INDEX_HOST

# Configuration is already in wrangler.toml [vars] section
```

### 3. Get Your Pinecone Index Host

1. Go to your Pinecone console
2. Select your "screener-queries" index
3. Copy the host URL (e.g., `{index_name}-abc123.svc.us-east1-aws.pinecone.io`)
4. Use this as your `PINECONE_INDEX_HOST`

## Development

### Local Testing
```bash
# Start local development server
npm run dev

# Test with curl
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "companies with mcap greater than 2000"}'
```

### Test Locally Without Network Calls
```bash
npm run test
```

## Deployment

### Deploy to Cloudflare Workers
```bash
# Deploy to production
npm run deploy

# Your service will be available at:
# https://cloudflare-rag-chat.<your-subdomain>.workers.dev
```

## API Usage

### POST /chat

**Request:**
```json
{
  "query": "Your question here"
}
```

**Response:**
```json
{
  "query": "Your question here",
  "response": "AI generated response based on context",
  "matches": 3,
  "timestamp": "2025-09-13T13:25:00.000Z"
}
```

### GET /

Health check endpoint that returns service status.

## Configuration Options

All configuration can be modified in `wrangler.toml` [vars] section:

- `PINECONE_INDEX_NAME`: Your Pinecone index name
- `EMBEDDING_MODEL`: OpenAI embedding model to use
- `LLM_MODEL`: OpenAI chat model for responses
- `EMBEDDING_DIMENSIONS`: Vector dimensions (512 for text-embedding-3-small)
- `TOP_K`: Number of similar documents to retrieve

## Project Structure

```
├── src/
│   └── index.ts          # Main application code
├── package.json          # Dependencies and scripts
├── wrangler.toml         # Cloudflare Workers configuration
├── tsconfig.json         # TypeScript configuration
├── .env.example          # Environment variables template
└── README.md            # This file
```

## Troubleshooting

1. **"Vector dimension does not match"**: Ensure your Pinecone index was created with 1536 dimensions to match text-embedding-3-small
2. **API key errors**: Double-check your OpenAI and Pinecone API keys are correct
3. **Index host issues**: Make sure you're using the full host URL from Pinecone console, not just the index name
4. **Local development**: Make sure your `.env` file exists and has all required variables

## Notes

- The service uses Hono framework for optimal Cloudflare Workers performance
- CORS is enabled for frontend integration
- All API calls use fetch API for compatibility with Workers runtime
- Error handling includes detailed error messages for debugging
