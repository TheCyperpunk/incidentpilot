"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Installation = { id: string; account: string; type: "Organization" | "User" };
type Repository = { id: number; fullName: string; private: boolean };
type ConnectedRepository = { full_name: string; default_branch: string; installation_id: string } | null;

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Request failed");
  return body as T;
}

export default function GitHubSettingsPage() {
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [selectedInstallation, setSelectedInstallation] = useState("");
  const [selectedRepository, setSelectedRepository] = useState("");
  const [connected, setConnected] = useState<ConnectedRepository>(null);
  const [changing, setChanging] = useState(false);
  const [message, setMessage] = useState("Connect GitHub only when you need to choose or change a repository.");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void request<{ repository: ConnectedRepository }>("/api/github/repositories").then(({ repository }) => setConnected(repository)).catch(() => undefined);
    void request<{ installations: Installation[] }>("/api/github/installations").then(({ installations }) => setInstallations(installations)).catch((error: Error) => setMessage(error.message));
  }, []);

  async function chooseInstallation(installationId: string) {
    setSelectedInstallation(installationId); setSelectedRepository(""); setRepositories([]); setMessage("Loading repositories…");
    try {
      const { repositories } = await request<{ repositories: Repository[] }>(`/api/github/installations/${installationId}/repositories`);
      setRepositories(repositories); setMessage(repositories.length ? "Choose a repository to use for future investigations." : "The App has no repositories installed for this account.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load repositories"); }
  }

  async function save() {
    if (!selectedInstallation || !selectedRepository) return;
    setBusy(true);
    try {
      const { repository } = await request<{ repository: ConnectedRepository }>("/api/github/repositories", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ installationId: selectedInstallation, fullName: selectedRepository }) });
      setConnected(repository); setChanging(false); setMessage(`${repository?.full_name} is ready for investigations.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save repository"); }
    finally { setBusy(false); }
  }

  const showSetup = !connected || changing;
  return <main className="app-shell"><nav className="topbar"><Link className="brand" href="/"><b>i</b> incident<span>pilot</span></Link><i className="divider" /><span className="workspace-dot" /><span className="workspace-name">Repository settings</span><div className="top-actions"><Link href="/">Open incident</Link></div></nav><section className="github-settings"><p className="eyebrow">REPOSITORY ACCESS</p><h1>{showSetup ? "Choose a repository." : "Repository ready."}</h1><p className="subtitle">The active repository is used as evidence for the next incident investigation.</p>{connected && <section className="github-active"><span>ACTIVE REPOSITORY</span><strong>{connected.full_name}</strong><small>{connected.default_branch} · GitHub App installation {connected.installation_id}</small><div className="github-active-actions"><Link className="login-submit github-button" href="/">Open incident</Link><button className="secondary-button" onClick={() => setChanging(true)}>Change repository</button></div></section>}{showSetup && <><section className="github-card"><div><h2>{installations.length ? "Choose account or organization" : "Connect GitHub"}</h2><p>{installations.length ? "Select an installed account or organization." : "Connect GitHub to load the App installations you can access."}</p></div>{installations.length ? <select value={selectedInstallation} onChange={(event) => void chooseInstallation(event.target.value)}><option value="">Select an installation</option>{installations.map((installation) => <option value={installation.id} key={installation.id}>{installation.account} ({installation.type})</option>)}</select> : <a className="login-submit github-button" href="/api/github/connect">Connect GitHub</a>}</section><section className="github-card"><div><h2>Choose repository</h2><p>GitHub validates that the installed App may read this repository.</p></div><select value={selectedRepository} onChange={(event) => setSelectedRepository(event.target.value)} disabled={!repositories.length}><option value="">Select a repository</option>{repositories.map((repository) => <option value={repository.fullName} key={repository.id}>{repository.fullName}{repository.private ? " · private" : ""}</option>)}</select></section><button className="login-submit save-repository" disabled={!selectedInstallation || !selectedRepository || busy} onClick={() => void save()}>{busy ? "Saving…" : "Use this repository"}</button><p className="github-message">{message}</p></>}</section></main>;
}
