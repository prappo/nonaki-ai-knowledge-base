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

/** "cloud" (default) — Weaviate Cloud with its built-in embedding service.
 *  "local" — a self-hosted Weaviate + text2vec-transformers, e.g. via docker-compose. */
function weaviateMode(): "cloud" | "local" {
  return process.env.WEAVIATE_MODE === "local" ? "local" : "cloud";
}

async function connect(): Promise<WeaviateClient> {
  const client =
    weaviateMode() === "local" ? await connectLocal() : await connectCloud();
  await ensureSchema(client);
  return client;
}

async function connectCloud(): Promise<WeaviateClient> {
  const url = process.env.WEAVIATE_URL;
  const apiKey = process.env.WEAVIATE_API_KEY;
  if (!url || !apiKey) {
    throw new Error(
      "WEAVIATE_URL and WEAVIATE_API_KEY must be set in .env — create a free sandbox at console.weaviate.cloud"
    );
  }
  return weaviate.connectToWeaviateCloud(url, {
    authCredentials: new weaviate.ApiKey(apiKey),
  });
}

async function connectLocal(): Promise<WeaviateClient> {
  const host = process.env.WEAVIATE_HOST || "localhost";
  const port = Number(process.env.WEAVIATE_PORT || 8080);
  const grpcPort = Number(process.env.WEAVIATE_GRPC_PORT || 50051);
  return weaviate.connectToCustom({
    httpHost: host,
    httpPort: port,
    httpSecure: false,
    grpcHost: host,
    grpcPort,
    grpcSecure: false,
  });
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
    // Cloud: Weaviate Cloud's built-in embedding service, no external key needed.
    // Local: the self-hosted text2vec-transformers module (see docker-compose.yml).
    vectorizers:
      weaviateMode() === "local"
        ? weaviate.configure.vectors.text2VecTransformers({
            sourceProperties: ["title", "content"],
          })
        : weaviate.configure.vectors.text2VecWeaviate({
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

/** Drop every chunk by deleting and recreating the collection (full data purge). */
export async function resetChunkCollection(): Promise<void> {
  const client = await getWeaviate();
  if (await client.collections.exists(CHUNK_COLLECTION)) {
    await client.collections.delete(CHUNK_COLLECTION);
  }
  await ensureSchema(client);
}
