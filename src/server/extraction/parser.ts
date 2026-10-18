import { load } from "cheerio";
import { z } from "zod";

export const factsSchema = z.object({ name: z.string().trim().min(1).max(120), address: z.string().trim().min(8).max(300) }).strict();
export type PlaceFacts = z.infer<typeof factsSchema>;
export const compact = (text: string) => text.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
type Node = Record<string, unknown>;
const object = (value: unknown): value is Node => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clean = (value: unknown) => typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

// Arrays, @graph and linked PostalAddress nodes are common across publishers.
export function extractJsonLd(html: string): PlaceFacts | null {
  const $ = load(html), nodes: Node[] = [];
  $("script[type='application/ld+json']").each((_, script) => {
    try {
      const stack: { value: unknown; depth: number }[] = [{ value: JSON.parse($(script).text()), depth: 0 }];
      while (stack.length && nodes.length < 10_000) {
        const { value, depth } = stack.pop()!;
        if (depth > 30) continue;
        if (Array.isArray(value)) stack.push(...value.slice(0, 1000).map(value => ({ value, depth: depth + 1 })));
        else if (object(value)) {
          nodes.push(value);
          for (const child of Object.values(value)) if (child && typeof child === "object") stack.push({ value: child, depth: depth + 1 });
        }
      }
    } catch { /* A malformed script must not hide a valid subsequent script. */ }
  });
  const byId = new Map(nodes.filter(node => typeof node["@id"] === "string" && Object.keys(node).length > 1).map(node => [node["@id"], node]));
  const candidates = new Map<string, PlaceFacts>();
  let incomplete = false;
  for (const node of nodes) {
    const types = [node["@type"]].flat().map(type => clean(type).replace(/^https?:\/\/schema.org\//, ""));
    if (!types.some(type => ["Restaurant", "CafeOrCoffeeShop", "FoodEstablishment", "Bakery", "FastFoodRestaurant", "IceCreamShop"].includes(type))) continue;
    let address = node.address;
    if (object(address) && address["@id"] && byId.has(address["@id"])) address = byId.get(address["@id"]);
    let addressText = clean(address);
    if (object(address)) {
      const region = clean(address.addressRegion), locality = clean(address.addressLocality), street = clean(address.streetAddress);
      addressText = street && (region || locality) ? [region, locality, street].filter(Boolean).join("") : "";
    }
    const result = factsSchema.safeParse({ name: clean(node.name), address: addressText });
    if (!result.success) { incomplete = true; continue; }
    candidates.set(`${compact(result.data.name)}|${compact(result.data.address)}`, result.data);
  }
  // Never choose the first branch from a page containing several restaurants.
  return !incomplete && candidates.size === 1 ? [...candidates.values()][0] : null;
}

const aiFactsSchema = z.object({
  unique: z.boolean(), name: z.string().nullable(), address: z.string().nullable(),
  nameEvidence: z.string().max(500).nullable(), addressEvidence: z.string().max(700).nullable(),
}).strict();

export function validateAiFacts(value: unknown, pageText: string): PlaceFacts | null {
  const result = aiFactsSchema.safeParse(value);
  if (!result.success || !result.data.unique) return null;
  const facts = factsSchema.safeParse({ name: result.data.name, address: result.data.address });
  if (!facts.success) return null;
  const text = compact(pageText);
  for (const field of ["name", "address"] as const) {
    const evidence = result.data[`${field}Evidence`];
    if (!evidence || !text.includes(compact(evidence)) || !compact(evidence).includes(compact(facts.data[field]))) return null;
  }
  return facts.data;
}

export type ExtractionReason = "unsupported" | "not_found" | "ai_unavailable" | "ai_limit";
export type ExtractionResult = { facts: PlaceFacts; method: "json-ld-v1" | "gemini-text-v1" } | { facts: null; reason: ExtractionReason };
export type AiExtractor = (text: string) => Promise<PlaceFacts | null>;
export class AiUnavailableError extends Error {}
export class AiLimitError extends Error {}

export async function analyzePage(html: string, aiText: (html: string) => string, infer: AiExtractor): Promise<ExtractionResult> {
  const facts = extractJsonLd(html);
  if (facts) return { facts, method: "json-ld-v1" };
  const text = aiText(html);
  // Reject oversized text instead of truncating away another branch/address.
  if (!text.trim() || text.length > 6000 || Buffer.byteLength(text, "utf8") > 12_000) return { facts: null, reason: "not_found" };
  try {
    const facts = await infer(text);
    return facts ? { facts, method: "gemini-text-v1" } : { facts: null, reason: "not_found" };
  } catch (error) {
    if (error instanceof AiLimitError) return { facts: null, reason: "ai_limit" };
    if (error instanceof AiUnavailableError) return { facts: null, reason: "ai_unavailable" };
    throw error;
  }
}
