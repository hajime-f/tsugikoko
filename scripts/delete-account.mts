// 既定は参照のみ。実行前にREADME「データ削除の受付・実行」を読むこと。
import { deletePreparedAccount, inspectAccountDeletion, prepareAccountDeletion } from "../src/server/accounts/deletion";

const args = process.argv.slice(2);
const value = (name: string) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const uid = value("uid"), project = value("project");
const prepare = args.includes("--prepare"), remove = args.includes("--delete");
const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST);
if (args.some(arg => !/^--(uid|project|confirm)=.+$/.test(arg) && !["--prepare", "--delete", "--identity-verified"].includes(arg)) ||
    !uid || project !== (emulator ? "demo-tsugikoko" : "tsugikoko") || (prepare && remove) ||
    ((prepare || remove) && (value("confirm") !== uid || !args.includes("--identity-verified")))) {
  throw new Error("Usage: --project=tsugikoko --uid=UID [--prepare|--delete --confirm=UID --identity-verified]. Default: dry-run. Emulator: --project=demo-tsugikoko");
}
// 認証情報・個人データ・UID自体は標準出力に出さない。
if (prepare) {
  await prepareAccountDeletion(uid);
  console.log(JSON.stringify({ project, mode: "prepare", waitMinutes: 5 }));
} else if (remove) {
  console.log(JSON.stringify({ project, mode: "delete", ...await deletePreparedAccount(uid) }));
} else {
  console.log(JSON.stringify({ project, mode: "dry-run", ...await inspectAccountDeletion(uid) }));
}
