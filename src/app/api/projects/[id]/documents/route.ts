import { NextRequest } from "next/server";
import { linkDocuments, projectErrorResponse, unlinkDocument } from "@/lib/projectStore";

type Ctx = { params: Promise<{ id: string }> };

async function readDocumentId(req: NextRequest): Promise<string> {
  const body = (await req.json().catch(() => ({}))) as { documentId?: unknown };
  return typeof body.documentId === "string" ? body.documentId : "";
}

/** Link a knowledge base document to the project. body: { documentId } */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    await linkDocuments(id, [await readDocumentId(req)]);
    return Response.json({ ok: true });
  } catch (err) {
    return projectErrorResponse(err);
  }
}

/** Unlink a document. body: { documentId } */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    await unlinkDocument(id, await readDocumentId(req));
    return Response.json({ ok: true });
  } catch (err) {
    return projectErrorResponse(err);
  }
}
