// 既存の保存記録から同じURLの共通情報（urlFacts）を作る。既定はdry-runで、件数だけを表示する。
// 実行例: node --conditions=react-server --import tsx scripts/backfill-url-facts.mts [--apply] [--max-writes=1000]
import { backfillUrlFacts } from "../src/server/places/backfill";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const option = (name: string, fallback: number) => {
  const value = args.find(arg => arg.startsWith(`--${name}=`))?.split("=")[1];
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`--${name} must be a positive integer`);
  return number;
};
if (args.some(arg => !["--apply"].includes(arg) && !/^--(max-records|max-writes)=\d+$/.test(arg))) throw new Error("Usage: [--apply] [--max-records=N] [--max-writes=N]");
const result = await backfillUrlFacts({ apply, maxRecords: option("max-records", 20_000), maxWrites: option("max-writes", 1_000) });
// 件数だけを出力する。URL・店名・住所・UIDは出さない。
console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", project: process.env.FIRESTORE_EMULATOR_HOST ? "emulator" : "tsugikoko", ...result }));
