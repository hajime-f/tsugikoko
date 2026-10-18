import { load } from "cheerio";
import { analyzePage, cuisineLabels, type AiExtractor, type ExtractionResult } from "./parser";
import { normalizePlaceUrl } from "../../lib/places/schema";

export type ExtractionSource = {
  url: string; reviewDate: string; policyUrl: string; version: string;
  aiScope: string; basis: string; kind: "official" | "page";
};
export const reviewedSources: ExtractionSource[] = [{
  url: "https://www.tabisurucafe.com/bistro-franky-hotel",
  reviewDate: "2026-10-18",
  policyUrl: "https://www.tabisurucafe.com/general-5",
  version: "json-ld-ai-v1",
  kind: "official",
  aiScope: "ページタイトル・所在地を記載した連絡先段落・料理ジャンル欄のみ。紹介文・画像・口コミ・利用者情報は外部AIへ送信しない。",
  basis: "公式店舗ページと公開方針を確認。創作的な紹介文・画像を除き、店名・所在地・料理ジャンルの事実のみ。明示的なライセンス取得ではなく、個別の事実情報の利用として採用。",
}];
// 試作として両サイトを有効化するユーザーの明示的指示による設定。
// サイト運営者の許諾を取得済みという意味ではない。
export function reviewedSource(value: string): ExtractionSource | undefined {
  let url: string;
  try { url = normalizePlaceUrl(value); } catch { return; }
  const fixed = reviewedSources.find(source => source.url === url);
  if (fixed) return fixed;
  const parsed = new URL(url);
  const tabelog = parsed.hostname === "tabelog.com" && /^\/\w+\/A\d+\/A\d+\/\d{8}\/$/.test(parsed.pathname);
  const ikyu = parsed.hostname === "restaurant.ikyu.com" && /^\/\d{6}$/.test(parsed.pathname);
  if (!tabelog && !ikyu) return;
  return {
    url, kind: "page", reviewDate: "2026-10-18", version: "trial-json-ld-ai-v1",
    policyUrl: tabelog ? "https://tabelog.com/help/rules/" : "https://restaurant.ikyu.com/rsMirror/rsMirrorTerms.asp",
    aiScope: "店舗名・所在地・料理ジャンルの候補を含むページタイトル・見出し・店舗情報欄。画像・口コミは送らない。",
    basis: "ユーザーが試作での取得・保存を明示的に指示。運営者の許諾は未取得。停止要請時には対象から外す。",
  };
}

export function officialAiText(html: string) {
  const $ = load(html);
  const title = $("head > title").first().text().trim();
  $("script, style, noscript, [hidden], [aria-hidden='true']").remove();
  const contacts = [...new Set($("p").toArray().map(p => $(p).text().trim()).filter(value => /^\d{3}-\d{4}\s+東京都渋谷区/.test(value)))];
  return contacts.length ? [title, ...contacts, ...cuisineLabels(html).map(value => `料理ジャンル: ${value}`)].join("\n") : "";
}

export function pageAiText(html: string) {
  const $ = load(html);
  const title = $("head > title").first().text().trim();
  const description = $("meta[name='description'], meta[property='og:description']").first().attr("content") ?? "";
  // 所在地がfooterにだけ載る公式サイトもあるため、footer自体は除去しない。
  $("script, style, noscript, svg, iframe, nav, form, [hidden], [aria-hidden='true'], [itemprop='review'], .rvw-item, .rvw-item__rvw-comment").remove();
  $("br").replaceWith("\n");
  const headings = $("h1").toArray().map(el => $(el).text().trim()).filter(t => t && t.length < 200);
  const addressPattern = /^(?:住所|所在地)?\s*[:：]?\s*(?:〒\s*)?(?:\d{3}[-ー]\d{4}\s*)?(?:東京都|北海道|大阪府|京都府|.{2,3}県|[^\s]{1,10}[市区郡]).{0,60}\d/;
  const candidates = $("p, dd, address, td, div, span, li").toArray()
    .flatMap(el => $(el).text().split(/\r?\n/).map(t => t.replace(/\s+/g, " ").trim()))
    .filter(text => text.length < 500 && addressPattern.test(text));
  // 住所内のspanで分割された都道府県や建物名を落とさない。
  const unique = [...new Set(candidates)];
  const addresses = unique.filter(text => !unique.some(other => other !== text && other.includes(text)));
  // SNSプロフィール等では所在地が公開メタ情報にだけ存在することがある。
  const metaAddresses = description.split(/\r?\n/).map(t => t.trim()).filter(t => t.length < 500 && addressPattern.test(t));
  const text = [...new Set([title, ...headings, ...addresses, ...metaAddresses, ...cuisineLabels(html).map(value => `料理ジャンル: ${value}`)].filter(Boolean))].join("\n");
  return addresses.length || metaAddresses.length ? text : "";
}

export async function fetchPageFacts(url: string, infer: AiExtractor, fetcher: typeof fetch = fetch, configuredSource?: ExtractionSource): Promise<ExtractionResult> {
  const source = configuredSource ?? reviewedSource(url);
  if (!source) return { facts: null, reason: "unsupported" };
  if (normalizePlaceUrl(url) !== source.url || !source.url.startsWith("https://")) throw new Error("Source mismatch");
  // コードまたは管理者専用設定で指定した公開ページのみ。リダイレクト・画像は取得しない。
  const response = await fetcher(source.url, {
    redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(8000),
    headers: { "User-Agent": "Tsugikoko/0.1 (+https://tsugikoko--tsugikoko.asia-east1.hosted.app)", Accept: "text/html" },
  });
  const contentType = response.headers.get("content-type") ?? "";
  // 原因の切り分け用。URLや本文はエラーに含めない。
  if (!response.ok || !contentType.includes("text/html") || !response.body) throw new Error(`Source unavailable: HTTP ${response.status} ${contentType.split(";")[0] || "-"}`);
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 1_500_000) { await reader.cancel(); throw new Error("Source too large"); }
    chunks.push(value);
  }
  return analyzePage(Buffer.concat(chunks).toString("utf8"), source.kind === "official" ? officialAiText : pageAiText, infer);
}
