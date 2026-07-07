import weaviate, { WeaviateClient } from "weaviate-client";

export const CHUNK_COLLECTION = "Chunk";

export type ChunkProperties = {
  content: string;
  title: string;
  documentId: string;
  sourceType: string;
  url: string;
  chunkIndex: number;
};

const globalForWeaviate = globalThis as unknown as {
  weaviateClient?: Promise<WeaviateClient>;
};

async function connect(): Promise<WeaviateClient> {
  const url = process.env.WEAVIATE_URL;
  const apiKey = process.env.WEAVIATE_API_KEY;
  if (!url || !apiKey) {
    throw new Error(
      "WEAVIATE_URL and WEAVIATE_API_KEY must be set in .env — create a free sandbox at console.weaviate.cloud"
    );
  }
  const client = await weaviate.connectToWeaviateCloud(url, {
    authCredentials: new weaviate.ApiKey(apiKey),
  });
  await ensureSchema(client);
  return client;
}

async function ensureSchema(client: WeaviateClient) {
  const exists = await client.collections.exists(CHUNK_COLLECTION);
  if (exists) return;
  await client.collections.create({
    name: CHUNK_COLLECTION,
    description: "Knowledge base document chunks",
    properties: [
      { name: "content", dataType: "text" },
      { name: "title", dataType: "text" },
      {
        name: "documentId",
        dataType: "text",
        skipVectorization: true,
        indexFilterable: true,
      },
      { name: "sourceType", dataType: "text", skipVectorization: true },
      { name: "url", dataType: "text", skipVectorization: true },
      { name: "chunkIndex", dataType: "int" },
    ],
    // Weaviate Cloud's built-in embedding service — no external embedding key needed
    vectorizers: weaviate.configure.vectors.text2VecWeaviate({
      sourceProperties: ["title", "content"],
    }),
  });
}

export async function getWeaviate(): Promise<WeaviateClient> {
  if (!globalForWeaviate.weaviateClient) {
    globalForWeaviate.weaviateClient = connect().catch((err) => {
      // Don't cache a failed connection
      globalForWeaviate.weaviateClient = undefined;
      throw err;
    });
  }
  return globalForWeaviate.weaviateClient;
}

export async function getChunkCollection() {
  const client = await getWeaviate();
  return client.collections.get<ChunkProperties>(CHUNK_COLLECTION);
}
