"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "motion/react";
import { ArrowRight, Check, GitFork, Link2 } from "lucide-react";
import { useEffect, useState } from "react";

type Installation = { id: string; account: string; type: "Organization" | "User" };
type Repository = { id: number; fullName: string; private: boolean };
type ConnectedRepository = { full_name: string; default_branch: string; installation_id: string } | null;
const videoSource = "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260506_081238_406ed0e3-5d83-436e-a512-0bbff7ec5b95.mp4";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Request failed");
  return body as T;
}

export default function GitHubSettingsPage() {
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [installationId, setInstallationId] = useState("");
  const [repositoryName, setRepositoryName] = useState("");
  const [connected, setConnected] = useState<ConnectedRepository>(null);
  const [message, setMessage] = useState("Loading your GitHub connection...");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void request<{ repository: ConnectedRepository }>("/api/github/repositories").then(({ repository }) => setConnected(repository)).catch(() => undefined);
    void request<{ installations: Installation[] }>("/api/github/installations").then(({ installations }) => {
      setInstallations(installations);
      setMessage(installations.length ? "Choose the account that owns the repository." : "Connect GitHub to load your installations.");
    }).catch((error: Error) => setMessage(error.message));
  }, []);

  async function chooseInstallation(value: string) {
    setInstallationId(value); setRepositoryName(""); setRepositories([]);
    if (!value) return;
    setMessage("Loading repositories you can authorize...");
    try {
      const response = await request<{ repositories: Repository[] }>(`/api/github/installations/${value}/repositories`);
      setRepositories(response.repositories);
      setMessage(response.repositories.length ? "Choose one repository for the next investigation." : "This installation has no accessible repositories.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load repositories"); }
  }

  async function save() {
    if (!installationId || !repositoryName) return;
    setBusy(true);
    try {
      const { repository } = await request<{ repository: ConnectedRepository }>("/api/github/repositories", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ installationId, fullName: repositoryName }) });
      setConnected(repository); setMessage(`${repository?.full_name} is ready for investigation.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save repository"); }
    finally { setBusy(false); }
  }

  return <main className="flow-shell">
    <section className="flow-hero"><video autoPlay muted loop playsInline className="flow-video"><source src={videoSource} type="video/mp4" /></video><motion.div className="hero-content" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .7 }}><div className="hero-brand"><Image src="/incidentpilot-logo.png" alt="IncidentPilot logo" width={28} height={28} className="brand-logo" priority /><span>incident pilot</span></div><div><p className="hero-kicker">REPOSITORY ACCESS</p><h1>Choose one<br />clear scope.</h1><p className="hero-copy">Your selected repository is the only codebase the isolated runner can inspect.</p></div><div className="hero-steps"><Step number={1} text="Authorize GitHub" active={!installations.length} /><Step number={2} text="Choose a repository" active={Boolean(installations.length) && !connected} /><Step number={3} text="Open investigation" active={Boolean(connected)} /></div></motion.div></section>
    <section className="flow-panel"><motion.div className="flow-content" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .7 }}><nav className="flow-nav"><Link className="wordmark" href="/"><Image src="/incidentpilot-logo.png" alt="" width={30} height={30} className="brand-logo" priority /><span className="wordmark-label">incident <b>pilot</b></span></Link><Link href="/" className="text-link">Back to flow</Link></nav><header className="flow-header"><p className="eyebrow">PHASE 2 OF 3</p><h2>Choose your repository</h2><p>Select an account, then one repository. You can change it later before opening an investigation.</p></header>
      {connected && <section className="flow-card complete"><div className="flow-card-top"><div className="flow-number"><Check size={15} /></div><div><p>CURRENT SELECTION</p><h3>{connected.full_name}</h3></div><GitFork size={19} /></div><p className="flow-description">{connected.default_branch} branch is currently authorized for the next investigation.</p></section>}
      <section className="flow-card active"><div className="flow-card-top"><div className="flow-number">1</div><div><p>ACCOUNT</p><h3>{installations.length ? "Choose a GitHub installation" : "Connect GitHub"}</h3></div><Link2 size={19} /></div><p className="flow-description">GitHub shows only installations you can administer or access.</p>{installations.length ? <select className="flow-select" value={installationId} onChange={(event) => void chooseInstallation(event.target.value)}><option value="">Select an account or organization</option>{installations.map((installation) => <option value={installation.id} key={installation.id}>{installation.account} ({installation.type})</option>)}</select> : <a className="primary-action" href="/api/github/connect">Connect GitHub <ArrowRight size={17} /></a>}</section>
      <section className={`flow-card ${repositories.length ? "active" : ""}`}><div className="flow-card-top"><div className="flow-number">2</div><div><p>REPOSITORY</p><h3>Choose one codebase</h3></div><GitFork size={19} /></div><p className="flow-description">The GitHub App validates access before we save the selection.</p><select className="flow-select" value={repositoryName} onChange={(event) => setRepositoryName(event.target.value)} disabled={!repositories.length}><option value="">Select a repository</option>{repositories.map((repository) => <option value={repository.fullName} key={repository.id}>{repository.fullName}{repository.private ? " (private)" : ""}</option>)}</select></section>
      <button className="primary-action repository-save" onClick={() => void save()} disabled={!installationId || !repositoryName || busy}>{busy ? "Saving selection" : "Use this repository"}<ArrowRight size={17} /></button><p className="github-message">{message}</p>
    </motion.div></section>
  </main>;
}

function Step({ number, text, active }: { number: number; text: string; active: boolean }) { return <div className={`hero-step ${active ? "active" : ""}`}><span>{number}</span><strong>{text}</strong></div>; }
