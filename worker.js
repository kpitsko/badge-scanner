import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-4-5";

const SYSTEM_PROMPT = `You extract structured contact info from photos of conference attendee badges. The conference is CAI National 2026 (Community Associations Institute) — attendees include community managers, property managers, HOA board members, vendors, and service providers.

Return only the JSON. Use "" for any field not visible. Put certifications/designations (CMCA®, PCAM, AMS, LSM, etc.) in title, not lastName.`;

const SCHEMA = {
  type: "object",
  properties: {
    firstName: { type: "string", description: "Given name" },
    lastName: { type: "string", description: "Family name; no certifications" },
    email: { type: "string", description: "Email address if printed; '' otherwise" },
    company: { type: "string", description: "Company / organization / management firm" },
    title: { type: "string", description: "Job title; include certifications if any" },
  },
  required: ["firstName", "lastName", "email", "company", "title"],
  additionalProperties: false,
};

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "POST only" }, 405);
    }
    if (!env.ANTHROPIC_API_KEY) {
      return jsonResponse({ error: "Worker missing ANTHROPIC_API_KEY secret" }, 500);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Body must be JSON: {image, mediaType}" }, 400);
    }

    const { image, mediaType = "image/jpeg" } = body;
    if (!image || typeof image !== "string") {
      return jsonResponse({ error: "Missing 'image' base64 string" }, 400);
    }

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 400,
        output_config: {
          format: { type: "json_schema", schema: SCHEMA },
        },
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: image },
              },
              { type: "text", text: "Extract the badge fields as JSON." },
            ],
          },
        ],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      const text = textBlock?.text ?? "{}";
      return new Response(text, {
        headers: { ...CORS, "content-type": "application/json" },
      });
    } catch (err) {
      const status = err?.status ?? 502;
      const msg = err?.message ?? String(err);
      console.error("OCR error", status, msg);
      return jsonResponse({ error: msg }, status >= 400 && status < 600 ? status : 502);
    }
  },
};
