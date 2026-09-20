import "server-only";

import { App } from "octokit";
import { readFileSync } from "node:fs";

export type GitHubRepository = {
  fullName: string;
  cloneUrl: string;
  defaultBranch: string;
  installationId: string;
};

export type GitHubCommit = {
  sha: string;
  message: string;
  committedAt: string;
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function repositoryName(fullName: string) {
  fullName = fullName.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*$/i.test(fullName)) {
    throw new Error("GITHUB_ALLOWED_REPOSITORY must use the owner/repository format");
  }
  return fullName;
}

function app() {
  // A PEM path is convenient for local development. Production should inject
  // the PEM itself through a managed server-side secret.
  const privateKeyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH?.trim();
  const privateKey = privateKeyPath
    ? readFileSync(privateKeyPath, "utf8")
    : required("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n");
  return new App({ appId: required("GITHUB_APP_ID"), privateKey });
}

export function githubIntegrationConfigured() {
  return Boolean(process.env.GITHUB_APP_ID?.trim() && (process.env.GITHUB_APP_PRIVATE_KEY?.trim() || process.env.GITHUB_APP_PRIVATE_KEY_PATH?.trim()));
}

/**
 * Verifies that the configured repository is actually available to this exact
 * GitHub App installation. Values from the browser are never used here.
 */
export async function getRepositoryForInstallation(installationId: string, requestedFullName: string): Promise<GitHubRepository> {
  const fullName = repositoryName(requestedFullName);
  if (!/^\d+$/.test(installationId)) throw new Error("GitHub installation ID is invalid");
  const [owner, repo] = fullName.split("/");
  const octokit = await app().getInstallationOctokit(Number(installationId));
  const { data } = await octokit.rest.repos.get({ owner, repo });

  if (data.full_name.toLowerCase() !== fullName || !data.clone_url || !data.default_branch) {
    throw new Error("Configured GitHub repository could not be validated for this installation");
  }

  return { fullName: data.full_name, cloneUrl: data.clone_url, defaultBranch: data.default_branch, installationId };
}

/** A short-lived installation token. It is used only in the server-to-server runner request. */
export async function getInstallationToken(installationId: string) {
  const authentication = await app().octokit.auth({ type: "installation", installationId: Number(installationId) }) as { type: string; token?: string };
  if (authentication.type !== "token" || !authentication.token) throw new Error("Unable to create a GitHub installation token");
  return authentication.token;
}

export async function getCommitSha(repository: GitHubRepository, ref: string) {
  const [owner, repo] = repository.fullName.split("/");
  const octokit = await app().getInstallationOctokit(Number(repository.installationId));
  const { data } = await octokit.rest.repos.getCommit({ owner, repo, ref });
  if (!/^[a-f0-9]{40}$/i.test(data.sha)) throw new Error("GitHub did not return an immutable commit SHA");
  return data.sha;
}

/** Returns deployment context from the selected repository without treating a commit as a deployment. */
export async function getLatestCommit(repository: GitHubRepository): Promise<GitHubCommit> {
  const [owner, repo] = repository.fullName.split("/");
  const octokit = await app().getInstallationOctokit(Number(repository.installationId));
  const { data } = await octokit.rest.repos.getCommit({ owner, repo, ref: repository.defaultBranch });
  const committedAt = data.commit.committer?.date ?? data.commit.author?.date;
  if (!/^[a-f0-9]{40}$/i.test(data.sha) || !committedAt) {
    throw new Error("GitHub did not return complete commit metadata");
  }
  return { sha: data.sha, message: data.commit.message.split("\n", 1)[0], committedAt };
}
