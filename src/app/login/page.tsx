"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "motion/react";
import { Circle, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { FormEvent, type ReactNode, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const videoSource = "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260506_081238_406ed0e3-5d83-436e-a512-0bbff7ec5b95.mp4";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(null);
    const supabase = createClient();
    const result = mode === "sign-in" ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/auth/confirm` } });
    setBusy(false);
    if (result.error) { setMessage(result.error.message); return; }
    if (mode === "sign-up" && !result.data.session) { setMessage("Check your email to confirm the new account, then sign in."); return; }
    router.replace("/"); router.refresh();
  }

  return <main className="flow-shell"><section className="flow-hero"><video autoPlay muted loop playsInline className="flow-video"><source src={videoSource} type="video/mp4" /></video><motion.div className="hero-content" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .7 }}><div className="hero-brand"><Image src="/incidentpilot-logo.png" alt="IncidentPilot logo" width={28} height={28} className="brand-logo" priority /><span>incident pilot</span></div><div><p className="hero-kicker">SECURE WORKSPACE</p><h1>Investigate<br />with confidence.</h1><p className="hero-copy">Your workspace, repository selection, and investigation records are protected by your account.</p></div><div className="hero-steps"><HeroFact icon={<LockKeyhole size={15} />} text="Private workspace access" /><HeroFact icon={<Mail size={15} />} text="Email verification for new accounts" /><HeroFact icon={<Circle size={15} />} text="Return to your guided flow" /></div></motion.div></section><section className="flow-panel"><motion.div className="flow-content auth-flow-content" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .8, ease: "easeOut" }}><nav className="flow-nav"><Link className="wordmark" href="/"><Image src="/incidentpilot-logo.png" alt="" width={30} height={30} className="brand-logo" priority /><span className="wordmark-label">incident <b>pilot</b></span></Link><Link href="/" className="text-link">Back</Link></nav><header className="flow-header"><p className="eyebrow">YOUR WORKSPACE</p><h2>{mode === "sign-in" ? "Welcome back" : "Create your account"}</h2><p>{mode === "sign-in" ? "Sign in to continue your investigation workflow." : "Start with a secure account, then connect only the sources you need."}</p></header><form onSubmit={submit} className="account-form"><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required autoComplete="email" /></label><label>Password<span className="password-wrap"><input type={visible ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" required minLength={6} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} /><button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? "Hide password" : "Show password"}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></span>{mode === "sign-up" && <small>Use at least 6 characters.</small>}</label><button className="primary-action" disabled={busy}>{busy ? "Please wait" : mode === "sign-in" ? "Sign in" : "Create account"}</button></form>{message && <p className="flow-error">{message}</p>}<button className="mode-switch" onClick={() => { setMode(mode === "sign-in" ? "sign-up" : "sign-in"); setMessage(null); }}>{mode === "sign-in" ? "New to IncidentPilot? Create an account" : "Already have an account? Sign in"}</button></motion.div></section></main>;
}

function HeroFact({ icon, text }: { icon: ReactNode; text: string }) { return <div className="hero-step"><span>{icon}</span><strong>{text}</strong></div>; }
