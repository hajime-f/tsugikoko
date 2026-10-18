import { BlockList, isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { analyzePage, type ExtractionResult } from "./parser";
import { normalizePlaceUrl } from "../../lib/places/schema";

export const EXTRACTION_VERSION = "json-ld-v2";
const USER_AGENT = "Tsugikoko/0.1 (+https://tsugikoko.com)";
const ROBOTS_AGENT = "tsugikoko";
const MAX_PAGE_BYTES = 1_500_000, MAX_ROBOTS_BYTES = 500_000, TIMEOUT_MS = 8000;

// アクセスの拒否や利用規約上の制限を確認したサイト。URLの保存と元ページへのリンクだけを行う。
export const excludedHosts = [
  "tabelog.com", "ikyu.com", "gnavi.co.jp", "hotpepper.jp", "retty.me",
  "instagram.com", "x.com", "twitter.com", "facebook.com", "tiktok.com", "youtube.com",
  "google.com", "google.co.jp", "goo.gl",
];
const excluded = (host: string) => excludedHosts.some(domain => host === domain || host.endsWith(`.${domain}`));

export type ExtractionTarget = { url: string; version: string };

// 自動入力を試すURL。除外サイト・不正なURLはundefined。
export function extractionTarget(value: string): ExtractionTarget | undefined {
  let url: string;
  try { url = normalizePlaceUrl(value); } catch { return; }
  return excluded(new URL(url).hostname) ? undefined : { url, version: EXTRACTION_VERSION };
}

// ローカル・内部ネットワーク・予約済みのアドレスへは接続しない。
const blocked = new BlockList();
for (const [network, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3]] as const) blocked.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [["::", 127], ["64:ff9b::", 96], ["100::", 64], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) blocked.addSubnet(network, prefix, "ipv6");
export function isPublicAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  if (family !== 6) return false;
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? !blocked.check(mapped[1], "ipv4") : !blocked.check(address, "ipv6");
}

export type FetchedPage = { status: number; contentType: string; body: string };
export type PageFetcher = (url: string, accept: string, maxBytes: number) => Promise<FetchedPage>;

// 名前解決したアドレスを検証してから、そのアドレスへ接続する。リダイレクトは追跡しない。
export const safeFetch: PageFetcher = async (url, accept, maxBytes) => {
  const target = new URL(url);
  const addresses = await lookup(target.hostname, { all: true });
  if (!addresses.length || !addresses.every(entry => isPublicAddress(entry.address))) throw new Error("Source address not allowed");
  const [address] = addresses;
  const request = target.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise<FetchedPage>((resolve, reject) => {
    const req = request(target, {
      method: "GET", timeout: TIMEOUT_MS,
      headers: { "User-Agent": USER_AGENT, Accept: accept, "Accept-Encoding": "identity" },
      lookup: (_host, options, callback) => {
        if ((options as { all?: boolean }).all) (callback as (error: null, addresses: { address: string; family: number }[]) => void)(null, [address]);
        else callback(null, address.address, address.family);
      },
    }, (response: IncomingMessage) => {
      const status = response.statusCode ?? 0, contentType = String(response.headers["content-type"] ?? "");
      if (status < 200 || status >= 300) { response.resume(); resolve({ status, contentType, body: "" }); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > maxBytes) { req.destroy(new Error("Source too large")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ status, contentType, body: decode(Buffer.concat(chunks), contentType) }));
      response.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("Source timeout")));
    req.on("error", reject);
    req.end();
  });
};

function decode(body: Buffer, contentType: string) {
  const charset = contentType.match(/charset=["']?([\w-]+)/i)?.[1] ?? "utf-8";
  try { return new TextDecoder(charset).decode(body); }
  catch { return new TextDecoder("utf-8").decode(body); }
}

// robots.txt（RFC 9309）のうち、Tsugikoko向けまたは全体向けのAllow/Disallowだけを解釈する。
export function robotsAllows(robots: string, path: string) {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let current: (typeof groups)[number] | null = null, lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim(), match = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const key = match[1].toLowerCase(), value = match[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) groups.push(current = { agents: [], rules: [] });
      current.agents.push(value.toLowerCase()); lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (current && (key === "allow" || key === "disallow") && value) current.rules.push({ allow: key === "allow", path: value });
    }
  }
  const own = groups.filter(group => group.agents.some(agent => agent !== "*" && ROBOTS_AGENT.startsWith(agent)));
  const rules = (own.length ? own : groups.filter(group => group.agents.includes("*"))).flatMap(group => group.rules);
  const matches = (pattern: string) => {
    const regex = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$");
    return new RegExp(`^${regex}`).test(path);
  };
  // 最も長く一致した規則を採用し、同じ長さならAllowを優先する。
  const best = rules.filter(rule => matches(rule.path)).sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow))[0];
  return best ? best.allow : true;
}

// 拒否・制限された場合は回避せず、手入力に切り替える。URL・本文はエラーに含めない。
export async function fetchPageFacts(url: string, fetcher: PageFetcher = safeFetch): Promise<ExtractionResult> {
  const target = extractionTarget(url);
  if (!target) return { facts: null, reason: "unsupported" };
  const page = new URL(target.url);
  let response: FetchedPage;
  try {
    // robots.txtが取得できない（5xx・接続失敗）場合は取得を控える。404などは制限なしとして扱う。
    const robots = await fetcher(`${page.origin}/robots.txt`, "text/plain", MAX_ROBOTS_BYTES);
    if (robots.status >= 500 || robots.status === 429) return { facts: null, reason: "unsupported" };
    if (robots.status >= 200 && robots.status < 300 && !robotsAllows(robots.body, `${page.pathname}${page.search}`)) return { facts: null, reason: "unsupported" };
    response = await fetcher(target.url, "text/html", MAX_PAGE_BYTES);
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith("Source ") ? error.message : null;
    console.error("place_source_unavailable", JSON.stringify({ host: page.hostname, name: error instanceof Error ? error.name : typeof error, code: (error as { code?: unknown })?.code ?? null, message }));
    return { facts: null, reason: "fetch_failed" };
  }
  if ([401, 403, 407, 429, 451].includes(response.status) || (response.status >= 300 && response.status < 400)) return { facts: null, reason: "unsupported" };
  if (response.status < 200 || response.status >= 300 || !response.contentType.includes("text/html")) {
    console.error("place_source_unavailable", JSON.stringify({ host: page.hostname, status: response.status, type: response.contentType.split(";")[0] || "-" }));
    return { facts: null, reason: "fetch_failed" };
  }
  return analyzePage(response.body);
}
