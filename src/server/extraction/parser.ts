import { load } from "cheerio";
import { z } from "zod";
import { genreFromText, isGenre } from "../../lib/places/genres";

export const factsSchema = z.object({ name: z.string().trim().min(1).max(120), address: z.string().trim().min(8).max(300), genre: z.custom<import("../../lib/places/genres").Genre>(isGenre).nullable().optional() }).strict();
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
    const cuisine = [node.servesCuisine].flat().map(clean).join("、");
    const genre = genreFromText(cuisine) ?? (types.includes("CafeOrCoffeeShop") ? "cafe" : types.includes("Bakery") ? "bakery" : null);
    const key = `${compact(result.data.name)}|${compact(result.data.address)}`;
    const previous = candidates.get(key);
    candidates.set(key, { ...result.data, ...(genre ? { genre } : previous?.genre ? { genre: previous.genre } : {}) });
  }
  // Never choose the first branch from a page containing several restaurants.
  return !incomplete && candidates.size === 1 ? [...candidates.values()][0] : null;
}

// 店舗情報欄の短い分類だけを読む。本文・口コミ・関連記事は分類根拠にしない。
export function cuisineLabels(html: string): string[] {
  const $ = load(html);
  $("script, style, nav, aside, footer, [hidden], [aria-hidden='true'], [itemprop='review'], .rvw-item, .rvw-item__rvw-comment").remove();
  const values: string[] = [];
  $("[itemprop='servesCuisine']").each((_, el) => { values.push($(el).attr("content") ?? $(el).text()); });
  $("th, dt").each((_, el) => {
    if (/^(ジャンル|料理ジャンル|料理のジャンル|料理|料理種別|料理の種類|cuisine|cuisines)$/i.test($(el).text().trim())) values.push($(el).next("td, dd").text());
  });
  return [...new Set(values.map(value => value.replace(/\s+/g, " ").trim()).filter(value => value && value.length <= 100))];
}

export function enrichGenre(facts: PlaceFacts, html: string): PlaceFacts {
  const labels = cuisineLabels(html).map(genreFromText).filter(Boolean);
  const unique = [...new Set(labels)];
  const title = load(html)("head > title").first().text().trim();
  const titleGenre = title.length < 300 && compact(title).includes(compact(facts.name)) ? genreFromText(title) : null;
  const genre = facts.genre ?? (unique.length === 1 ? unique[0] : null) ?? titleGenre ?? genreFromText(facts.name);
  return { ...facts, ...(genre ? { genre } : {}) };
}

export type ExtractionReason = "unsupported" | "not_found" | "fetch_failed";
export type ExtractionResult = { facts: PlaceFacts; method: "json-ld-v1" } | { facts: null; reason: ExtractionReason };

// ページに埋め込まれた構造化データだけを読む。特定できなければ推測せず手入力に任せる。
export function analyzePage(html: string): ExtractionResult {
  const facts = extractJsonLd(html);
  return facts ? { facts: enrichGenre(facts, html), method: "json-ld-v1" } : { facts: null, reason: "not_found" };
}
