import { motion } from 'framer-motion';
import {
  ArrowRight,
  CheckCircle,
  ClipboardCheck,
  FileSpreadsheet,
  Headset,
  KeyRound,
  Landmark,
  Lock,
  MessageSquare,
  Building2,
  GraduationCap,
  Users,
  UserCheck,
  Wallet,
  BarChart3,
  ShieldCheck,
  Banknote,
  Gift,
  LifeBuoy,
  Coins,
  Calculator
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import SEO from '../components/SEO';

const customers = [
  {
    icon: <Users className="w-7 h-7" />,
    product: 'MyChama',
    who: 'Chamas',
    gradient: 'from-cyan-500 to-blue-500',
    intro:
      'Chama officials are busy volunteers. You help them get their records into MyChama and keep the group informed.',
    tasks: [
      'Bring member and contribution records into the chama’s account',
      'Send SMS reminders and notices to members',
      'Run the reports officials ask for',
      'Answer support requests the chama sends to its desk'
    ]
  },
  {
    icon: <GraduationCap className="w-7 h-7" />,
    product: 'MyRegister',
    who: 'Schools',
    gradient: 'from-blue-500 to-purple-500',
    intro:
      'Schools need clean registers and a dependable way to reach parents. You do the setup and the repetitive work.',
    tasks: [
      'Import class and learner records, or enter them by hand',
      'Schedule SMS to parents and send bulk reminders',
      'Help the school buy SMS credits when it runs low',
      'Answer support requests the school sends to its desk'
    ]
  },
  {
    icon: <Building2 className="w-7 h-7" />,
    product: 'Plot Yangu',
    who: 'Landlords',
    gradient: 'from-purple-500 to-pink-500',
    intro:
      'Landlords want rent collected on time and tenants kept informed. You help them run the routine side of it.',
    tasks: [
      'Request rent payment from tenants by M-Pesa prompt',
      'Send SMS to tenants',
      'Run reports on rent and arrears',
      'Answer support requests the landlord sends to its desk'
    ]
  },
  {
    icon: <Coins className="w-7 h-7" />,
    product: 'Lipa Mdogo Mdogo',
    who: 'Tenants who pay rent in small amounts',
    gradient: 'from-emerald-500 to-cyan-500',
    intro:
      'Many tenants earn a little at a time, not a lump sum on rent day. You help them put money towards rent whenever they can, while the landlord receives the full rent on the due date.',
    tasks: [
      'Set the tenant up with their landlord’s details',
      'The tenant confirms the plan with a one-time code sent to their phone',
      'The tenant pays towards rent in small amounts, from KES 10, by M-Pesa',
      'You earn on every instalment they pay'
    ]
  }
];

const tools = [
  {
    icon: <FileSpreadsheet className="w-6 h-6" />,
    title: 'Import and manual entry',
    desc: 'Upload a customer’s existing records, or key them in yourself. Records are checked before anything is saved.'
  },
  {
    icon: <MessageSquare className="w-6 h-6" />,
    title: 'SMS',
    desc: 'Schedule messages ahead of time or send them now, from the customer’s own account.'
  },
  {
    icon: <BarChart3 className="w-6 h-6" />,
    title: 'Reports and exports',
    desc: 'Run reports and export data for the customers you support.'
  },
  {
    icon: <LifeBuoy className="w-6 h-6" />,
    title: 'Desk requests',
    desc: 'Customers raise requests inside their own product. They arrive in your Desk requests tab for you to answer.'
  },
  {
    icon: <Coins className="w-6 h-6" />,
    title: 'Rent instalments',
    desc: 'Set tenants up on Lipa Mdogo Mdogo and follow each one’s progress. Your earnings from every instalment are paid straight to you.'
  },
  {
    icon: <Wallet className="w-6 h-6" />,
    title: 'Service tickets',
    desc: 'Each job is a ticket. The customer pays by M-Pesa prompt, and the work runs once payment is confirmed.'
  },
  {
    icon: <Banknote className="w-6 h-6" />,
    title: 'Earnings',
    desc: 'See what each customer and each service has earned you, as it happens.'
  }
];

const earnings = [
  {
    icon: <Wallet className="w-7 h-7 text-cyan-400" />,
    title: 'Service fees',
    desc: 'When a customer pays for a desk service, your share goes straight to your own payout account at the moment of payment. Samuhia keeps a small platform share after payment fees. Nothing waits to be settled.'
  },
  {
    icon: <Landmark className="w-7 h-7 text-blue-400" />,
    title: 'Commission on the accounts you support',
    desc: 'You earn a share when the customers you support pay for subscriptions, reports and SMS credits in MyChama, MyRegister and Plot Yangu. The share depends on your rank and the product.'
  },
  {
    icon: <Gift className="w-7 h-7 text-purple-400" />,
    title: 'Milestone and support bonuses',
    desc: 'A milestone bonus is paid when enough of your accounts stay on as paying customers, and a monthly support quality bonus rewards good support. The conditions are explained at onboarding. Bonuses are approved and paid by the Samuhia top desk.'
  },
  {
    icon: <Coins className="w-7 h-7 text-emerald-400" />,
    title: 'Rent instalments',
    desc: 'Set a tenant up on Lipa Mdogo Mdogo and you earn a share of the service fee on every instalment they pay, paid straight to your desk, plus a bonus when they finish the month’s rent on time. It is the same on every rank, and it keeps coming for as long as the tenant keeps paying.'
  }
];

const projections = [
  {
    band: 'Part-time',
    amount: 'KES 1,120',
    detail: '8 tenants paying KES 5,000 rent weekly, and 2 Excel imports'
  },
  {
    band: 'Starter',
    amount: 'KES 4,276',
    detail: '20 tenants paying KES 6,000 rent weekly, 4 chama accounts and 6 imports'
  },
  {
    band: 'Steady',
    amount: 'KES 13,874',
    detail: '80 tenants paying KES 8,000 rent weekly, 10 chama accounts, 2 landlord accounts and 10 imports'
  }
];

const steps = [
  {
    icon: <ClipboardCheck className="w-8 h-8" />,
    title: 'Apply',
    desc: 'Register and submit your details and documents.'
  },
  {
    icon: <UserCheck className="w-8 h-8" />,
    title: 'Get approved',
    desc: 'Samuhia reviews your application. Once approved you receive your desk code.'
  },
  {
    icon: <KeyRound className="w-8 h-8" />,
    title: 'Open a session',
    desc: 'You confirm each working session with a one-time code sent by SMS.'
  },
  {
    icon: <Headset className="w-8 h-8" />,
    title: 'Serve customers',
    desc: 'Work on the accounts you support, get paid, and watch your earnings grow.'
  }
];

const standards = [
  'Every action you take on a customer’s account or on money is recorded.',
  'Sessions need a one-time code and expire, so a borrowed login is not enough.',
  'Money is paid out by Paystack to your own account, not collected by hand.',
  'An account has one owner desk. You cannot own, run or be related to your own accounts.',
  'Samuhia’s top desk can always step in on any account to resolve a problem.',
  'Prices are set by the platform and shown to the customer before they pay.'
];

export default function ExplorePage() {
  const navigate = useNavigate();

  return (
    <>
      <SEO
        title="Explore Samuhia Desk - Earn from Chamas, Schools, Landlords and Rent Instalments in Kenya"
        description="See what a Samuhia Desk agent does for chamas, schools, landlords and tenants paying rent in small amounts with Lipa Mdogo Mdogo, and the projected income."
        keywords="Samuhia Desk, Lipa Mdogo Mdogo agent, rent instalments Kenya, pay rent in small amounts, MyChama agent, MyRegister agent, Plot Yangu agent, chama support Kenya, school SMS Kenya, rent collection Kenya, earn as an agent Kenya"
        canonicalUrl="https://desk.samuhia.co.ke/explore"
      />

      <div className="min-h-screen w-full bg-gradient-to-br from-slate-900 via-gray-900 to-black text-white flex flex-col overflow-x-hidden">
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <motion.div
            animate={{ scale: [1, 1.2, 1], rotate: [0, 90, 0], opacity: [0.03, 0.06, 0.03] }}
            transition={{ duration: 20, repeat: Infinity }}
            className="absolute top-0 right-0 w-96 h-96 bg-cyan-500 rounded-full blur-3xl"
          />
          <motion.div
            animate={{ scale: [1, 1.3, 1], rotate: [0, -90, 0], opacity: [0.03, 0.05, 0.03] }}
            transition={{ duration: 25, repeat: Infinity }}
            className="absolute bottom-0 left-0 w-96 h-96 bg-purple-500 rounded-full blur-3xl"
          />
        </div>

        {/* Hero */}
        <section className="relative text-center py-20 sm:py-24 px-4 sm:px-6 z-10">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="max-w-3xl mx-auto"
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-sm mb-6">
              <Headset className="w-4 h-4" />
              Samuhia Desk
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight mb-6">
              Be the desk that{' '}
              <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                chamas, schools and landlords
              </span>{' '}
              call first
            </h1>
            <p className="text-base sm:text-lg text-gray-300 mb-8">
              Samuhia Desk gives agents one place to set customers up, keep their records and messages in order, and
              get paid for the work, including a share of every rent instalment your tenants pay.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={() => navigate('/signup')}
                className="px-6 py-3 rounded-full bg-cyan-500 hover:bg-cyan-400 text-black font-semibold shadow-lg shadow-cyan-500/30 transition-all inline-flex items-center justify-center gap-2"
              >
                Apply to be an agent <ArrowRight className="w-5 h-5" />
              </button>
              <button
                onClick={() => navigate('/signin')}
                className="px-6 py-3 rounded-full border-2 border-cyan-500 text-cyan-400 hover:bg-cyan-500 hover:text-black font-semibold transition-all"
              >
                Sign in
              </button>
              <a
                href="https://samuhia.co.ke/careers/#calculator"
                target="_blank"
                rel="noopener noreferrer"
                className="px-6 py-3 rounded-full border-2 border-emerald-400 text-emerald-300 hover:bg-emerald-400 hover:text-black font-semibold transition-all inline-flex items-center justify-center gap-2"
              >
                <Calculator className="w-5 h-5" /> Estimate your income
              </a>
            </div>
          </motion.div>
        </section>

        {/* What an agent does */}
        <section className="relative py-16 px-4 sm:px-6 z-10" aria-labelledby="customers-heading">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-12">
              <h2 id="customers-heading" className="text-3xl sm:text-4xl font-bold mb-3">
                What an agent does
              </h2>
              <p className="text-gray-400 max-w-2xl mx-auto">
                You support four kinds of customer. Each uses a Samuhia product, and the desk is where you work on their
                behalf.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
              {customers.map((c) => (
                <div key={c.product} className="bg-gray-800/40 border border-gray-700 rounded-2xl p-6 flex flex-col">
                  <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${c.gradient} flex items-center justify-center mb-4`}>
                    {c.icon}
                  </div>
                  <p className="text-sm text-gray-400">{c.who}</p>
                  <h3 className="text-2xl font-bold mb-3">{c.product}</h3>
                  <p className="text-gray-300 mb-4">{c.intro}</p>
                  <ul className="space-y-2 mt-auto">
                    {c.tasks.map((t) => (
                      <li key={t} className="flex items-start gap-2 text-sm text-gray-300">
                        <CheckCircle className="w-4 h-4 text-cyan-400 mt-0.5 flex-shrink-0" />
                        <span className="min-w-0 break-words">{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Tools */}
        <section className="relative py-16 px-4 sm:px-6 z-10 bg-gradient-to-b from-transparent to-gray-900/50">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold mb-3">What is on your desk</h2>
              <p className="text-gray-400 max-w-2xl mx-auto">The tools you use to do that work.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {tools.map((t) => (
                <div key={t.title} className="bg-gray-800/40 border border-gray-700 rounded-xl p-5">
                  <div className="text-cyan-400 mb-3">{t.icon}</div>
                  <h3 className="font-bold mb-1">{t.title}</h3>
                  <p className="text-sm text-gray-400">{t.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Earnings */}
        <section className="relative py-16 px-4 sm:px-6 z-10" aria-labelledby="earn-heading">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-12">
              <h2 id="earn-heading" className="text-3xl sm:text-4xl font-bold mb-3">
                How you earn
              </h2>
              <p className="text-gray-400 max-w-2xl mx-auto">
                Four ways, all tracked on your earnings screen. Exact rates are shown in your dashboard and explained at
                onboarding.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
              {earnings.map((e) => (
                <div key={e.title} className="bg-gradient-to-br from-cyan-900/20 to-purple-900/20 border border-gray-700 rounded-2xl p-6">
                  <div className="mb-3">{e.icon}</div>
                  <h3 className="text-xl font-bold mb-2">{e.title}</h3>
                  <p className="text-gray-300 text-sm">{e.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Projected income */}
        <section className="relative py-16 px-4 sm:px-6 z-10 bg-gradient-to-b from-transparent to-gray-900/50" aria-labelledby="projection-heading">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-10">
              <h2 id="projection-heading" className="text-3xl sm:text-4xl font-bold mb-3">
                What it could add up to
              </h2>
              <p className="text-gray-400 max-w-2xl mx-auto">
                Rent instalments pay a little on every payment, so what you earn grows with the number of tenants you
                keep. One tenant paying KES 8,000 rent weekly is projected to earn you about{' '}
                <span className="text-emerald-300 font-semibold">KES 107 a month</span>, or about{' '}
                <span className="text-emerald-300 font-semibold">KES 196</span> if they pay daily.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {projections.map((p) => (
                <div key={p.band} className="bg-gray-800/40 border border-gray-700 rounded-2xl p-6">
                  <p className="text-sm text-gray-400">{p.band}</p>
                  <p className="text-3xl font-bold text-emerald-300 my-2 break-words">
                    {p.amount}
                    <span className="text-base font-medium text-gray-400"> a month</span>
                  </p>
                  <p className="text-sm text-gray-300">{p.detail}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500 max-w-3xl mx-auto text-center mt-6">
              Projected, not guaranteed. Figures use Samuhia’s current prices, are rounded down, and assume your
              customers keep paying and 7 in 10 tenants finish the month’s rent on time. Your real earnings depend on
              how many customers you set up and keep active, and Samuhia may change prices. Team shares and bonuses are
              not included.
            </p>
            <div className="flex justify-center mt-8">
              <a
                href="https://samuhia.co.ke/careers/#calculator"
                target="_blank"
                rel="noopener noreferrer"
                className="px-6 py-3 rounded-full border-2 border-emerald-400 text-emerald-300 hover:bg-emerald-400 hover:text-black font-semibold transition-all inline-flex items-center gap-2"
              >
                <Calculator className="w-5 h-5" /> Try the income calculator
              </a>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="relative py-16 px-4 sm:px-6 z-10" aria-labelledby="start-heading">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-12">
              <h2 id="start-heading" className="text-3xl sm:text-4xl font-bold mb-3">
                Getting started
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {steps.map((s, i) => (
                <div key={s.title} className="relative bg-gray-800/40 border border-gray-700 rounded-xl p-6 text-center">
                  <div className="absolute -top-3 -left-3 w-8 h-8 bg-gradient-to-br from-cyan-500 to-blue-500 rounded-full flex items-center justify-center text-sm font-bold text-black">
                    {i + 1}
                  </div>
                  <div className="text-cyan-400 flex justify-center mb-3">{s.icon}</div>
                  <h3 className="text-lg font-bold mb-1">{s.title}</h3>
                  <p className="text-sm text-gray-400">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Standards */}
        <section className="relative py-16 px-4 sm:px-6 z-10 bg-gradient-to-br from-cyan-900/10 via-blue-900/10 to-purple-900/10">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-10">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-cyan-500/10 text-cyan-400 mb-4">
                <ShieldCheck className="w-7 h-7" />
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold mb-3">Rules that protect everyone</h2>
              <p className="text-gray-400">Customers trust you with their records and their money. These rules keep that trust.</p>
            </div>
            <ul className="space-y-3">
              {standards.map((s) => (
                <li key={s} className="flex items-start gap-3 bg-gray-800/40 border border-gray-700 rounded-lg p-4">
                  <Lock className="w-5 h-5 text-cyan-400 mt-0.5 flex-shrink-0" />
                  <span className="text-gray-300 text-sm min-w-0 break-words">{s}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* CTA */}
        <section className="relative py-20 px-4 sm:px-6 text-center z-10">
          <div className="max-w-2xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Ready to open your desk?</h2>
            <p className="text-gray-300 mb-8">
              Apply today. Questions first? Write to{' '}
              <a href="mailto:info@samuhia.co.ke" className="text-cyan-400 hover:underline break-all">
                info@samuhia.co.ke
              </a>
              .
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={() => navigate('/signup')}
                className="px-8 py-3 rounded-full bg-cyan-500 hover:bg-cyan-400 text-black font-semibold transition-all"
              >
                Apply to be an agent
              </button>
              <button
                onClick={() => navigate('/')}
                className="px-8 py-3 rounded-full border border-gray-600 text-gray-300 hover:border-cyan-500 hover:text-cyan-400 transition-all"
              >
                Back home
              </button>
            </div>
          </div>
        </section>

        <footer className="relative bg-black text-gray-500 text-sm py-8 text-center border-t border-gray-800 z-10 px-4">
          <p className="mb-4 text-gray-400">© {new Date().getFullYear()} Samuhia Desk. All rights reserved.</p>
          <div className="flex flex-wrap justify-center gap-6">
            <a href="https://samuhia.co.ke/" target="_blank" rel="noopener noreferrer" className="hover:text-cyan-400 transition-colors">
              Official Website
            </a>
            <a href="https://payments.samuhia.co.ke/contact" target="_blank" rel="noopener noreferrer" className="hover:text-cyan-400 transition-colors">
              Contact Us
            </a>
            <a href="https://samuhia.co.ke/terms" target="_blank" rel="noopener noreferrer" className="hover:text-cyan-400 transition-colors">
              Terms of Use
            </a>
          </div>
        </footer>
      </div>
    </>
  );
}
