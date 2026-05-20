"use client";

// M-1: Token storage moved to HttpOnly cookies (set by server).
// All API calls use credentials: "include" so cookies are sent automatically.
// No manual token management in localStorage.

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch("/site/api/auth/refresh", {
      method: "POST",
      credentials: "include",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function authFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  let res = await fetch(url, { ...options, credentials: "include" });

  if (res.status === 401) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      res = await fetch(url, { ...options, credentials: "include" });
    } else {
      window.location.href = "/site/login";
    }
  }

  return res;
}
