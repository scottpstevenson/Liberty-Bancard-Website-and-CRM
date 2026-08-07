import type { Express, Request, Response } from "express";
import { openai } from "./client";
import { isAuthenticated } from "../auth";
import { checkAiGate, recordAiSpend } from "../../services/ai-audit-logger";

export function registerImageRoutes(app: Express): void {
  app.post("/api/generate-image", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { prompt, size = "1024x1024" } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const slot = await checkAiGate("gpt-image-1");
      let response;
      try {
        response = await openai.images.generate({
          model: "gpt-image-1",
          prompt,
          n: 1,
          size: size as "1024x1024" | "512x512" | "256x256",
        });
      } catch (providerErr) {
        slot.refund();
        throw providerErr;
      }

      const imageSizes: Record<string, number> = { "1024x1024": 4, "512x512": 2, "256x256": 1 };
      slot.settle(recordAiSpend("gpt-image-1", 0, 0, "content-generation", imageSizes[size] ?? 4));
      const imageData = response.data?.[0];
      res.json({
        url: imageData?.url,
        b64_json: imageData?.b64_json,
      });
    } catch (error) {
      console.error("Error generating image:", error);
      res.status(500).json({ error: "Failed to generate image" });
    }
  });
}

