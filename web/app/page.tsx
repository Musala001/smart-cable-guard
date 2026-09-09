import { Icon } from "../components/railway-dashboard/Icon";
import Link from "next/link";
import "./landing/landing.css";

export const metadata = {
  title: "rAIL — Railway cable intelligence",
  description: "Train-mounted cameras and computer vision to find damaged railway cables sooner.",
};

export default function LandingPage() {
  return (
    <div className="landing-page">
      <header className="site-header">
        <div className="brand">
          <img className="brand-logo" src="/brand/rail-logo.png" alt="rAIL" width={1405} height={732} />
          <span className="brand-sub">Railway intelligence</span>
        </div>
      </header>

      <main id="top">
        <section className="hero" id="intelligence">
          <div className="hero-bg" />
          <div className="hero-overlay" />
          <div className="hero-grid container">
            <div className="hero-copy">
              <div className="eyebrow">Computer vision for railway infrastructure</div>
              <h1>See cable damage<br /><span>before it stops the line.</span></h1>
              <p>rAIL brings train-mounted cameras, computer vision and location intelligence into one clear operational view so damaged railway cables are found and reviewed sooner.</p>
              <div className="hero-actions">
                <Link className="btn btn-primary" href="/detect">Start detection <Icon name="arrow" size={18} /></Link>
                <Link className="btn btn-dark" href="/dashboard">Open dashboard</Link>
              </div>
            </div>

            <div className="hero-visual">
              <div className="train-scene">
                <div className="train-scene-heading"><span className="camera-status" /> TRAIN-MOUNTED VISION <span className="scene-demo">ILLUSTRATION</span></div>
                <svg aria-hidden="true" className="train-animation" viewBox="0 0 600 280" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <linearGradient id="train-body" x2="0" y2="1"><stop stopColor="#486073" /><stop offset="1" stopColor="#293d4c" /></linearGradient>
                    <linearGradient id="camera-beam" x2="0" y2="1"><stop stopColor="var(--brand)" stopOpacity=".3" /><stop offset="1" stopColor="var(--brand)" stopOpacity=".03" /></linearGradient>
                    <pattern id="sleepers" width="40" height="18" patternUnits="userSpaceOnUse"><path d="M8 0v18" stroke="#486073" strokeWidth="8" /></pattern>
                  </defs>
                  <path d="M0 88H600M0 104H600" stroke="#759087" strokeWidth="2" />
                  <g className="passing-poles" stroke="#486073" strokeWidth="4"><path d="M40 240V38h95M360 240V38h95M680 240V38h95" /><path d="M110 38v66M430 38v66M750 38v66" strokeWidth="2" /></g>
                  <g className="moving-track"><rect x="-40" y="243" width="680" height="18" fill="url(#sleepers)" /></g>
                  <path d="M0 242H600M0 259H600" stroke="var(--brand)" strokeOpacity=".5" strokeWidth="2" />
                  <g className="train-carriage">
                    <animateTransform attributeName="transform" type="translate" values="-540 0;600 0" dur="12s" begin="-5.5s" repeatCount="indefinite" calcMode="linear" />
                    <g className="cable-target" fill="none" stroke="var(--brand)" strokeWidth="2"><path d="M370 84h-8v8m40-8h8v8m-48 12v8h8m40-8v8h-8" /><path d="M380 98h12m-6-6v12" /></g>
                    <path className="camera-cone" d="M386 124L357 88H415Z" fill="url(#camera-beam)" stroke="var(--brand)" strokeOpacity=".35" />
                    <path d="M42 157Q42 145 56 145H448Q474 145 492 171L526 211Q533 225 516 225H42Z" fill="url(#train-body)" stroke="#6c8390" strokeWidth="2" />
                    <path d="M43 205H520" stroke="var(--brand)" strokeWidth="7" />
                    <path d="M450 155Q463 155 480 177L491 191H447Z" fill="#0a191d" stroke="var(--brand)" />
                    <g fill="#0a191d" stroke="#6c8390"><rect x="64" y="161" width="55" height="29" rx="4" /><rect x="133" y="161" width="55" height="29" rx="4" /><rect x="202" y="161" width="55" height="29" rx="4" /><rect x="271" y="161" width="55" height="29" rx="4" /><rect x="346" y="157" width="35" height="65" rx="3" /></g>
                    <g fill="#0a191d" stroke="#6c8390" strokeWidth="4"><circle cx="101" cy="230" r="12" /><circle cx="140" cy="230" r="12" /><circle cx="411" cy="230" r="12" /><circle cx="450" cy="230" r="12" /></g>
                    <path d="M375 145v-13" stroke="var(--brand)" strokeWidth="4" />
                    <rect x="361" y="120" width="29" height="16" rx="4" fill="var(--brand)" />
                    <circle cx="386" cy="128" r="5" fill="#0a191d" />
                    <path d="M510 207h11" stroke="#e5f6d9" strokeWidth="5" />
                    <text x="65" y="219" fill="#e5f6e9" fontSize="10" fontFamily="var(--font-app)" letterSpacing="2">rAIL</text>
                  </g>
                  <text x="300" y="27" fill="var(--brand)" fontSize="10" fontFamily="var(--font-app)" letterSpacing="2">OVERHEAD CABLE MONITORING</text>
                </svg>
              </div>
            </div>
          </div>

          <div className="process-strip">
            <div>ONBOARD CAMERAS</div><span /><div>AI DETECTION</div><span /><div>GPS MAPPING</div><span /><div>HUMAN REVIEW</div>
          </div>
        </section>

        <section className="feature-band">
          <div className="container feature-grid">
            <article><div className="feature-icon">01</div><h3>Cable fault detection</h3><p>A trained model finds breaks, arc damage and foreign objects.</p></article>
            <article><div className="feature-icon">02</div><h3>Map-ready findings</h3><p>Every detection carries GPS coordinates for the dashboard map.</p></article>
            <article><div className="feature-icon">03</div><h3>Human in the loop</h3><p>Confirm, resolve or dismiss every model finding.</p></article>
          </div>
        </section>

        <section className="demo-band" aria-labelledby="demo-heading">
          <div className="container demo-inner">
            <h2 id="demo-heading">Your cameras are<br />already watching.<span>Let’s make them<br />useful.</span></h2>
            <p>Turn railway footage into clear cable findings.<br />Locate damage. Review detections. Plan your next inspection.</p>
            <Link className="demo-cta" href="/dashboard">Open dashboard <Icon name="arrow" size={18} /></Link>
          </div>
        </section>

        <section className="contact-band" id="contact">
          <div className="container contact-inner">
            <div className="eyebrow">Get in touch</div>
            <h2>Get in touch</h2>
            <p>Have questions or ready to transform your inspection workflows? We'd love to hear from you.</p>
            <form className="contact-form" action="mailto:kamogelomacena@gmail.com" method="post" encType="text/plain">
              <div className="cf-row">
                <label>Name<input type="text" name="Name" required /></label>
                <label>Email<input type="email" name="Email" required /></label>
              </div>
              <label>Company<input type="text" name="Company" /></label>
              <label>Message<textarea name="Message" rows={5} required /></label>
              <button type="submit" className="cf-send">Send message <Icon name="send" size={18} /></button>
            </form>
          </div>
        </section>
      </main>
      <footer>
        <div className="container footer-africa">
          <img className="afretec-logo" src="/rail-landing/afretec-network.jpeg" alt="AFRETEC Network by Carnegie Mellon-Africa" width={1030} height={1153} loading="lazy" />
          <div className="footer-africa-copy">
            <span className="afretec-label">AFRETEC Network</span>
            <h2>Inspired by Africa. Made for Africa.</h2>
            <p>rAIL is an African-inspired project built for Africa, using train-mounted cameras and computer vision to help teams monitor railway cables across the continent.</p>
          </div>
        </div>
        <div className="container footer-inner">
          <a className="brand footer-brand" href="#top" aria-label="rAIL home">
            <img className="brand-logo" src="/brand/rail-logo.png" alt="rAIL" width={1405} height={732} />
            <span className="brand-sub">Railway intelligence</span>
          </a>
          <p>Train-mounted cameras. Smarter cable monitoring.</p>
          <Link className="nav-cta" href="/detect">Open detector</Link>
        </div>
      </footer>
    </div>
  );
}
