import { Hono } from 'hono'
import { cors } from 'hono/cors'

// System prompt defined as a constant
const SYSTEM_PROMPT = `You are a strict financial domain expert. Answer only from context. If the answer is not in the provided data, say 'Not found in data.' Give concise, professional explanations. Do not hallucinate. You are supposed to convert human text into screener query. (screener.in)
Follow this instructions strictly
1. You need to use only the metric name provided inside quotes " ", DONT USE the aliases as well.
2. Dont use any random name or create on your own, if u dont find any relevant metric name, dont include it in the query but never create ur own metric name.
3. Dont use " " in any metric while forming query, like "pat" < 30 should not be written, rather pat < 30 is right
Some examples for your reference:
1. if I say "Companies whose mcap is greater than 2000 and pat more than 20"
                
your answer will be
                
"Market Capitalization > 2000 AND
Profit after tax > 20"
                `

type Bindings = {
  // API Keys (secrets)
  OPENAI_API_KEY: string
  PINECONE_API_KEY: string
  PINECONE_INDEX_HOST: string
  
  // Configuration (vars)
  PINECONE_INDEX_NAME: string
  EMBEDDING_MODEL: string
  LLM_MODEL: string
  EMBEDDING_DIMENSIONS: string
  TOP_K: string
  CLOUDFLARE_GATEWAY_URL: string
}

interface PineconeMatch {
  id: string
  score: number
  metadata?: Record<string, any>
}

interface PineconeResponse {
  matches?: PineconeMatch[]
}

interface OpenAIEmbeddingResponse {
  data: Array<{
    embedding: number[]
  }>
}

interface OpenAIChatResponse {
  choices: Array<{
    message: {
      content: string
    }
  }>
}

const app = new Hono<{ Bindings: Bindings }>()

// Enable CORS for local testing
app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// Health check endpoint
app.get('/', (c) => {
  return c.json({ 
    message: 'RAG Chat Service is running',
    timestamp: new Date().toISOString()
  })
})

// Main chat endpoint
app.post('/chat', async (c) => {
  try {
    const body = await c.req.json()
    const { query } = body

    if (!query || typeof query !== 'string') {
      return c.json({ error: 'Query is required and must be a string' }, 400)
    }

    console.log(`Processing query: ${query}`)

    // Validate environment variables
    if (!c.env.OPENAI_API_KEY) {
      return c.json({ error: 'OpenAI API key not configured' }, 500)
    }

    // Step 1: Generate embedding for the query
    console.log('Generating embedding...')
    const embedding = await generateEmbedding(query, c.env)
    
    if (!embedding || embedding.length === 0) {
      throw new Error('Failed to generate embedding')
    }
    
    // Step 2: Search Pinecone for relevant context
    console.log('Searching Pinecone...')
    const searchResults: PineconeResponse = await searchPinecone(embedding, c.env)
    
    // Step 3: Generate response using LLM with context
    console.log('Generating response...')
    const response = await generateResponse(query, searchResults, c.env)

    return c.json({
      query: query,
      response: response,
      matches: searchResults.matches?.length || 0,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('Error processing chat request:', error)
    return c.json({ 
      error: 'Internal server error', 
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500)
  }
})

// Generate embedding using OpenAI
async function generateEmbedding(text: string, env: Bindings): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    throw new Error('Text input is required for embedding generation')
  }

  const dimensions = parseInt(env.EMBEDDING_DIMENSIONS) || 512
  const model = env.EMBEDDING_MODEL || 'text-embedding-3-small'

  console.log(`Generating embedding with model: ${model}, dimensions: ${dimensions}`)

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model,
      input: text,
      dimensions: dimensions
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`OpenAI embedding API error: ${response.status} - ${errorText}`)
    throw new Error(`OpenAI embedding failed: ${response.status} - ${errorText}`)
  }

  const data = await response.json() as OpenAIEmbeddingResponse
  
  if (!data.data || !data.data[0] || !data.data[0].embedding) {
    throw new Error('Invalid embedding response from OpenAI')
  }

  console.log(`Generated embedding with ${data.data[0].embedding.length} dimensions`)
  return data.data[0].embedding
}

// Search Pinecone index
async function searchPinecone(embedding: number[], env: Bindings): Promise<PineconeResponse> {
  // Validate required environment variables
  if (!env.PINECONE_API_KEY) {
    throw new Error('PINECONE_API_KEY is not configured')
  }
  if (!env.PINECONE_INDEX_HOST) {
    throw new Error('PINECONE_INDEX_HOST is not configured')
  }
  if (!env.PINECONE_INDEX_NAME) {
    throw new Error('PINECONE_INDEX_NAME is not configured')
  }

  const topK = parseInt(env.TOP_K) || 5
  
  console.log(`Searching Pinecone index: ${env.PINECONE_INDEX_NAME}`)
  console.log(`TopK: ${topK}, Embedding dimensions: ${embedding.length}`)

  const requestBody = {
    vector: embedding,
    topK: topK,
    includeMetadata: true,
    includeValues: false
  }

  const response = await fetch(`${env.PINECONE_INDEX_HOST}/query`, {
    method: 'POST',
    headers: {
      'Api-Key': env.PINECONE_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Pinecone API error: ${response.status} - ${errorText}`)
    throw new Error(`Pinecone search failed: ${response.status} - ${errorText}`)
  }

  const result = await response.json() as PineconeResponse
  //console.log('Pinecone search result:', JSON.stringify(result, null, 2))
  
  console.log(`Pinecone search completed. Found ${result.matches?.length || 0} matches`)
  return result
}

// Generate response using LLM
async function generateResponse(query: string, searchResults: PineconeResponse, env: Bindings): Promise<string> {
  // Build context from search results
  const contexts = searchResults.matches?.map((match: PineconeMatch, index: number) => {
    const metadata = match.metadata || {}
    
    // Use document_content field specifically
    const text = metadata.document_content || `Match ${index + 1} (no document_content found)`
    
    const score = match.score ? ` (relevance: ${match.score.toFixed(3)})` : ''
    
    return `${text}${score}`
  }) || []
  
  //console.log('System prompt:', JSON.stringify(SYSTEM_PROMPT, null, 2))
  const contextString = contexts.length > 0 
    ? contexts.join('\n\n---\n\n')
    : 'No relevant context found.'
  
  //console.log('Final context string length:', contextString.length)
  //console.log('Context preview:', contextString.substring(0, 500) + '...')
  const messages = [
    {
      role: 'system',
      content: SYSTEM_PROMPT
    },
    {
      role: 'user',
      content: `Context:\n${contextString}\n\nQuestion: ${query}\n\nAnswer:`
    }
  ]

  const gatewayUrl = env.CLOUDFLARE_GATEWAY_URL || 'https://gateway.ai.cloudflare.com/v1/9e20a2d23e8227768214ace8238988ed/screener-rag/openai'
  
  const response = await fetch(`${gatewayUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.LLM_MODEL,
      messages: messages,
      max_tokens: 1000,
      temperature: 0.0
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI chat completion failed: ${response.status} - ${errorText}`)
  }

  const data = await response.json() as OpenAIChatResponse
  return data.choices[0]?.message?.content || 'No response generated'
}

export default app