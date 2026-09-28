/**
 * The public landing page visitors see at `/`.
 *
 * Everything a first-time visitor needs in one scrolling page: who we are,
 * what we do, how booking works, why to choose us, and how to reach us. The
 * "Book an Appointment" button opens the shared OnlineBookingModal in public
 * mode, which submits through the anon-callable RPC app_submit_online_booking
 * (src/services/publicBooking.ts) - the visitor has no session and must not
 * touch the tables directly.
 *
 * The staff workstation lives at /staff and is not part of this page; the
 * "Staff" button simply navigates to it. Signed-in staff visiting `/` are
 * redirected to /staff by Root.
 *
 * Light-first, with dark: variants on the same tokens the workstation uses:
 * the user's device theme (or staff dark-mode preference) is respected without
 * this page ever depending on staff-only chrome.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  HeartPulse,
  Stethoscope,
  FlaskConical,
  Scan,
  Pill,
  Accessibility,
  Baby,
  CalendarCheck2,
  QrCode,
  ClipboardList,
  FileText,
  ShieldCheck,
  Microscope,
  Receipt,
  Lock,
  Building2,
  MapPin,
  Phone,
  Mail,
  ArrowRight,
  Sparkles,
  LogIn,
  CalendarDays,
  Clock,
  CheckCircle2,
} from 'lucide-react';
import {
  OnlineBookingModal
} from '../frontdesk/OnlineBookingModal';
import {
  submitOnlineBooking,
  SubmitBookingResult
} from '../../services/publicBooking';
import { BookingDraft } from '../../services/publicBooking';
import { navigate } from '../../router';

/* ------------------------------------------------------------------ */
/* Clinic identity - mirrors initialSettings in src/services/seedData  */
/* ------------------------------------------------------------------ */

const CLINIC = {
  name: 'FatClinic & Medical Specialties',
  shortName: 'FatClinic',
  address: '14 Healthcare Boulevard, Medical District, Victoria Island',
  phone: '+234 (0) 1 800-FATCLINIC',
  email: 'care@fatclinic.health',
};

/* ------------------------------- Reveal ------------------------------ */

interface RevealProps {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}

/** Fades content up once it scrolls into view. Dependency-free, one observer per element. */
function Reveal({ children, delay = 0, className = '' }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-out ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'} ${className}`}
    >
      {children}
    </div>
  );
}

/* ------------------------------- Brand -------------------------------- */

function BrandMark({ className = '' }: { className?: string }) {
  return (
    <a href="#" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className={`flex items-center space-x-3 group ${className}`}>
      <span className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shadow-lg shadow-emerald-500/25 group-hover:shadow-emerald-500/40 transition-shadow">
        <HeartPulse className="w-5 h-5" />
      </span>
      <span className="leading-tight">
        <span className="block text-lg font-black text-slate-900 dark:text-white tracking-tight">
          {CLINIC.shortName}
        </span>
        <span className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 tracking-wide uppercase">
          & Medical Specialties
        </span>
      </span>
    </a>
  );
}

/* ------------------------------ Nav items ----------------------------- */

const NAV_ITEMS = [
  { id: 'services', label: 'Services' },
  { id: 'how-it-works', label: 'How It Works' },
  { id: 'why-us', label: 'Why Us' },
  { id: 'contact', label: 'Contact' },
];

/* ------------------------------- Page --------------------------------- */

export const LandingPage: React.FC = () => {
  const [isBookingOpen, setIsBookingOpen] = useState(false);

  // Own the document title while the visitor is on this page; Root restores the
  // workstation title when the path moves to /staff (component unmounts).
  useEffect(() => {
    document.title = `${CLINIC.name} — Book an Appointment`;
    return () => {
      document.title = 'FatClinic - Hospital Management & EHR System';
    };
  }, []);

  const scrollToId = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const openBooking = () => setIsBookingOpen(true);

  const visitorSubmit = async (draft: BookingDraft): Promise<SubmitBookingResult> =>
    submitOnlineBooking(draft);

  return (
    <div className="h-screen overflow-y-auto scroll-smooth bg-white dark:bg-dark-bg text-slate-800 dark:text-dark-text select-text">
      {/* ============================ TOP NAV ============================ */}
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/80 dark:bg-dark-bg/80 border-b border-light-border dark:border-dark-border">
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <BrandMark />

          <div className="hidden md:flex items-center space-x-8">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => scrollToId(item.id)}
                className="text-sm font-semibold text-slate-600 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex items-center space-x-2.5">
            <button
              onClick={() => navigate('/staff')}
              className="hidden sm:flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-dark-surface transition-colors"
              title="Clinic workstation sign-in"
            >
              <LogIn className="w-4 h-4" />
              <span>Staff</span>
            </button>
            <button
              onClick={openBooking}
              className="flex items-center space-x-2 px-4 py-2 rounded-xl text-sm font-extrabold text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-lg shadow-emerald-600/25 transition-all"
            >
              <CalendarDays className="w-4 h-4" />
              <span>Book Appointment</span>
            </button>
          </div>
        </nav>
      </header>

      {/* ============================= HERO ============================== */}
      <section className="relative overflow-hidden bg-slate-950">
        {/* Ambient glows + faint grid, all CSS - no external images */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(60% 55% at 22% 12%, rgba(16,185,129,0.22) 0%, transparent 60%),' +
              'radial-gradient(55% 50% at 85% 25%, rgba(13,148,136,0.18) 0%, transparent 60%),' +
              'radial-gradient(70% 60% at 50% 110%, rgba(16,185,129,0.12) 0%, transparent 55%)',
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.15]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.35) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
          }}
        />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-20 lg:pt-24 lg:pb-28 grid lg:grid-cols-[1.15fr_0.85fr] gap-14 items-center">
          {/* Left: pitch */}
          <div>
            <span className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-400/25 text-emerald-300 text-xs font-bold">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Medical care without the paperwork</span>
            </span>

            <h1 className="mt-6 text-4xl sm:text-5xl lg:text-6xl font-black leading-[1.08] tracking-tight text-white">
              Precision care.
              <span className="block bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-400 bg-clip-text text-transparent">
                Connected health.
              </span>
              Zero compromise.
            </h1>

            <p className="mt-6 max-w-xl text-base sm:text-lg text-slate-300 leading-relaxed">
              One clinic, every speciality — general consultations, laboratory,
              radiology, pharmacy, physiotherapy and maternal care under a single
              roof. Book online in under a minute and walk straight in with your
              patient code.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <button
                onClick={openBooking}
                className="inline-flex items-center space-x-2 px-6 py-3.5 rounded-2xl text-base font-extrabold text-white bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 shadow-xl shadow-emerald-500/30 transition-all"
              >
                <CalendarCheck2 className="w-5 h-5" />
                <span>Book an appointment</span>
              </button>
              <button
                onClick={() => scrollToId('services')}
                className="inline-flex items-center space-x-2 px-6 py-3.5 rounded-2xl text-base font-bold text-slate-200 border border-white/15 hover:bg-white/5 transition-colors"
              >
                <span>See what we do</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {/* Trust bar */}
            <dl className="mt-10 grid grid-cols-3 gap-6 max-w-md">
              {[
                ['20+', 'Specialities & services'],
                ['4', 'Pathology departments'],
                ['<1 min', 'To book online'],
              ].map(([value, label]) => (
                <div key={label}>
                  <dt className="text-2xl sm:text-3xl font-black text-white">{value}</dt>
                  <dd className="mt-1 text-xs text-slate-400 leading-snug">{label}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Right: visual - a mock "booking confirmation" so the promise is concrete */}
          <div className="relative hidden sm:block">
            <div className="absolute -inset-6 bg-gradient-to-tr from-emerald-500/20 to-teal-500/20 blur-3xl rounded-[3rem]" />
            <div className="relative rounded-3xl bg-white/[0.06] border border-white/12 backdrop-blur-xl p-7 shadow-2xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-emerald-300 text-xs font-extrabold uppercase tracking-widest">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Booking confirmed
                </div>
                <QrCode className="w-5 h-5 text-slate-400" />
              </div>

              <div className="mt-6 rounded-2xl bg-white/[0.05] border border-white/10 px-5 py-4">
                <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                  Your patient check-in code
                </div>
                <div className="mt-1.5 text-3xl font-black font-mono tracking-widest text-white">
                  REG-4821
                </div>
              </div>

              <ul className="mt-5 space-y-3.5 text-sm text-slate-300">
                {[
                  ['Book online', 'Choose a date & time — no sign-up needed'],
                  ['Get your code', 'A REG-#### code appears instantly'],
                  ['Arrive & check in', 'Present it at the front desk; triage follows'],
                ].map(([title, sub]) => (
                  <li key={title} className="flex items-start space-x-3">
                    <span className="mt-0.5 w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center shrink-0">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </span>
                    <span>
                      <span className="font-bold text-white block">{title}</span>
                      <span className="text-xs text-slate-400">{sub}</span>
                    </span>
                  </li>
                ))}
              </ul>

              <div className="mt-6 flex items-center space-x-2 text-xs text-slate-400">
                <Clock className="w-3.5 h-3.5" />
                <span>Save your code — it is how staff find your record when you arrive.</span>
              </div>
            </div>
          </div>
        </div>

        {/* Soft fade into the page background */}
        <div className="relative h-10 bg-gradient-to-b from-transparent to-white dark:to-dark-bg" />
      </section>

      {/* =========================== SERVICES ============================ */}
      <section id="services" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-24 scroll-mt-16">
        <Reveal className="max-w-2xl">
          <span className="text-xs font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
            What we do
          </span>
          <h2 className="mt-3 text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tight">
            Everything your care needs, in one building
          </h2>
          <p className="mt-4 text-slate-600 dark:text-slate-400 leading-relaxed">
            Diagnostics, treatment and pharmacy together — so a result never
            means another trip across town.
          </p>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {[
            {
              icon: Stethoscope,
              title: 'General & Specialist Consultations',
              body: 'Physician visits, specialist referrals and chronic-condition follow-ups, booked to your time.',
            },
            {
              icon: Activity,
              title: 'Nursing & Triage',
              body: 'Rapid assessment on arrival: vitals, blood pressure, ECGs and care escalation, all recorded.',
            },
            {
              icon: FlaskConical,
              title: 'Hospital Laboratory',
              body: 'Haematology, chemical pathology, microbiology and histopathology — in-house, so results return fast.',
            },
            {
              icon: Scan,
              title: 'Radiology & Imaging',
              body: 'X-ray, ultrasound and ECG with reporting that feeds straight into your digital record.',
            },
            {
              icon: Pill,
              title: 'Pharmacy & Dispensary',
              body: 'Your prescriptions are dispensed on-site, with dosage guidance from our pharmacists.',
            },
            {
              icon: Accessibility,
              title: 'Physiotherapy & Rehab',
              body: 'Structured programmes for recovery and pain management, tracked session by session.',
            },
            {
              icon: Baby,
              title: 'Antenatal & Maternal Care',
              body: 'Booking-to-birth support: scans, check-ups and a coordinated birth plan with our team.',
            },
            {
              icon: HeartPulse,
              title: 'Preventive Health',
              body: 'Screening, wellness checks and vaccination visits — the visit that stops the episode.',
            },
          ].map((service, i) => (
            <Reveal key={service.title} delay={i * 60}>
              <div className="group h-full rounded-3xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border p-6 hover:-translate-y-1 hover:shadow-xl hover:shadow-emerald-600/10 hover:border-emerald-300 dark:hover:border-emerald-700 transition-all">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center group-hover:scale-110 group-hover:bg-emerald-500 group-hover:text-white transition-all">
                  <service.icon className="w-6 h-6" />
                </div>
                <h3 className="mt-4 text-base font-extrabold text-slate-900 dark:text-white leading-snug">
                  {service.title}
                </h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  {service.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ========================== HOW IT WORKS ========================== */}
      <section id="how-it-works" className="bg-slate-50 dark:bg-dark-surface/40 border-y border-light-border dark:border-dark-border scroll-mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-24">
          <Reveal className="max-w-2xl">
            <span className="text-xs font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
              How it works
            </span>
            <h2 className="mt-3 text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tight">
              From booking to bedside, in four steps
            </h2>
          </Reveal>

          <div className="mt-12 grid grid-cols-1 md:grid-cols-4 gap-6">
            {[
              {
                n: '01',
                icon: CalendarDays,
                title: 'Book online',
                body: 'Pick a date and time on this page. No account, no app, no call.',
              },
              {
                n: '02',
                icon: QrCode,
                title: 'Get your patient code',
                body: 'A REG-#### code appears on screen the moment you submit. Keep it.',
              },
              {
                n: '03',
                icon: ClipboardList,
                title: 'Arrive & check in',
                body: 'Present your code at the front desk. Staff pull up your details and triage you.',
              },
              {
                n: '04',
                icon: Stethoscope,
                title: 'Receive care',
                body: 'Consultation, diagnostics and pharmacy — coordinated under one roof.',
              },
            ].map((step, i) => (
              <Reveal key={step.n} delay={i * 80}>
                <div className="relative h-full">
                  <div className="absolute top-0 left-8 h-full w-px bg-gradient-to-b from-emerald-300 to-transparent md:hidden" />
                  <div className="relative rounded-3xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border p-6">
                    <div className="flex items-center justify-between">
                      <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shadow-lg shadow-emerald-600/20">
                        <step.icon className="w-5 h-5" />
                      </div>
                      <span className="text-3xl font-black text-emerald-600/15 dark:text-emerald-400/15">{step.n}</span>
                    </div>
                    <h3 className="mt-4 text-base font-extrabold text-slate-900 dark:text-white">{step.title}</h3>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{step.body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ============================ WHY US ============================== */}
      <section id="why-us" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-24 scroll-mt-16">
        <Reveal className="max-w-2xl">
          <span className="text-xs font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
            Why FatClinic
          </span>
          <h2 className="mt-3 text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tight">
            Modern medicine, run the way it should be
          </h2>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-5">
          {[
            {
              icon: FileText,
              title: 'Your records, all in one place',
              body: 'Every consultation, result and prescription lives in one secure digital health record — no paper chasing between departments.',
            },
            {
              icon: Microscope,
              title: 'Fast, in-house diagnostics',
              body: 'Our own laboratory and imaging suites mean your results follow your visit, and your clinician sees them in minutes, not days.',
            },
            {
              icon: Receipt,
              title: 'Transparent billing',
              body: 'Every charge itemised and accounted for. You always know exactly what you are paying for.',
            },
            {
              icon: ShieldCheck,
              title: 'An audit trail that never blinks',
              body: 'Every change to your record is logged. Accountability is built into the system, not bolted on.',
            },
            {
              icon: Lock,
              title: 'Privacy you can trust',
              body: 'Only authorised clinic staff can see your records — never a third party, never the public web, never by default.',
            },
            {
              icon: Building2,
              title: 'Coordinated, one-stop care',
              body: 'Triage, consult, test, treat and collect medicines without leaving the building or repeating your story.',
            },
          ].map((feat, i) => (
            <Reveal key={feat.title} delay={i * 60}>
              <div className="group h-full rounded-3xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border p-6 hover:-translate-y-1 hover:shadow-xl hover:shadow-emerald-600/10 transition-all">
                <div className="w-12 h-12 rounded-2xl bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <feat.icon className="w-6 h-6" />
                </div>
                <h3 className="mt-4 text-base font-extrabold text-slate-900 dark:text-white">{feat.title}</h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{feat.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ============================== CTA =============================== */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20 lg:pb-24">
        <Reveal>
          <div className="relative overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-emerald-600 via-teal-600 to-emerald-700 px-6 py-14 sm:px-14 text-center shadow-2xl shadow-emerald-700/25">
            <div
              className="absolute inset-0 opacity-15"
              style={{
                backgroundImage:
                  'linear-gradient(rgba(255,255,255,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.35) 1px, transparent 1px)',
                backgroundSize: '48px 48px',
              }}
            />
            <div className="relative">
              <span className="inline-flex items-center space-x-2 text-emerald-100 text-xs font-extrabold uppercase tracking-widest">
                <Activity className="w-4 h-4" />
                <span>Ready when you are</span>
              </span>
              <h2 className="mt-3 text-3xl sm:text-4xl font-black text-white tracking-tight">
                Book your appointment in under a minute
              </h2>
              <p className="mt-3 max-w-xl mx-auto text-emerald-50/90 leading-relaxed">
                Pick a time, get your patient code instantly, and walk straight in.
                No account, no download, no waiting on hold.
              </p>
              <div className="mt-7 flex flex-wrap justify-center gap-3">
                <button
                  onClick={openBooking}
                  className="inline-flex items-center space-x-2 px-7 py-3.5 rounded-2xl text-base font-extrabold text-emerald-900 bg-white hover:bg-emerald-50 shadow-xl transition-all"
                >
                  <CalendarCheck2 className="w-5 h-5" />
                  <span>Book now</span>
                </button>
                <button
                  onClick={() => scrollToId('contact')}
                  className="inline-flex items-center space-x-2 px-7 py-3.5 rounded-2xl text-base font-bold text-white border border-white/30 hover:bg-white/10 transition-colors"
                >
                  <Phone className="w-5 h-5" />
                  <span>Talk to us first</span>
                </button>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ============================ CONTACT ============================= */}
      <section id="contact" className="bg-slate-50 dark:bg-dark-surface/40 border-t border-light-border dark:border-dark-border scroll-mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-24">
          <Reveal className="max-w-2xl">
            <span className="text-xs font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
              Find us
            </span>
            <h2 className="mt-3 text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tight">
              {CLINIC.name}
            </h2>
          </Reveal>

          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              {
                icon: MapPin,
                title: 'Address',
                lines: [CLINIC.address],
              },
              {
                icon: Phone,
                title: 'Phone',
                lines: [CLINIC.phone, 'Front desk lines open during clinic hours.'],
              },
              {
                icon: Mail,
                title: 'Email',
                lines: [CLINIC.email, 'For appointments, results and general enquiries.'],
              },
            ].map((card, i) => (
              <Reveal key={card.title} delay={i * 70}>
                <div className="h-full rounded-3xl bg-white dark:bg-dark-card border border-light-border dark:border-dark-border p-6">
                  <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                    <card.icon className="w-5 h-5" />
                  </div>
                  <h3 className="mt-4 text-sm font-extrabold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    {card.title}
                  </h3>
                  {card.lines.map((line) => (
                    <p key={line} className="mt-1.5 text-sm font-semibold text-slate-900 dark:text-white leading-relaxed">
                      {line}
                    </p>
                  ))}
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={120}>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-600 dark:text-slate-400">
              <span className="inline-flex items-center space-x-2">
                <Clock className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>Consultation hours: Monday – Saturday</span>
              </span>
              <span className="inline-flex items-center space-x-2">
                <CalendarDays className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>Book online at any hour — staff confirm on arrival.</span>
              </span>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ============================= FOOTER ============================= */}
      <footer className="bg-slate-950 text-slate-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 grid grid-cols-1 md:grid-cols-3 gap-10">
          <div>
            <BrandMark />
            <p className="mt-4 text-sm text-slate-400 leading-relaxed max-w-xs">
              Coordinated medical care — consultation, laboratory, radiology,
              pharmacy and physiotherapy under one roof in Victoria Island.
            </p>
          </div>

          <div className="md:justify-self-center">
            <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-500">Explore</h3>
            <ul className="mt-4 space-y-2.5 text-sm font-semibold">
              {NAV_ITEMS.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => scrollToId(item.id)}
                    className="text-slate-300 hover:text-emerald-400 transition-colors"
                  >
                    {item.label}
                  </button>
                </li>
              ))}
              <li>
                <button onClick={openBooking} className="text-emerald-400 hover:text-emerald-300 transition-colors">
                  Book an appointment
                </button>
              </li>
            </ul>
          </div>

          <div className="md:justify-self-end">
            <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-500">Clinical staff</h3>
            <button
              onClick={() => navigate('/staff')}
              className="mt-4 inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-white/10 hover:bg-emerald-600 transition-colors"
            >
              <LogIn className="w-4 h-4" />
              <span>Sign in to the workstation</span>
            </button>
            <p className="mt-4 text-xs text-slate-500 leading-relaxed max-w-xs">
              The staff dashboard lives at <span className="font-mono text-slate-400">/staff</span> — this
              public page never shows patient records.
            </p>
          </div>
        </div>

        <div className="border-t border-white/10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
            <span>© {new Date().getFullYear()} {CLINIC.name}. All rights reserved.</span>
            <span>Bookings are confidential and visible only to authorised clinic staff.</span>
          </div>
        </div>
      </footer>

      {/* ======================= BOOKING MODAL ============================ */}
      <OnlineBookingModal
        isOpen={isBookingOpen}
        onClose={() => setIsBookingOpen(false)}
        submit={visitorSubmit}
        title={{
          heading: 'Book an Appointment',
          subheading: 'A minute from now you will have your Patient Code for check-in. No account needed.',
        }}
      />
    </div>
  );
};