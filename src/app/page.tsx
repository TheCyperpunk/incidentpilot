"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "motion/react";
import { ArrowRight, Check, GitFork, Radar, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

type Triage = { summary: string; provider: "openai" | "simulation" };
type RootCause = { file: string; function: string; summary: string; evidence: string[]; confidence: string; tests: { command: string; exitCode: number; summary: string }[]; provider: string };
type ActiveRepository = { full_name: string; default_branch: string } | null;
type Run = { id: string; status: string; pinnedCommitSha?: string; triage?: Triage; rootCause?: RootCause; events: { message: string; detail: string; type: string }[] };
type Metric = { label: string; value: string; detail: string };
type Observability = { metrics: Metric[]; sentry: { status: string; updatedAt?: string }; deployment: { repository: string | null; branch: string | null; commitSha: string | null } };

const videoSource = "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260506_081238_406ed0e3-5d83-436e-a512-0bbff7ec5b95.mp4";

export default function Home() {
  const [repository, setRepository] = useState<ActiveRepository>(null);
  const [observability, setObservability] = useState<Observability | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadWorkspace() {
      try {
        const [repositoryResponse, observabilityResponse, latestResponse] = await Promise.all([
          fetch("/api/github/repositories", { cache: "no-store" }),
          fetch("/api/observability", { cache: "no-store" }),
          fetch("/api/incidents/INC-2048/latest", { cache: "no-store" }),
        ]);
        if (cancelled) return;
        if (repositoryResponse.ok) setRepository((await repositoryResponse.json() as { repository: ActiveRepository }).repository);
        if (observabilityResponse.ok) setObservability(await observabilityResponse.json() as Observability);
        if (latestResponse.ok) setRun(await latestResponse.json() as Run);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load the workspace");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadWorkspace();
    return () => { cancelled = true; };
  }, []);

  async function startInvestigation() {
    if (!repository) { setError("Choose a repository before starting an investigation."); return; }
    setStarting(true); setError(null);
    try {
      const response = await fetch("/api/incidents/INC-2048/investigate", { method: "POST" });
      const body = await response.json() as Run & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to start the investigation");
      setRun(body);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to start the investigation"); }
    finally { setStarting(false); }
  }

  const sentryReady = observability?.sentry.status === "connected";
  const repositoryReady = Boolean(repository);
  const investigationReady = Boolean(run?.rootCause?.provider === "codex");
  const rootCause = run?.rootCause?.provider === "codex" ? run.rootCause : null;
  const steps = [sentryReady, repositoryReady, investigationReady];
  const activeStep = steps.findIndex((complete) => !complete) + 1 || 3;

  return <main className="flow-shell">
    <section className="flow-hero" aria-label="IncidentPilot workflow">
      <video autoPlay muted loop playsInline className="flow-video"><source src={videoSource} type="video/mp4" /></video>
      <motion.div className="hero-content" initial="hidden" animate="visible" variants={{ hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.15, delayChildren: 0.2 } } }}>
        <motion.div variants={reveal} className="hero-brand"><Image src="/incidentpilot-logo.png" alt="IncidentPilot logo" width={28} height={28} className="brand-logo" priority /><span>incident pilot</span></motion.div>
        <motion.div variants={reveal}><p className="hero-kicker">EVIDENCE-FIRST RESPONSE</p><h1>Start calm.<br />Move with proof.</h1><p className="hero-copy">Three clear phases take you from connected data to a human-approved decision.</p></motion.div>
        <motion.div variants={reveal} className="hero-steps"><StepItem number={1} text="Connect your signals" active={activeStep === 1} /><StepItem number={2} text="Choose your repository" active={activeStep === 2} /><StepItem number={3} text="Review investigation" active={activeStep === 3} /></motion.div>
      </motion.div>
    </section>

    <section className="flow-panel">
      <motion.div className="flow-content" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, ease: "easeOut" }}>
        <nav className="flow-nav"><Link className="wordmark" href="/"><Image src="/incidentpilot-logo.png" alt="" width={30} height={30} className="brand-logo" priority /><span className="wordmark-label">incident <b>pilot</b></span></Link><Link href="/login" className="text-link">Sign in</Link></nav>
        <header className="flow-header"><p className="eyebrow">GUIDED INVESTIGATION</p><h2>{loading ? "Loading your workspace" : investigationReady ? "Evidence is ready" : "Open an investigation"}</h2><p>Complete one phase at a time. We only enable the next action when its evidence is available.</p></header>

        <div className="flow-steps">
          <section className={`flow-card ${sentryReady ? "complete" : "active"}`}><div className="flow-card-top"><div className="flow-number">{sentryReady ? <Check size={15} /> : "1"}</div><div><p>PHASE 1</p><h3>Connect your signals</h3></div><Radar size={19} /></div><p className="flow-description">Sentry supplies errors and latency. Database and deployment sources stay clearly marked until you connect them.</p><div className="signal-list">{(observability?.metrics ?? []).slice(0, 3).map((metric) => <div key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.detail}</small></div>) || <span className="muted">Checking Sentry connection...</span>}</div><span className={`status-chip ${sentryReady ? "ready" : "waiting"}`}>{sentryReady ? "Sentry connected" : "Sentry is collecting data"}</span></section>

          <section className={`flow-card ${repositoryReady ? "complete" : activeStep === 2 ? "active" : ""}`}><div className="flow-card-top"><div className="flow-number">{repositoryReady ? <Check size={15} /> : "2"}</div><div><p>PHASE 2</p><h3>Choose one repository</h3></div><GitFork size={19} /></div><p className="flow-description">The runner can inspect only the repository you explicitly select through your GitHub App installation.</p>{repository ? <div className="repository-summary"><strong>{repository.full_name}</strong><span>{repository.default_branch} branch</span></div> : <div className="repository-summary muted">No repository selected</div>}<Link href="/settings/github" className="secondary-action">{repository ? "Change repository" : "Choose repository"}<ArrowRight size={16} /></Link></section>

          <section className={`flow-card ${investigationReady ? "complete" : activeStep === 3 ? "active" : ""}`}><div className="flow-card-top"><div className="flow-number">{investigationReady ? <Check size={15} /> : "3"}</div><div><p>PHASE 3</p><h3>Inspect and decide</h3></div><ShieldCheck size={19} /></div><p className="flow-description">IncidentPilot pins an immutable commit, runs an isolated investigation, and waits for your approval before any mitigation.</p><button className="primary-action" onClick={() => void startInvestigation()} disabled={!repositoryReady || starting || investigationReady}>{starting ? "Investigation in progress" : investigationReady ? "Investigation complete" : "Start investigation"}<ArrowRight size={17} /></button>{!repositoryReady && <small className="card-note">Select a repository to unlock this phase.</small>}</section>
        </div>

        {error && <p className="flow-error">{error}</p>}
        {run?.triage?.provider === "openai" && <section className="evidence-card"><Sparkles size={18} /><div><p>OPENAI TRIAGE</p><strong>{run.triage.summary}</strong></div></section>}
        {rootCause && <section className="evidence-card result"><ShieldCheck size={18} /><div><p>ISOLATED CODEX RUNNER</p><strong>{rootCause.summary}</strong><small><code>{rootCause.file}</code> at immutable commit <code>{run?.pinnedCommitSha?.slice(0, 12)}</code></small></div></section>}
      </motion.div>
    </section>
  </main>;
}

const reveal = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5 } } };

function StepItem({ number, text, active = false }: { number: number; text: string; active?: boolean }) {
  return <div className={`hero-step ${active ? "active" : ""}`}><span>{number}</span><strong>{text}</strong></div>;
}
