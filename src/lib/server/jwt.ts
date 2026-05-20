import { SignJWT, jwtVerify } from "jose";
import { getJwtSecret } from "./crypto";

const ACCESS_TTL = "15m";
const REFRESH_TTL = "14d";
export const REFRESH_TTL_SECONDS = 14 * 24 * 60 * 60;

function getSecretKey(): Uint8Array {
  return new Uint8Array(getJwtSecret());
}

export interface TokenPayload {
  sub: string;
  kind: "access" | "refresh";
}

export async function signAccessToken(userId: number): Promise<string> {
  return new SignJWT({ sub: String(userId), kind: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(getSecretKey());
}

export async function signRefreshToken(userId: number): Promise<string> {
  return new SignJWT({ sub: String(userId), kind: "refresh" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(REFRESH_TTL)
    .sign(getSecretKey());
}

export async function verifyToken(token: string): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, getSecretKey());
  return payload as unknown as TokenPayload;
}
