import { loadApiKeys } from "./user-store";

export interface NaverKeys {
  clientId: string;
  clientSecret: string;
}

export function resolveNaverKeys(userId?: number): NaverKeys {
  if (userId) {
    const keys = loadApiKeys(userId);
    if (keys.naver_id && keys.naver_secret) {
      return { clientId: keys.naver_id, clientSecret: keys.naver_secret };
    }
  }

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (clientId && clientSecret) {
    return { clientId, clientSecret };
  }

  throw new Error(
    "Naver API 키가 설정되지 않았습니다. 마이페이지에서 키를 등록하거나 환경변수를 설정하세요."
  );
}
