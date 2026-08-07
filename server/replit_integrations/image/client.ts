import fs from "node:fs";
import OpenAI, { toFile } from "openai";
import { Buffer } from "node:buffer";

export const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

async function getImageAiGate() {
  const { checkAiGate, recordAiSpend } = await import("../../services/ai-audit-logger");
  return { checkAiGate, recordAiSpend };
}

/**
 * Generate an image and return as Buffer.
 * Uses gpt-image-1 model via Replit AI Integrations.
 */
export async function generateImageBuffer(
  prompt: string,
  size: "1024x1024" | "512x512" | "256x256" = "1024x1024"
): Promise<Buffer> {
  const { checkAiGate, recordAiSpend } = await getImageAiGate();
  const slot = await checkAiGate("gpt-image-1");
  let response;
  try {
    response = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size,
    });
  } catch (err) {
    slot.refund();
    throw err;
  }
  const imgSizeCosts: Record<string, number> = { "1024x1024": 4, "512x512": 2, "256x256": 1 };
  slot.settle(recordAiSpend("gpt-image-1", 0, 0, "content-generation", imgSizeCosts[size] ?? 4));
  const base64 = response.data?.[0]?.b64_json ?? "";
  return Buffer.from(base64, "base64");
}

/**
 * Edit/combine multiple images into a composite.
 * Uses gpt-image-1 model via Replit AI Integrations.
 */
export async function editImages(
  imageFiles: string[],
  prompt: string,
  outputPath?: string
): Promise<Buffer> {
  const images = await Promise.all(
    imageFiles.map((file) =>
      toFile(fs.createReadStream(file), file, {
        type: "image/png",
      })
    )
  );

  const { checkAiGate, recordAiSpend } = await getImageAiGate();
  const slot = await checkAiGate("gpt-image-1");
  let response;
  try {
    response = await openai.images.edit({
      model: "gpt-image-1",
      image: images,
      prompt,
    });
  } catch (err) {
    slot.refund();
    throw err;
  }
  slot.settle(recordAiSpend("gpt-image-1", 0, 0, "content-generation", 4)); // default 1024x1024 cost
  const imageBase64 = response.data?.[0]?.b64_json ?? "";
  const imageBytes = Buffer.from(imageBase64, "base64");

  if (outputPath) {
    fs.writeFileSync(outputPath, imageBytes);
  }

  return imageBytes;
}

