import { setUserRole } from "../../lib/server/user-store.ts";

const [username, role] = process.argv.slice(2);
if (!username || (role !== "user" && role !== "admin")) {
  console.error("사용법: npm run set-user-role -- <사용자> <user|admin>");
  process.exit(1);
}

if (!setUserRole(username, role)) {
  console.error("사용자를 찾을 수 없습니다");
  process.exit(1);
}

console.log(`${username}의 역할을 ${role}(으)로 바꿨습니다`);
