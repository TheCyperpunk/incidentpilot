import "server-only";

import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";

const stateCookie = "incidentpilot_github_oauth_state";
const tokenCookie = "incidentpilot_github_user_token";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function githubOAuthConfigured() {
  return ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GITHUB_OAUTH_CALLBACK_URL"].every((name) => Boolean(process.env[name]?.trim()));
}

function cookieOptions(maxAge: number) {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge };
}

export async function beginGitHubAuthorization() {
  const state = randomBytes(32).toString("base64url");
  const store = await cookies();
  store.set(stateCookie, state, cookieOptions(600));
  const query = new URLSearchParams({ client_id: required("GITHUB_CLIENT_ID"), redirect_uri: required("GITHUB_OAUTH_CALLBACK_URL"), state });
  return `https://github.com/login/oauth/authorize?${query}`;
}

export async function completeGitHubAuthorization(code: string, state: string) {
  const store = await cookies();
  const expectedState = store.get(stateCookie)?.value;
  store.delete(stateCookie);
  if (!expectedState || expectedState !== state) throw new Error("GitHub authorization state was invalid or expired");

  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: required("GITHUB_CLIENT_ID"), client_secret: required("GITHUB_CLIENT_SECRET"), code, redirect_uri: required("GITHUB_OAUTH_CALLBACK_URL") }),
    cache: "no-store",
  });
  const payload = await response.json() as { access_token?: string; error_description?: string };
  if (!response.ok || !payload.access_token) throw new Error(payload.error_description ?? "GitHub authorization failed");
  store.set(tokenCookie, payload.access_token, cookieOptions(600));
}

export async function githubUserToken() {
  const token = (await cookies()).get(tokenCookie)?.value;
  if (!token) throw new Error("Connect your GitHub account to choose an organization or repository");
  return token;
}

async function githubUserRequest<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, { headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28" }, cache: "no-store" });
  if (!response.ok) throw new Error(response.status === 401 ? "GitHub session expired; connect again" : "GitHub could not load your installations");
  return response.json() as Promise<T>;
}

export type GitHubInstallationChoice = { id: string; account: string; type: "Organization" | "User" };
export type GitHubRepositoryChoice = { id: number; fullName: string; name: string; private: boolean; defaultBranch: string };

export async function listUserInstallations(token: string): Promise<GitHubInstallationChoice[]> {
  const response = await githubUserRequest<{ installations: Array<{ id: number; target_type: "Organization" | "User"; account: { login: string } }> }>(token, "/user/installations?per_page=100");
  return response.installations.map((installation) => ({ id: String(installation.id), account: installation.account.login, type: installation.target_type }));
}

export async function listUserInstallationRepositories(token: string, installationId: string): Promise<GitHubRepositoryChoice[]> {
  if (!/^\d+$/.test(installationId)) throw new Error("GitHub installation ID is invalid");
  const response = await githubUserRequest<{ repositories: Array<{ id: number; full_name: string; name: string; private: boolean; default_branch: string }> }>(token, `/user/installations/${installationId}/repositories?per_page=100`);
  return response.repositories.map((repository) => ({ id: repository.id, fullName: repository.full_name, name: repository.name, private: repository.private, defaultBranch: repository.default_branch }));
}
